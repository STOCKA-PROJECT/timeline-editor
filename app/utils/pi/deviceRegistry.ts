import type { PiInfo } from '~/utils/pi/piClient'

// The belén players the editor can send this timeline to are the devices saved in Stocka for the
// organization (`GET /organizations/{org}/devices`): each one carries where it answers on the local
// network and its PIN, so every computer and phone of the organization finds it configured. The list
// is cached for offline use (at the belén the Pi has no Internet, and often neither has the laptop).
// A registered device is matched with the Pi that answers at its address by the Pi's `deviceId` (the
// uuid of its `device.json`); one that never reported it accepts whichever Pi answers there.

/** A device saved in Stocka (`GET /organizations/{org}/devices`). */
export interface RegisteredDevice {
  id: number
  deviceId: string | null
  name: string
  online: boolean
  lastSeenAt: string | null
  lastShowHash: string | null
  lastShowName: string | null
  /** Absent on older backends; null when the player did not report it. */
  lastShowTimelineId?: number | null
  /** Where it answers on the local network (`http://belen.local:8080`); absent on older backends. */
  localUrl?: string | null
  /** Its PIN; null when none is saved or the user may not see it (SPECTATOR). */
  pin?: string | null
  hasPin?: boolean
}

/** Address, PIN and uuid the editor saves on a registered device (`PATCH …/devices/{id}/connection`). */
export interface DeviceConnection {
  localUrl?: string
  pin?: string
  deviceId?: string
}

/**
 * Changes saved without a connection to Stocka (the laptop or phone on the Pi's own Wi-Fi), keyed by
 * device id; they are sent as soon as Stocka answers again.
 */
export type PendingConnections = Record<string, DeviceConnection>

/** What a probe of the saved address found. */
export interface DeviceProbe {
  reachable: boolean
  info: PiInfo | null
}

export interface DeviceEntry {
  /** `stocka:<id>`: stable even before the device reported its uuid. */
  key: string
  /** Stocka id of the device. */
  id: number
  deviceId: string | null
  name: string
  /** Local address saved in Stocka. */
  url: string | null
  /** PIN saved in Stocka (or typed in this session). */
  pin: string | null
  /** Stocka saw a heartbeat in the last minutes (it has Internet). */
  cloudOnline: boolean
  /** Its Pi answers at the address right now; null until probed (or without address). */
  reachable: boolean | null
  /** Name of another Pi that answers at the saved address instead. */
  otherAtUrl: string | null
  activeHash: string | null
  activeName: string | null
  /** Stocka timeline the active show comes from, when the player reports it. */
  activeTimelineId: number | null
  state: string | null
}

export function entryKey(id: number): string {
  return `stocka:${id}`
}

/** Whether the Pi that answered `info` is this device (an unbound device takes any Pi). */
export function isSameDevice(device: { deviceId: string | null }, info: PiInfo): boolean {
  return !device.deviceId || device.deviceId === info.device.deviceId
}

/**
 * The registered device a connected Pi is: the one bound to its uuid or, failing that, an unbound one
 * saved at the address it answered at.
 */
export function matchRegistered(registered: RegisteredDevice[], info: PiInfo, url: string): RegisteredDevice | null {
  return registered.find(r => r.deviceId === info.device.deviceId)
    ?? registered.find(r => !r.deviceId && !!r.localUrl && r.localUrl === url)
    ?? null
}

/** Adds `change` to what is already pending for device `id` (later values win). */
export function queueConnection(pending: PendingConnections, id: number, change: DeviceConnection): PendingConnections {
  return { ...pending, [String(id)]: { ...pending[String(id)], ...change } }
}

/** Reads the stored queue, dropping anything malformed. */
export function parsePendingConnections(raw: string | null): PendingConnections {
  if (!raw) return {}
  try {
    const data = JSON.parse(raw) as unknown
    if (!data || typeof data !== 'object' || Array.isArray(data)) return {}
    const out: PendingConnections = {}
    for (const [id, value] of Object.entries(data)) {
      if (!/^\d+$/.test(id) || !value || typeof value !== 'object' || Array.isArray(value)) continue
      const change: DeviceConnection = {}
      for (const field of ['localUrl', 'pin', 'deviceId'] as const) {
        const v = (value as Record<string, unknown>)[field]
        if (typeof v === 'string') change[field] = v
      }
      if (Object.keys(change).length) out[id] = change
    }
    return out
  } catch {
    return {}
  }
}

/** The registered devices as they will be once the pending changes reach Stocka (empty = removed). */
export function applyPending(registered: RegisteredDevice[], pending: PendingConnections): RegisteredDevice[] {
  return registered.map((r) => {
    const change = pending[String(r.id)]
    if (!change) return r
    const next = { ...r }
    if (change.localUrl !== undefined) next.localUrl = change.localUrl || null
    if (change.pin !== undefined) {
      next.pin = change.pin || null
      next.hasPin = !!change.pin
    }
    if (change.deviceId) next.deviceId = change.deviceId
    return next
  })
}

/**
 * One entry per registered device with what its Pi says live (when the probe reached the same Pi) or,
 * otherwise, what its last heartbeat told Stocka. `pins` are PINs typed in this session, which win over
 * the saved ones (they were checked against the Pi).
 */
export function deviceEntries(registered: RegisteredDevice[], probes: Record<string, DeviceProbe> = {}, pins: Record<string, string> = {}): DeviceEntry[] {
  const out = registered.map((r): DeviceEntry => {
    const key = entryKey(r.id)
    const url = r.localUrl || null
    const probe = url ? probes[key] : undefined
    const live = probe?.info && isSameDevice(r, probe.info) ? probe.info : null
    const reachable = probe ? probe.reachable && !!live : null
    return {
      key,
      id: r.id,
      deviceId: r.deviceId ?? live?.device.deviceId ?? null,
      name: r.name,
      url,
      pin: pins[key] ?? r.pin ?? null,
      cloudOnline: r.online,
      reachable,
      otherAtUrl: probe?.info && !live ? probe.info.device.name : null,
      // What the Pi says live wins over its last heartbeat.
      activeHash: reachable ? live!.show.hash : r.lastShowHash,
      activeName: reachable ? live!.show.name : r.lastShowName,
      activeTimelineId: reachable ? live!.show.timelineId ?? null : r.lastShowTimelineId ?? null,
      state: reachable ? live!.state : null
    }
  })
  return out.sort((a, b) => rank(a) - rank(b) || byName(a, b))
}

/**
 * What a device has compared with the open timeline: this show as it is now (`current`), an older
 * version of this timeline (`outdated`), another timeline (`other`), nothing (`none`), or we do not
 * know (`unknown`: not probed, no heartbeat). A show without timeline id (an older player, or a file
 * exported outside Stocka) can only be `current` or `other`.
 */
export type ShowSync = 'current' | 'outdated' | 'other' | 'none' | 'unknown'

export interface ActiveShow {
  activeHash: string | null
  activeTimelineId: number | null
}

export function showSync(active: ActiveShow, current: { hash: string | null, timelineId: number | null }, known: boolean): ShowSync {
  if (!known) return 'unknown'
  if (!active.activeHash) return 'none'
  if (current.hash && active.activeHash === current.hash) return 'current'
  if (active.activeTimelineId != null && active.activeTimelineId === current.timelineId) return 'outdated'
  return 'other'
}

/** Reachable first, then the ones with an address, then the ones without. */
function rank(e: DeviceEntry): number {
  if (e.reachable) return 0
  return e.url ? 1 : 2
}

function byName(a: { name: string }, b: { name: string }): number {
  return a.name.localeCompare(b.name, 'ca')
}
