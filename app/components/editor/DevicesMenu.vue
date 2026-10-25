<script setup lang="ts">
import { showSync, type DeviceEntry, type ShowSync } from '~/utils/pi/deviceRegistry'

// Content of the «Dispositius» dropdown: the belén players saved in the organization (with their
// address and PIN, also on phones), whether each is reachable now and whether it already plays this
// show as it is. Opening one connects the panel to it; «Envia a diversos» sends the show to several.

const props = defineProps<{ close: () => void }>()
const emit = defineEmits<{ openDevice: [entry: DeviceEntry], newDevice: [], sendMany: [] }>()

const devices = useDevicesStore()
const pi = usePiStore()
const scene = useSceneStore()
const { buildPackage } = useShowPackageBuilder()

/** Hash of the show as it is now; null while unknown or while the scene has errors. */
const currentHash = ref<string | null>(null)

onMounted(async () => {
  void devices.loadRegistered(scene.orgSlug)
  void devices.probeAll()
  try {
    currentHash.value = (await buildPackage()).pkg?.meta.hash ?? null
  } catch {
    currentHash.value = null
  }
})

const SYNC: Record<ShowSync, { label: string, badge: string, title: string } | null> = {
  current: { label: 'Al dia', badge: 'badge-ok', title: 'Té aquest timeline tal com està ara' },
  outdated: { label: 'Versió antiga', badge: 'badge-warn', title: 'Té aquest timeline, però d’abans dels últims canvis: torna-l’hi a enviar' },
  other: { label: 'Un altre timeline', badge: 'badge-brand', title: 'Té un altre show: si li envies aquest, el substituiràs' },
  none: { label: 'Sense show', badge: '', title: 'No té cap show actiu' },
  unknown: null
}

function connectedNow(e: DeviceEntry): boolean {
  return pi.connected && pi.entry?.id === e.id
}

function syncOf(e: DeviceEntry) {
  // Known when the Pi answered now or Stocka has its last heartbeat.
  const current = { hash: currentHash.value, timelineId: scene.timelineId }
  return SYNC[showSync(e, current, e.reachable === true || e.activeHash !== null)]
}

function detail(e: DeviceEntry): string {
  const parts: string[] = []
  if (connectedNow(e)) parts.push('connectat')
  else if (e.otherAtUrl) parts.push(`hi respon «${e.otherAtUrl}»`)
  else if (e.url) parts.push(e.reachable === null ? 'comprovant…' : e.reachable ? 'a l’abast' : 'no respon')
  if (e.url) parts.push(e.url.replace(/^https?:\/\//, ''))
  else parts.push('sense adreça: obre’l per posar-la-hi')
  if (e.url && !e.pin) parts.push('sense PIN')
  if (e.activeName && syncOf(e) === SYNC.other) parts.push(`té «${e.activeName}»`)
  if (e.reachable !== true && e.activeHash) parts.push('segons l’últim avís a Stocka')
  if (e.cloudOnline) parts.push('en línia a Stocka')
  return parts.join(' · ')
}

function dotClass(e: DeviceEntry): string {
  if (connectedNow(e) || e.reachable) return 'bg-ok'
  if (e.cloudOnline) return 'bg-accent'
  return 'bg-line-strong'
}

function choose(e: DeviceEntry) {
  props.close()
  emit('openDevice', e)
}
</script>

<template>
  <div>
    <div class="menu-heading flex items-center gap-2">
      <span class="label">Dispositius</span>
      <span v-if="devices.probing" class="text-[12px] leading-4 text-ink-muted">comprovant…</span>
      <button
        type="button" class="btn btn-sm btn-quiet ml-auto !h-6 !px-1.5 !text-[12px]"
        :disabled="devices.probing"
        @click="devices.probeAll()">Actualitza</button>
    </div>

    <p v-if="!devices.entries.length" class="px-3 py-2 text-[13px] leading-[18px] text-ink-soft">
      L’organització encara no en té cap. Afegeix-los a Stocka (Dispositius) amb l’adreça i el PIN, o connecta’t a la
      Raspberry del pessebre i desa-la des del panell.
    </p>

    <button
      v-for="e in devices.entries" :key="e.key"
      type="button" role="menuitem" class="menu-item"
      :title="e.url ? `Obre ${e.name}` : 'Obre el panell per connectar-t’hi i desar-ne l’adreça'"
      @click="choose(e)">
      <span class="mt-[5px] h-2 w-2 flex-shrink-0 rounded-full" :class="dotClass(e)" aria-hidden="true" />
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2">
          <span class="truncate font-medium">{{ e.name }}</span>
          <span v-if="syncOf(e)" class="badge ml-auto flex-shrink-0" :class="syncOf(e)!.badge" :title="syncOf(e)!.title">{{ syncOf(e)!.label }}</span>
        </span>
        <span class="menu-hint truncate" :title="detail(e)">{{ detail(e) }}</span>
      </span>
    </button>

    <div class="menu-sep" role="separator" />
    <button
      type="button" role="menuitem" class="menu-item"
      :disabled="!devices.entries.some(e => e.url)"
      @click="props.close(); emit('sendMany')">
      <span>
        Envia el show a diversos…
        <span class="menu-hint">El mateix show a totes les Raspberry que triïs</span>
      </span>
    </button>
    <button type="button" role="menuitem" class="menu-item" @click="props.close(); emit('newDevice')">
      <span>
        Connecta una altra Raspberry…
        <span class="menu-hint">Per adreça: belen.local, 10.42.0.1 o la que tingui a la xarxa; després la pots desar a Stocka</span>
      </span>
    </button>
  </div>
</template>
