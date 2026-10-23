<script setup lang="ts">
import { showSync, type DeviceEntry, type ShowSync } from '~/utils/pi/deviceRegistry'

// Content of the «Dispositius» dropdown: every belén player this timeline can go to, whether it is
// reachable now and whether it already plays this show as it is. Opening one connects the panel to
// it; «Envia a diversos» sends the show to several in a row.

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

const SYNC: Record<ShowSync, { label: string, badge: string } | null> = {
  current: { label: 'Al dia', badge: 'badge-ok' },
  other: { label: 'Un altre show', badge: 'badge-warn' },
  none: { label: 'Sense show', badge: '' },
  unknown: null
}

function connectedNow(e: DeviceEntry): boolean {
  return pi.connected && !!e.deviceId && pi.info?.device.deviceId === e.deviceId
}

function syncOf(e: DeviceEntry) {
  // Known when the Pi answered now or Stocka has its last heartbeat.
  return SYNC[showSync(e.activeHash, currentHash.value, e.reachable === true || e.registered)]
}

function detail(e: DeviceEntry): string {
  const parts: string[] = []
  if (connectedNow(e)) parts.push('connectat')
  else if (e.url) parts.push(e.reachable === null ? 'comprovant…' : e.reachable ? 'a l’abast' : 'no respon')
  if (e.url) parts.push(e.url.replace(/^https?:\/\//, ''))
  else parts.push('registrat a Stocka; no s’hi ha connectat des d’aquest ordinador')
  if (e.activeName && syncOf(e)?.label !== 'Al dia') parts.push(`té «${e.activeName}»`)
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
      Encara no n’hi ha cap. Connecta’t a la Raspberry del pessebre i quedarà a la llista.
    </p>

    <button
      v-for="e in devices.entries" :key="e.key"
      type="button" role="menuitem" class="menu-item"
      :title="e.url ? `Obre ${e.name}` : 'Obre el panell per connectar-t’hi'"
      @click="choose(e)">
      <span class="mt-[5px] h-2 w-2 flex-shrink-0 rounded-full" :class="dotClass(e)" aria-hidden="true" />
      <span class="min-w-0 flex-1">
        <span class="flex items-center gap-2">
          <span class="truncate font-medium">{{ e.name }}</span>
          <span v-if="syncOf(e)" class="badge ml-auto flex-shrink-0" :class="syncOf(e)!.badge">{{ syncOf(e)!.label }}</span>
        </span>
        <span class="menu-hint truncate" :title="detail(e)">{{ detail(e) }}</span>
      </span>
    </button>

    <div class="menu-sep" role="separator" />
    <button
      type="button" role="menuitem" class="menu-item"
      :disabled="!devices.known.length"
      @click="props.close(); emit('sendMany')">
      <span>
        Envia el show a diversos…
        <span class="menu-hint">El mateix show a totes les Raspberry que triïs</span>
      </span>
    </button>
    <button type="button" role="menuitem" class="menu-item" @click="props.close(); emit('newDevice')">
      <span>
        Connecta una Raspberry…
        <span class="menu-hint">Per adreça: belen.local, 10.42.0.1 o la que tingui a la xarxa</span>
      </span>
    </button>
  </div>
</template>
