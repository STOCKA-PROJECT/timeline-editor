import { defineStore } from 'pinia'
import {
  forgetDevice,
  mergeDevices,
  parseKnownDevices,
  rememberDevice,
  type DeviceEntry,
  type DeviceProbe,
  type KnownDevice,
  type RegisteredDevice
} from '~/utils/pi/deviceRegistry'
import { PiClient, type PiInfo } from '~/utils/pi/piClient'

const KNOWN_KEY = 'stocka.pi.devices'
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

/**
 * Every belén player the editor can send this timeline to: the Pis this laptop has reached (kept in
 * the browser) and the devices registered in Stocka for the organization, with what each one plays
 * now. PINs are per device and last for the browser session.
 */
export const useDevicesStore = defineStore('devices', () => {
  const known = ref<KnownDevice[]>(parseKnownDevices(read(local(), KNOWN_KEY)))
  const registered = ref<RegisteredDevice[]>([])
  const probes = ref<Record<string, DeviceProbe>>({})
  const probing = ref(false)
  const pins = ref<Record<string, string>>(parsePins(read(session(), PINS_KEY)))

  const entries = computed<DeviceEntry[]>(() => mergeDevices(known.value, registered.value, probes.value))
  const reachable = computed(() => entries.value.filter(e => e.reachable && e.url))

  function persistKnown() {
    write(local(), KNOWN_KEY, JSON.stringify(known.value))
  }

  /** The Pi that answered `info` at `url` (a connection or a probe). */
  function remember(info: PiInfo, url: string) {
    known.value = rememberDevice(known.value, info, url)
    probes.value = { ...probes.value, [info.device.deviceId]: { reachable: true, info } }
    persistKnown()
  }

  function forget(deviceId: string) {
    known.value = forgetDevice(known.value, deviceId)
    const { [deviceId]: _probe, ...rest } = probes.value
    probes.value = rest
    setPin(deviceId, null)
    persistKnown()
  }

  function pinFor(deviceId: string | null | undefined): string | null {
    return deviceId ? pins.value[deviceId] ?? null : null
  }

  function setPin(deviceId: string, pin: string | null) {
    const { [deviceId]: _old, ...rest } = pins.value
    pins.value = pin ? { ...rest, [deviceId]: pin } : rest
    write(session(), PINS_KEY, JSON.stringify(pins.value))
  }

  /** Devices registered in Stocka; nothing when the organization has none or the server is out of reach. */
  async function loadRegistered(orgSlug: string | null) {
    if (!orgSlug) {
      registered.value = []
      return
    }
    try {
      registered.value = await useCachedApi().get<RegisteredDevice[]>(`/organizations/${orgSlug}/devices`)
    } catch {
      registered.value = []
    }
  }

  async function probe(device: KnownDevice) {
    try {
      const info = await new PiClient(device.url).info()
      if (info.device.deviceId === device.deviceId) {
        remember(info, device.url)
      } else {
        // Another Pi answers at that address now: learn it, and the old one is not there.
        probes.value = { ...probes.value, [device.deviceId]: { reachable: false, info: null } }
        remember(info, device.url)
      }
    } catch {
      probes.value = { ...probes.value, [device.deviceId]: { reachable: false, info: null } }
    }
  }

  /** Asks every known address who is there (in parallel, a few seconds at most). */
  async function probeAll() {
    if (probing.value) return
    probing.value = true
    try {
      await Promise.all(known.value.map(probe))
    } finally {
      probing.value = false
    }
  }

  return { known, registered, probes, probing, entries, reachable, remember, forget, pinFor, setPin, loadRegistered, probeAll }
})
