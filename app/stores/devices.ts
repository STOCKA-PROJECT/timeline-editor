import { defineStore } from 'pinia'
import {
  applyPending,
  deviceEntries,
  entryKey,
  isSameDevice,
  matchRegistered,
  parsePendingConnections,
  queueConnection,
  type DeviceConnection,
  type DeviceEntry,
  type DeviceProbe,
  type PendingConnections,
  type RegisteredDevice
} from '~/utils/pi/deviceRegistry'
import { isNetworkFailure } from '~/utils/offline/cachedRequest'
import { PiClient, type PiInfo } from '~/utils/pi/piClient'

const PENDING_KEY = 'stocka.pi.pending'
const PINS_KEY = 'stocka.pi.pins'

function read(storage: Storage | undefined, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null
  } catch {
    return null
  }
}

function write(storage: Storage | undefined, key: string, value: string) {
  try {
    storage?.setItem(key, value)
  } catch {
    // private mode: kept in memory only
  }
}

const local = () => (typeof localStorage === 'undefined' ? undefined : localStorage)
const session = () => (typeof sessionStorage === 'undefined' ? undefined : sessionStorage)

function parsePins(raw: string | null): Record<string, string> {
  try {
    const data = raw ? JSON.parse(raw) as unknown : {}
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    return Object.fromEntries(Object.entries(data).filter(([, v]) => typeof v === 'string')) as Record<string, string>
  } catch {
    return {}
  }
}

/** The backend's own message (already in the user's language) or `fallback`. */
function apiErrorText(error: unknown, fallback: string): string {
  const e = error as { data?: { detail?: unknown }, response?: { status?: number } } | null
  const status = e?.response?.status
  if (status === 403) return 'No tens permís per fer-ho en aquesta organització.'
  return typeof e?.data?.detail === 'string' && e.data.detail ? e.data.detail : fallback
}

/** What saving a change to Stocka did. */
export type SaveOutcome = 'saved' | 'queued' | 'failed'

/** Result of registering the connected Pi as a new device. */
export interface RegisterResult {
  device: RegisteredDevice
  heartbeatUrl: string
  heartbeatToken: string
}

/**
 * The belén players this timeline can go to: the devices saved in Stocka for the organization, each
 * with its local address and PIN (so a new computer or phone needs neither), and what each one plays
 * now. The list is read through the offline cache; address, PIN and uuid changes made without a
 * connection to Stocka wait in this browser and are sent once it answers again. PINs typed in this
 * session (checked against the Pi) win over the saved ones.
 */
export const useDevicesStore = defineStore('devices', () => {
  const orgSlug = ref<string | null>(null)
  const loaded = ref<RegisteredDevice[]>([])
  const pending = ref<PendingConnections>(parsePendingConnections(read(local(), PENDING_KEY)))
  const probes = ref<Record<string, DeviceProbe>>({})
  const probing = ref(false)
  const pins = ref<Record<string, string>>(parsePins(read(session(), PINS_KEY)))
  /** Last error saving to Stocka, for the panel. */
  const saveError = ref<string | null>(null)

  const registered = computed(() => applyPending(loaded.value, pending.value))
  const entries = computed<DeviceEntry[]>(() => deviceEntries(registered.value, probes.value, pins.value))
  const reachable = computed(() => entries.value.filter(e => e.reachable && e.url))
  const hasPending = computed(() => Object.keys(pending.value).length > 0)

  function persistPending() {
    write(local(), PENDING_KEY, JSON.stringify(pending.value))
  }

  function setSessionPin(key: string, pin: string | null) {
    const { [key]: _old, ...rest } = pins.value
    pins.value = pin ? { ...rest, [key]: pin } : rest
    write(session(), PINS_KEY, JSON.stringify(pins.value))
  }

  function entryOf(id: number): DeviceEntry | null {
    return entries.value.find(e => e.id === id) ?? null
  }

  /** The registered device a connected Pi is (see `matchRegistered`). */
  function match(info: PiInfo, url: string): DeviceEntry | null {
    const r = matchRegistered(registered.value, info, url)
    return r ? entryOf(r.id) : null
  }

  /** Registered devices no Pi has claimed yet: a newly connected Pi may be one of them. */
  const unbound = computed(() => entries.value.filter(e => !e.deviceId))

  function pinFor(entry: DeviceEntry | null | undefined): string | null {
    return entry ? entryOf(entry.id)?.pin ?? null : null
  }

  function replaceLoaded(device: RegisteredDevice) {
    loaded.value = loaded.value.some(d => d.id === device.id)
      ? loaded.value.map(d => (d.id === device.id ? device : d))
      : [...loaded.value, device]
  }

  async function patchConnection(id: number, change: DeviceConnection): Promise<RegisteredDevice> {
    return await useApi()<RegisteredDevice>(`/organizations/${orgSlug.value}/devices/${id}/connection`, {
      method: 'PATCH',
      body: change
    })
  }

  /** Sends what waits in this browser; stops at the first device Stocka cannot be reached for. */
  async function flushPending() {
    if (!orgSlug.value) return
    for (const [id, change] of Object.entries(pending.value)) {
      try {
        replaceLoaded(await patchConnection(Number(id), change))
      } catch (e) {
        if (isNetworkFailure(e)) return
        // Stocka refused it (the device was deleted, the PIN is no longer valid…): drop it.
      }
      const { [id]: _done, ...rest } = pending.value
      pending.value = rest
      persistPending()
    }
  }

  /**
   * Saves on a registered device where it answers, its PIN or its uuid. Without a connection to Stocka
   * the change waits in this browser (and already shows) until it answers again.
   */
  async function saveConnection(id: number, change: DeviceConnection): Promise<SaveOutcome> {
    saveError.value = null
    if (change.pin) setSessionPin(entryKey(id), change.pin)
    try {
      replaceLoaded(await patchConnection(id, change))
      return 'saved'
    } catch (e) {
      if (isNetworkFailure(e)) {
        pending.value = queueConnection(pending.value, id, change)
        persistPending()
        return 'queued'
      }
      saveError.value = apiErrorText(e, 'No s’ha pogut desar a Stocka.')
      return 'failed'
    }
  }

  /** A PIN the Pi accepted: kept for this session and saved in Stocka when it differs from the saved one. */
  async function rememberPin(entry: DeviceEntry, pin: string): Promise<SaveOutcome | null> {
    setSessionPin(entry.key, pin)
    const saved = registered.value.find(r => r.id === entry.id)
    // A SPECTATOR does not see the saved PIN (and may not save it): keep it for the session only.
    if (!saved || saved.pin === pin || (saved.hasPin && saved.pin == null)) return null
    return await saveConnection(entry.id, { pin })
  }

  function forgetSessionPin(entry: DeviceEntry) {
    setSessionPin(entry.key, null)
  }

  /**
   * Saves the connected Pi as a new device of the organization (OWNER or MANAGER), with its address,
   * PIN and uuid. Needs Stocka: there is no way to queue it.
   */
  async function register(name: string, change: DeviceConnection): Promise<RegisterResult | null> {
    saveError.value = null
    try {
      const created = await useApi()<{ device: RegisteredDevice, heartbeatToken: string, heartbeatUrl: string }>(
        `/organizations/${orgSlug.value}/devices`, { method: 'POST', body: { name, localUrl: change.localUrl, pin: change.pin } })
      let device = created.device
      if (change.deviceId) device = await patchConnection(device.id, { deviceId: change.deviceId }).catch(() => device)
      replaceLoaded(device)
      if (change.pin) setSessionPin(entryKey(device.id), change.pin)
      return { device, heartbeatUrl: created.heartbeatUrl, heartbeatToken: created.heartbeatToken }
    } catch (e) {
      saveError.value = isNetworkFailure(e)
        ? 'Cal connexió amb Stocka per afegir un dispositiu nou.'
        : apiErrorText(e, 'No s’ha pogut afegir el dispositiu a Stocka.')
      return null
    }
  }

  /** Devices saved in Stocka; nothing when the organization has none or there is no copy offline. */
  async function loadRegistered(slug: string | null) {
    if (slug !== orgSlug.value) probes.value = {}
    orgSlug.value = slug
    if (!slug) {
      loaded.value = []
      return
    }
    try {
      loaded.value = await useCachedApi().get<RegisteredDevice[]>(`/organizations/${slug}/devices`)
    } catch {
      loaded.value = []
      return
    }
    if (hasPending.value) void flushPending().then(() => { void refreshQuietly(slug) })
  }

  async function refreshQuietly(slug: string) {
    try {
      loaded.value = await useCachedApi().get<RegisteredDevice[]>(`/organizations/${slug}/devices`)
    } catch {
      // keep what we have
    }
  }

  /** The Pi that answered `info` for `entry` (a connection, a probe or a send). */
  function noteAnswer(entry: DeviceEntry, info: PiInfo) {
    probes.value = { ...probes.value, [entry.key]: { reachable: true, info } }
    // The first time a device that never reported its uuid answers, bind it (best effort).
    const saved = registered.value.find(r => r.id === entry.id)
    if (saved && !saved.deviceId && isSameDevice(saved, info)) void saveConnection(entry.id, { deviceId: info.device.deviceId })
  }

  async function probe(entry: DeviceEntry) {
    if (!entry.url) return
    try {
      noteAnswer(entry, await new PiClient(entry.url).info())
    } catch {
      probes.value = { ...probes.value, [entry.key]: { reachable: false, info: null } }
    }
  }

  /** Asks every saved address who is there (in parallel, a few seconds at most). */
  async function probeAll() {
    if (probing.value) return
    probing.value = true
    try {
      await Promise.all(entries.value.filter(e => e.url).map(probe))
    } finally {
      probing.value = false
    }
  }

  return {
    orgSlug,
    registered,
    probes,
    probing,
    entries,
    reachable,
    unbound,
    hasPending,
    saveError,
    entryOf,
    match,
    pinFor,
    saveConnection,
    rememberPin,
    forgetSessionPin,
    register,
    loadRegistered,
    flushPending,
    noteAnswer,
    probeAll
  }
})
