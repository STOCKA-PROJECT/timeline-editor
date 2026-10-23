import type { PiInfo } from '~/utils/pi/piClient'

// The belén players the editor knows about, from two sources:
//   - the Pis this laptop has connected to (kept in the browser: id, name, local address);
//   - the devices registered in Stocka for the organization (they know no local address, only what
//     their heartbeat reported when they had Internet).
// Both are matched by the Pi's `deviceId` (the uuid of its `device.json`). One timeline can be sent
// to any number of them.

/** A Pi this laptop has reached on the local network. */
export interface KnownDevice {
  deviceId: string
  name: string
  url: string
  /** ISO instant of the last time it answered. */
  lastSeenAt: string
}

/** A device registered in Stocka (`GET /organizations/{org}/devices`). */
export interface RegisteredDevice {
  id: number
  deviceId: string | null
  name: string
  online: boolean
  lastSeenAt: string | null
  lastShowHash: string | null
  lastShowName: string | null
}

/** What a probe of the local address found. */
export interface DeviceProbe {
  reachable: boolean
  info: PiInfo | null
}

export interface DeviceEntry {
  /** Stable key: the deviceId, or `stocka:<id>` for a registered device that never reported one. */
  key: string
  deviceId: string | null
  name: string
  /** Local address, when this laptop has reached it before. */
  url: string | null
  /** Registered in Stocka. */
  registered: boolean
  /** Stocka saw a heartbeat in the last minutes (it has Internet). */
  cloudOnline: boolean
  /** Reachable on the local network right now; null until probed (or without address). */
  reachable: boolean | null
  activeHash: string | null
  activeName: string | null
  state: string | null
}

/** Remembers (or refreshes) the Pi that answered `info` at `url`, keeping the list sorted by name. */
export function rememberDevice(list: KnownDevice[], info: PiInfo, url: string, now: Date = new Date()): KnownDevice[] {
  const entry: KnownDevice = { deviceId: info.device.deviceId, name: info.device.name, url, lastSeenAt: now.toISOString() }
  return [...list.filter(d => d.deviceId !== entry.deviceId), entry].sort(byName)
}

export function forgetDevice(list: KnownDevice[], deviceId: string): KnownDevice[] {
  return list.filter(d => d.deviceId !== deviceId)
}

/** Reads the stored list, dropping anything malformed. */
export function parseKnownDevices(raw: string | null): KnownDevice[] {
  if (!raw) return []
  try {
    const data = JSON.parse(raw) as unknown
    if (!Array.isArray(data)) return []
    return data.filter((d): d is KnownDevice =>
      !!d && typeof d === 'object'
      && typeof (d as KnownDevice).deviceId === 'string' && !!(d as KnownDevice).deviceId
      && typeof (d as KnownDevice).name === 'string'
      && typeof (d as KnownDevice).url === 'string' && !!(d as KnownDevice).url
      && typeof (d as KnownDevice).lastSeenAt === 'string')
  } catch {
    return []
  }
}

/**
 * One entry per device: local and registered ones merged by deviceId; a probe only counts when the
 * Pi at that address is the same device (another Pi may answer at `belen.local` now).
 */
export function mergeDevices(known: KnownDevice[], registered: RegisteredDevice[], probes: Record<string, DeviceProbe> = {}): DeviceEntry[] {
  const out = new Map<string, DeviceEntry>()
  for (const d of known) {
    const probe = probes[d.deviceId]
    const same = probe?.info?.device.deviceId === d.deviceId
    out.set(d.deviceId, {
      key: d.deviceId,
      deviceId: d.deviceId,
      name: same ? probe!.info!.device.name : d.name,
      url: d.url,
      registered: false,
      cloudOnline: false,
      reachable: probe ? probe.reachable && same : null,
      activeHash: same ? probe!.info!.show.hash : null,
      activeName: same ? probe!.info!.show.name : null,
      state: same ? probe!.info!.state : null
    })
  }
  for (const r of registered) {
    const key = r.deviceId ?? `stocka:${r.id}`
    const local = out.get(key)
    if (local) {
      local.registered = true
      local.cloudOnline = r.online
      // What the Pi says live wins over its last heartbeat.
      if (local.reachable !== true) {
        local.activeHash = r.lastShowHash
        local.activeName = r.lastShowName
      }
      continue
    }
    out.set(key, {
      key,
      deviceId: r.deviceId,
      name: r.name,
      url: null,
      registered: true,
      cloudOnline: r.online,
      reachable: null,
      activeHash: r.lastShowHash,
      activeName: r.lastShowName,
      state: null
    })
  }
  return [...out.values()].sort((a, b) => rank(a) - rank(b) || byName(a, b))
}

export type ShowSync = 'current' | 'other' | 'none' | 'unknown'

/** Whether the device plays this timeline as it is now. */
export function showSync(activeHash: string | null, currentHash: string | null, known: boolean): ShowSync {
  if (!known) return 'unknown'
  if (!activeHash) return 'none'
  return currentHash && activeHash === currentHash ? 'current' : 'other'
}

/** Reachable first, then the ones with an address, then registered-only. */
function rank(e: DeviceEntry): number {
  if (e.reachable) return 0
  return e.url ? 1 : 2
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'ca')
}
