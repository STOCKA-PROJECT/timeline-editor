<script setup lang="ts">
import type { ShowIssue, ShowPackage } from '~/types/show'
import { formatBytes } from '~/utils/bundle/formatBytes'
import { showSync, type KnownDevice, type ShowSync } from '~/utils/pi/deviceRegistry'
import { PiApiError, PiClient } from '~/utils/pi/piClient'
import { sendShowToPi, type SendPhase } from '~/utils/pi/sendShow'

// «Envia el show a diversos»: the open show, built once, sent one device after another to every Pi
// the user ticks (only what each one lacks travels). Each device needs its own PIN; the ones already
// given in this session are reused.

const emit = defineEmits<{ close: [] }>()

const devices = useDevicesStore()
const scene = useSceneStore()
const auth = useAuthStore()
const { buildPackage, fetchAsset } = useShowPackageBuilder()

type RowState = 'idle' | SendPhase | 'done' | 'error'
interface Row { device: KnownDevice, selected: boolean, pin: string, state: RowState, message: string }

const rows = ref<Row[]>(devices.known.map(d => ({ device: d, selected: false, pin: devices.pinFor(d.deviceId) ?? '', state: 'idle', message: '' })))
const activate = ref(true)
const building = ref(true)
const running = ref(false)
const pkg = ref<ShowPackage | null>(null)
const errors = ref<ShowIssue[]>([])
const warnings = ref<ShowIssue[]>([])
const buildError = ref<string | null>(null)

const PHASE: Record<RowState, string> = {
  idle: '',
  checking: 'Comprovant què té…',
  building: 'Preparant…',
  uploading: 'Enviant…',
  importing: 'Verificant…',
  done: 'Fet',
  error: 'No s’ha enviat'
}

const chosen = computed(() => rows.value.filter(r => r.selected))
const finished = computed(() => rows.value.some(r => r.state === 'done' || r.state === 'error') && !running.value)

function reachable(d: KnownDevice): boolean | null {
  const probe = devices.probes[d.deviceId]
  return probe ? probe.reachable : null
}

/** What the device has now compared with this show (only once it answered). */
function syncOf(d: KnownDevice): ShowSync {
  const info = devices.probes[d.deviceId]?.info
  if (!info || info.device.deviceId !== d.deviceId) return 'unknown'
  return showSync(
    { activeHash: info.show.hash, activeTimelineId: info.show.timelineId ?? null },
    { hash: pkg.value?.meta.hash ?? null, timelineId: scene.timelineId },
    true)
}

function hasText(d: KnownDevice): { text: string, tone: string } | null {
  const info = devices.probes[d.deviceId]?.info
  switch (syncOf(d)) {
    case 'current': return { text: 'Ja té aquest show tal com està ara.', tone: 'text-ok' }
    case 'outdated': return { text: 'Té una versió antiga d’aquest timeline: s’actualitzarà.', tone: 'text-ink-soft' }
    case 'other': return { text: `Té «${info?.show.name || 'un altre show'}», d’un altre timeline: si l’hi envies, el substituiràs.`, tone: 'text-warn' }
    case 'none': return { text: 'No té cap show.', tone: 'text-ink-soft' }
    default: return null
  }
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  const probing = devices.probeAll()
  try {
    if (scene.dirty && !scene.conflict) await scene.save().catch(() => undefined)
    const result = await buildPackage()
    pkg.value = result.pkg
    errors.value = result.errors
    warnings.value = result.warnings
  } catch (e) {
    buildError.value = e instanceof Error ? e.message : 'No s’ha pogut preparar el show.'
  } finally {
    building.value = false
  }
  await probing
  // Tick the ones that answer and do not play another timeline, unless the user already chose.
  if (!rows.value.some(r => r.selected)) {
    for (const r of rows.value) r.selected = reachable(r.device) === true && syncOf(r.device) !== 'other'
  }
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape' && !running.value) emit('close')
}

function actorName(): string {
  const user = auth.user
  return [user?.name, user?.lastName].filter(Boolean).join(' ') || user?.email || 'editor'
}

async function sendOne(row: Row, show: ShowPackage) {
  row.message = ''
  const pin = row.pin.trim()
  if (!pin) {
    row.state = 'error'
    row.message = 'Cal el PIN d’aquesta Raspberry.'
    return
  }
  row.state = 'checking'
  try {
    const client = new PiClient(row.device.url, { pin, name: actorName() })
    const info = await client.info()
    if (info.device.deviceId !== row.device.deviceId) {
      row.state = 'error'
      row.message = `A ${row.device.url.replace(/^https?:\/\//, '')} ara hi respon «${info.device.name}», no aquesta Raspberry.`
      devices.remember(info, row.device.url)
      return
    }
    if (!(await client.checkPin(pin))) {
      row.state = 'error'
      row.message = 'PIN incorrecte.'
      return
    }
    devices.setPin(row.device.deviceId, pin)
    const result = await sendShowToPi({
      client,
      pkg: show,
      fetchAsset,
      activate: activate.value && info.state !== 'PLAYING',
      onPhase: p => (row.state = p),
      onUploadProgress: p => (row.message = `${formatBytes(p.sent)} de ${formatBytes(p.total)}`)
    })
    if (result.status === 'rejected') {
      row.state = 'error'
      row.message = result.report.errors.map(i => i.message).join(' ') || 'Ha rebutjat el paquet.'
      return
    }
    row.state = 'done'
    const activated = result.status === 'already' ? result.activated : result.report.activated
    const sent = result.status === 'sent' ? `enviat (${formatBytes(result.bytes)})` : 'ja el tenia'
    row.message = `${sent} · ${activated ? 'és el show actiu' : info.state === 'PLAYING' ? 'no s’ha activat: s’estava reproduint' : 'no s’ha activat'}`
    devices.remember(await client.info(), row.device.url)
  } catch (e) {
    row.state = 'error'
    row.message = e instanceof PiApiError || e instanceof Error ? e.message : 'No s’ha pogut enviar.'
  }
}

async function sendAll() {
  if (!pkg.value || running.value) return
  running.value = true
  try {
    for (const row of rows.value) {
      row.state = 'idle'
      row.message = ''
    }
    for (const row of chosen.value) await sendOne(row, pkg.value)
  } finally {
    running.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" @click="!running && emit('close')">
      <section
        class="panel flex max-h-[85vh] w-[600px] max-w-full flex-col shadow-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="send-many-title"
        :aria-busy="running"
        @click.stop>
        <header class="border-b border-line-strong px-4 py-3">
          <h2 id="send-many-title" class="font-display text-[15px] font-semibold leading-5 text-ink">Envia el show a diversos dispositius</h2>
          <p class="mt-1 text-[13px] leading-[18px] text-ink-soft">
            «{{ scene.timelineName || 'Show' }}» s’envia a cada Raspberry que triïs, una darrere l’altra. Només viatja el que no
            tingui. El portàtil ha d’estar a la mateixa xarxa que totes.
          </p>
        </header>

        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <p v-if="building" class="text-[13px] leading-[18px] text-ink-soft">Preparant el show…</p>
          <p v-else-if="buildError" class="text-[13px] leading-[18px] text-danger" role="alert">{{ buildError }}</p>
          <div v-else-if="errors.length" class="space-y-1" role="alert">
            <p class="text-[13px] font-medium leading-[18px] text-danger">El show té errors i no es pot enviar:</p>
            <ul class="max-h-32 space-y-1 overflow-y-auto">
              <li v-for="(e, i) in errors" :key="i" class="text-[12.5px] leading-[17px] text-ink">{{ e.message }}</li>
            </ul>
          </div>
          <p v-else-if="warnings.length" class="text-[12.5px] leading-[17px] text-warn">
            {{ warnings.length }} {{ warnings.length === 1 ? 'avís' : 'avisos' }} al show (no impedeixen enviar-lo).
          </p>

          <p v-if="!rows.length" class="text-[13px] leading-[18px] text-ink-soft">
            Aquest ordinador encara no s’ha connectat a cap Raspberry. Connecta-t’hi primer des de «Dispositius».
          </p>
          <ul v-else class="space-y-2" aria-label="Dispositius">
            <li v-for="r in rows" :key="r.device.deviceId" class="rounded-[6px] border px-3 py-2" :class="r.selected ? 'border-accent' : 'border-line'">
              <div class="flex items-center gap-2 text-[13px] leading-[18px]">
                <input :id="`dev-${r.device.deviceId}`" v-model="r.selected" type="checkbox" :disabled="running">
                <label :for="`dev-${r.device.deviceId}`" class="min-w-0 flex-1 cursor-pointer">
                  <span class="block truncate font-medium text-ink">{{ r.device.name }}</span>
                  <span class="block truncate text-[12px] leading-4 text-ink-muted">
                    {{ r.device.url.replace(/^https?:\/\//, '') }} ·
                    {{ reachable(r.device) === null ? 'comprovant…' : reachable(r.device) ? 'a l’abast' : 'no respon' }}
                  </span>
                </label>
                <input
                  v-if="r.selected"
                  v-model="r.pin" type="password" inputmode="numeric" autocomplete="off"
                  class="field field-sm field-code !w-28" placeholder="PIN" :aria-label="`PIN de ${r.device.name}`"
                  :disabled="running">
              </div>
              <p v-if="r.state === 'idle' && hasText(r.device)" class="mt-1 text-[12px] leading-4" :class="hasText(r.device)!.tone">
                {{ hasText(r.device)!.text }}
              </p>
              <p v-if="r.state !== 'idle'" class="mt-1 flex items-center gap-2 text-[12px] leading-4">
                <span class="badge" :class="r.state === 'done' ? 'badge-ok' : r.state === 'error' ? 'badge-danger' : 'badge-brand'">{{ PHASE[r.state] }}</span>
                <span class="min-w-0" :class="r.state === 'error' ? 'text-danger' : 'text-ink-soft'">{{ r.message }}</span>
              </p>
            </li>
          </ul>

          <label class="flex items-center gap-2 text-[13px] leading-[18px] text-ink">
            <input v-model="activate" type="checkbox" :disabled="running">
            Fes-lo el show actiu (a les que no s’estiguin reproduint)
          </label>
        </div>

        <footer class="flex items-center gap-2 border-t border-line-strong bg-bg-alt px-4 py-2">
          <span v-if="chosen.length" class="text-[12px] leading-4 text-ink-soft">{{ chosen.length }} {{ chosen.length === 1 ? 'seleccionada' : 'seleccionades' }}</span>
          <button type="button" class="btn btn-sm btn-quiet ml-auto" :disabled="running" @click="emit('close')">{{ finished ? 'Tanca' : 'Cancel·la' }}</button>
          <button
            type="button" class="btn btn-sm btn-primary"
            :disabled="running || building || !pkg || !chosen.length"
            @click="sendAll()">{{ running ? 'Enviant…' : finished ? 'Torna a enviar' : 'Envia' }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
