<script setup lang="ts">
import { formatBytes } from '~/utils/bundle/formatBytes'
import type { ShowIssue } from '~/types/show'
import { DEFAULT_PI_URLS } from '~/utils/pi/piClient'
import { formatPiTime, scheduleSummary } from '~/utils/schedule'

// «Raspberry»: the belén Pi on the local network, straight from the editor. Send the open show
// (only what the Pi lacks travels), start or stop it, see its alerts and follow its log live. Needs
// the laptop and the Pi on the same network (the phone's hotspot, or the Pi's own Wi-Fi), not Internet.

const props = defineProps<{
  /** Connect to this address on opening (a device chosen in «Dispositius»). */
  connectTo?: string
  /** Open without connecting, to type the address of another Pi. */
  manual?: boolean
}>()
const emit = defineEmits<{ close: [] }>()

const pi = usePiStore()
const devices = useDevicesStore()
const scene = useSceneStore()
const { buildPackage, fetchAsset } = useShowPackageBuilder()

const address = ref(pi.url)
const pinInput = ref('')
const activate = ref(true)
const onlyProblems = ref(false)
const buildErrors = ref<ShowIssue[]>([])
const buildWarnings = ref<ShowIssue[]>([])
const building = ref(false)
const logBox = ref<HTMLElement | null>(null)
const followLog = ref(true)

const STATE_LABEL: Record<string, string> = {
  BOOT: 'Arrencant', SAFE: 'En segur', IDLE: 'En repòs', PLAYING: 'Reproduint', TEST: 'Mode prova', ERROR: 'Error'
}
const STATE_BADGE: Record<string, string> = {
  BOOT: 'badge-brand', SAFE: 'badge-warn', IDLE: 'badge-ok', PLAYING: 'badge-brand', TEST: 'badge-warn', ERROR: 'badge-danger'
}
const PHASE_LABEL: Record<string, string> = {
  checking: 'Comprovant què té la Raspberry…',
  building: 'Preparant el paquet…',
  uploading: 'Enviant…',
  importing: 'La Raspberry està verificant el paquet…',
  done: 'Enviat',
  error: 'No s’ha enviat'
}
const ALERT_LABEL: Record<string, string> = {
  motor_timeout: 'Motor aturat per temps',
  sensor_stop_show: 'Show aturat per un sensor',
  sensor_panic: 'Pànic'
}

const playing = computed(() => pi.state === 'PLAYING')
const uploadPercent = computed(() => {
  const p = pi.sendProgress
  return p && p.total > 0 ? Math.round((100 * p.sent) / p.total) : 0
})
const visibleLogs = computed(() => onlyProblems.value
  ? pi.logs.filter(l => /\| (ERROR|WARNING|CRITICAL)\s*\|/.test(l))
  : pi.logs)
const cycleText = computed(() => {
  const s = pi.status
  if (!s || s.state !== 'PLAYING' || !s.durationMs) return ''
  const sec = (ms: number) => `${Math.floor(ms / 1000)} s`
  // The Pi reports cycle 0 for an instant before the first cycle starts.
  return `cicle ${Math.max(1, s.cycle)}${s.cyclesTarget ? ` de ${s.cyclesTarget}` : ''} · ${sec(s.cycleMs)} de ${sec(s.durationMs)}`
})
const clockText = computed(() => {
  const c = pi.status?.clock
  if (!c) return ''
  if (!c.reliable) return 'La Raspberry no sap l’hora: l’horari del polsador s’ignora i el polsador funciona sempre.'
  return `Hora de la Raspberry: ${formatPiTime(c.now)} (${c.source === 'ntp' ? 'Internet' : 'd’un ordinador o un mòbil'})`
})
const scheduleText = computed(() => {
  const sc = pi.status?.schedule
  if (!sc) return ''
  const now = !sc.applies
    ? 'funciona sempre fins que sàpiga l’hora'
    : `${sc.open ? 'funciona' : 'no funciona'}${sc.nextChange ? ` fins ${formatPiTime(sc.nextChange)}` : ''}`
  return `Polsador: ${now} · ${scheduleSummary(sc)}`
})
const resultText = computed(() => {
  const r = pi.sendResult
  if (!r) return ''
  if (r.status === 'already') return r.activated ? 'La Raspberry ja tenia aquest show i ara és l’actiu.' : 'La Raspberry ja tenia aquest show.'
  if (r.status === 'rejected') return 'La Raspberry ha rebutjat el paquet.'
  const skipped = r.skippedAssets.length
  const parts = [`Enviat (${formatBytes(r.bytes)})`]
  if (skipped) parts.push(`${skipped} ${skipped === 1 ? 'fitxer d’àudio ja hi era' : 'fitxers d’àudio ja hi eren'}`)
  parts.push(r.report.activated ? 'és el show actiu' : 'no s’ha activat')
  return parts.join(' · ')
})

function lineClass(line: string): string {
  if (/\| (ERROR|CRITICAL)\s*\|/.test(line)) return 'text-danger'
  if (/\| WARNING\s*\|/.test(line)) return 'text-warn'
  return 'text-ink-soft'
}

function timeAgo(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'ara mateix'
  if (s < 3600) return `fa ${Math.round(s / 60)} min`
  return `fa ${Math.round(s / 3600)} h`
}

async function connect(target?: string) {
  if (target) address.value = target
  if (await pi.connect(address.value)) {
    address.value = pi.url
    pi.startLogs()
  }
}

async function savePin() {
  if (await pi.setPin(pinInput.value)) pinInput.value = ''
}

async function sendShow() {
  pi.resetSend()
  buildErrors.value = []
  buildWarnings.value = []
  building.value = true
  try {
    // Flush pending edits first so the Pi gets what the screen shows (offline they stay local).
    if (scene.dirty && !scene.conflict) await scene.save().catch(() => undefined)
    const result = await buildPackage()
    buildErrors.value = result.errors
    buildWarnings.value = result.warnings
    if (!result.pkg) return
    await pi.send(result.pkg, fetchAsset, activate.value)
  } catch (e) {
    pi.sendError = e instanceof Error ? e.message : 'No s’ha pogut preparar el show.'
    pi.sendPhase = 'error'
  } finally {
    building.value = false
  }
}

watch(() => pi.logs, async () => {
  if (!followLog.value) return
  await nextTick()
  if (logBox.value) logBox.value.scrollTop = logBox.value.scrollHeight
})

function onLogScroll() {
  const el = logBox.value
  if (el) followLog.value = el.scrollTop + el.clientHeight >= el.scrollHeight - 8
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}

onMounted(async () => {
  window.addEventListener('keydown', onKey)
  if (props.connectTo) {
    pi.disconnect()
    await connect(props.connectTo)
  } else if (props.manual) {
    pi.disconnect()
    address.value = ''
  } else if (pi.connected) {
    pi.startLogs()
  } else if (await pi.autoConnect()) {
    address.value = pi.url
    pi.startLogs()
  }
})

/** Removes the connected Pi from this laptop's list (it reappears on the next connection). */
function forgetDevice() {
  const id = pi.info?.device.deviceId
  if (!id) return
  pi.disconnect()
  devices.forget(id)
  address.value = ''
}
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  pi.stopLogs()
})
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex justify-end bg-black/50" @click="emit('close')">
      <section
        class="panel flex h-full w-[620px] max-w-full flex-col rounded-none shadow-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="pi-panel-title"
        @click.stop>
        <header class="flex items-center gap-3 border-b border-line-strong px-4 py-3">
          <h2 id="pi-panel-title" class="font-display text-[15px] font-semibold leading-5 text-ink">Dispositiu</h2>
          <span class="inline-flex items-center gap-1.5 text-[12px] leading-4 text-ink-soft">
            <span class="h-2 w-2 rounded-full" :class="pi.connected ? (pi.streaming ? 'bg-ok' : 'bg-warn') : 'bg-line-strong'" aria-hidden="true" />
            {{ pi.connected ? (pi.info?.device.name ?? 'Connectada') : (pi.connecting ? 'Connectant…' : 'Sense connexió') }}
          </span>
          <button type="button" class="btn btn-sm btn-quiet ml-auto" aria-label="Tanca" @click="emit('close')">Tanca</button>
        </header>

        <div class="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
          <!-- Connection -->
          <section class="space-y-2" aria-labelledby="pi-conn">
            <h3 id="pi-conn" class="label">Connexió</h3>
            <form class="flex items-center gap-2" @submit.prevent="connect()">
              <input v-model="address" class="field field-sm field-code min-w-0 flex-1" aria-label="Adreça de la Raspberry" placeholder="belen.local">
              <button type="submit" class="btn btn-sm btn-primary" :disabled="pi.connecting">{{ pi.connecting ? 'Connectant…' : 'Connecta' }}</button>
            </form>
            <div class="flex flex-wrap gap-1">
              <button v-for="u in DEFAULT_PI_URLS" :key="u" type="button" class="btn btn-sm btn-quiet font-mono !text-[12px]" @click="connect(u)">{{ u.replace('http://', '') }}</button>
            </div>
            <div v-if="pi.connected && pi.info" class="flex items-center gap-2 text-[12px] leading-4 text-ink-soft">
              <span class="min-w-0">
                {{ pi.info.device.name }} · versió <code class="font-mono">{{ pi.info.version }}</code> · contracte v{{ pi.info.catalogVersion }}
                <span v-if="pi.info.simulate" class="badge badge-warn ml-1">simulada</span>
              </span>
              <button
                type="button" class="btn btn-sm btn-quiet ml-auto flex-shrink-0"
                title="La treu de la llista de dispositius d’aquest ordinador (hi tornarà en connectar-t’hi)"
                @click="forgetDevice()">Treu de la llista</button>
            </div>
            <p v-else class="text-[12px] leading-4 text-ink-muted">
              El portàtil i la Raspberry han d’estar a la mateixa xarxa (el punt d’accés del mòbil o la Wi-Fi <strong>belen</strong>).
              La primera vegada Chrome demana permís per accedir a la xarxa local: accepta’l.
            </p>
          </section>

          <!-- PIN -->
          <section v-if="pi.connected" class="space-y-2" aria-labelledby="pi-pin">
            <h3 id="pi-pin" class="label">PIN</h3>
            <div v-if="pi.pinVerified" class="flex items-center gap-2 text-[13px] leading-[18px] text-ink">
              <span class="badge badge-ok">PIN correcte</span>
              <span class="text-ink-soft">d’aquest dispositiu; es recorda fins que tanquis el navegador</span>
              <button type="button" class="btn btn-sm btn-quiet ml-auto" @click="pi.forgetPin()">Oblida’l</button>
            </div>
            <form v-else class="flex items-center gap-2" @submit.prevent="savePin()">
              <input
                v-model="pinInput" type="password" inputmode="numeric" autocomplete="off"
                class="field field-sm field-code w-32" aria-label="PIN de la Raspberry" placeholder="PIN">
              <button type="submit" class="btn btn-sm" :disabled="!pinInput.trim()">Desa</button>
              <span class="text-[12px] leading-4 text-ink-muted">Cal per enviar el show i per les ordres. És a l’etiqueta de la caixa.</span>
            </form>
          </section>

          <p v-if="pi.error" class="text-[13px] leading-[18px] text-danger" role="alert">{{ pi.error }}</p>

          <!-- Send -->
          <section v-if="pi.connected" class="space-y-2" aria-labelledby="pi-send">
            <h3 id="pi-send" class="label">Show</h3>
            <div class="flex flex-wrap items-center gap-3">
              <button
                type="button" class="btn btn-sm btn-primary"
                :disabled="!pi.pinVerified || pi.sending || building"
                @click="sendShow()">{{ pi.sending || building ? 'Enviant…' : 'Envia aquest show' }}</button>
              <label class="flex items-center gap-1.5 text-[13px] leading-[18px] text-ink">
                <input v-model="activate" type="checkbox" class="h-4 w-4 accent-[var(--c-accent)]">
                Activa’l en acabar
              </label>
              <span v-if="playing && activate" class="text-[12px] leading-4 text-warn">Està reproduint: s’enviarà sense activar.</span>
            </div>
            <p class="text-[12px] leading-4 text-ink-muted">
              Només viatja el que la Raspberry no té: si ja té un àudio, no es torna a enviar. Funciona sense Internet.
            </p>
            <div v-if="pi.sendPhase" class="space-y-1">
              <p class="text-[13px] leading-[18px]" :class="pi.sendPhase === 'error' ? 'text-danger' : 'text-ink'">
                {{ PHASE_LABEL[pi.sendPhase] }}<template v-if="pi.sendPhase === 'uploading' && pi.sendProgress"> {{ uploadPercent }} % · {{ formatBytes(pi.sendProgress.sent) }} de {{ formatBytes(pi.sendProgress.total) }}</template>
              </p>
              <div
                v-if="pi.sendPhase === 'uploading' || pi.sendPhase === 'importing'"
                class="h-1.5 overflow-hidden rounded-full bg-bg-alt" role="progressbar" aria-label="Enviament"
                :aria-valuenow="uploadPercent" aria-valuemin="0" aria-valuemax="100">
                <div class="h-full rounded-full bg-accent transition-[width]" :style="{ width: `${uploadPercent}%` }" />
              </div>
              <p v-if="resultText" class="text-[13px] leading-[18px]" :class="pi.sendResult?.status === 'rejected' ? 'text-danger' : 'text-ink'">{{ resultText }}</p>
              <p v-if="pi.sendError" class="text-[13px] leading-[18px] text-danger" role="alert">{{ pi.sendError }}</p>
            </div>
            <ul
              v-if="buildErrors.length || buildWarnings.length || (pi.sendResult?.status !== 'already' && pi.sendResult?.report.errors.length)"
              class="max-h-40 overflow-y-auto rounded-[6px] border border-line bg-bg-alt px-1 py-1" aria-label="Avisos del show">
              <li v-for="(e, i) in buildErrors" :key="'b' + i" class="flex items-start gap-2 px-2 py-1 text-[13px] leading-[18px]">
                <span class="badge badge-danger mt-0.5">Error</span><span class="min-w-0">{{ e.message }}</span>
              </li>
              <template v-if="pi.sendResult && pi.sendResult.status !== 'already'">
                <li v-for="(e, i) in pi.sendResult.report.errors" :key="'r' + i" class="flex items-start gap-2 px-2 py-1 text-[13px] leading-[18px]">
                  <span class="badge badge-danger mt-0.5">Pi</span><span class="min-w-0">{{ e.message }}</span>
                </li>
              </template>
              <li v-for="(w, i) in buildWarnings" :key="'w' + i" class="flex items-start gap-2 px-2 py-1 text-[13px] leading-[18px]">
                <span class="badge badge-warn mt-0.5">Avís</span><span class="min-w-0">{{ w.message }}</span>
              </li>
            </ul>
          </section>

          <!-- Playback -->
          <section v-if="pi.connected" class="space-y-2" aria-labelledby="pi-play">
            <h3 id="pi-play" class="label">Reproducció</h3>
            <div class="flex flex-wrap items-center gap-2 text-[13px] leading-[18px]">
              <span v-if="pi.state" class="badge" :class="STATE_BADGE[pi.state] ?? ''">{{ STATE_LABEL[pi.state] ?? pi.state }}</span>
              <span class="min-w-0 truncate text-ink">{{ pi.status?.showName ?? 'Sense show' }}</span>
              <span v-if="cycleText" class="text-ink-soft">{{ cycleText }}</span>
            </div>
            <p v-if="pi.status?.lastError" class="text-[12px] leading-4 text-danger">{{ pi.status.lastError }}</p>
            <p v-if="clockText" class="text-[12px] leading-4" :class="pi.status?.clock?.reliable ? 'text-ink-soft' : 'text-warn'">{{ clockText }}</p>
            <p v-if="scheduleText" class="text-[12px] leading-4 text-ink-soft">{{ scheduleText }}</p>
            <div class="flex flex-wrap gap-2">
              <button type="button" class="btn btn-sm" :disabled="!pi.pinVerified || !!pi.busyCommand || !pi.status?.showName || playing" @click="pi.play()">Reprodueix</button>
              <button type="button" class="btn btn-sm" :disabled="!pi.pinVerified || !!pi.busyCommand || !playing" @click="pi.stop()">Atura</button>
              <button type="button" class="btn btn-sm btn-danger" :disabled="!pi.pinVerified || !!pi.busyCommand" @click="pi.panic()">Pànic</button>
            </div>
          </section>

          <!-- Alerts -->
          <section v-if="pi.connected && pi.alerts.length" class="space-y-2" aria-labelledby="pi-alerts">
            <div class="flex items-center gap-2">
              <h3 id="pi-alerts" class="label">Alertes</h3>
              <span class="badge badge-danger">{{ pi.alerts.length }}</span>
              <button type="button" class="btn btn-sm btn-quiet ml-auto" :disabled="!pi.pinVerified || !!pi.busyCommand" @click="pi.clearAlerts()">Esborra-les</button>
            </div>
            <ul class="space-y-1.5">
              <li v-for="(a, i) in [...pi.alerts].reverse()" :key="i" class="rounded-[6px] border border-line bg-bg-alt px-3 py-2 text-[13px] leading-[18px]">
                <div class="flex flex-wrap items-center gap-2">
                  <span class="badge" :class="a.code === 'sensor_panic' ? 'badge-danger' : 'badge-warn'">{{ ALERT_LABEL[a.code] ?? `Alerta (${a.code})` }}</span>
                  <code v-if="a.port" class="font-mono text-ink-soft">{{ a.port }}</code>
                  <span class="ml-auto text-[12px] text-ink-muted">{{ timeAgo(a.at) }}</span>
                </div>
                <p class="mt-1 text-ink">{{ a.message }}</p>
              </li>
            </ul>
            <div v-if="pi.lockedMotors.length" class="flex flex-wrap items-center gap-2 text-[13px] leading-[18px]">
              <span class="text-ink-soft">Motors bloquejats:</span>
              <button
                v-for="m in pi.lockedMotors" :key="m" type="button" class="btn btn-sm"
                :disabled="!pi.pinVerified || !!pi.busyCommand" @click="pi.unlockMotor(m)">Desbloqueja {{ m }}</button>
            </div>
          </section>

          <!-- Log -->
          <section v-if="pi.connected" class="space-y-2" aria-labelledby="pi-log">
            <div class="flex items-center gap-3">
              <h3 id="pi-log" class="label">Registre en directe</h3>
              <label class="flex items-center gap-1.5 text-[12px] leading-4 text-ink-soft">
                <input v-model="onlyProblems" type="checkbox" class="h-3.5 w-3.5 accent-[var(--c-accent)]">
                Només avisos i errors
              </label>
              <button type="button" class="btn btn-sm btn-quiet ml-auto" @click="pi.refreshLogs()">Actualitza</button>
            </div>
            <p v-if="pi.logError" class="text-[12px] leading-4 text-danger">{{ pi.logError }}</p>
            <div
              ref="logBox"
              class="h-72 overflow-y-auto rounded-[6px] border border-line bg-bg-alt px-2 py-1.5 font-mono text-[11.5px] leading-[16px]"
              role="log" aria-live="off" @scroll="onLogScroll">
              <p v-if="!visibleLogs.length" class="text-ink-muted">{{ onlyProblems ? 'Cap avís ni error.' : 'Registre buit.' }}</p>
              <p v-for="(line, i) in visibleLogs" :key="i" class="whitespace-pre-wrap break-all" :class="lineClass(line)">{{ line }}</p>
            </div>
          </section>
        </div>
      </section>
    </div>
  </Teleport>
</template>
