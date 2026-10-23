import { describe, expect, it } from 'vitest'
import {
  forgetDevice,
  mergeDevices,
  parseKnownDevices,
  rememberDevice,
  showSync,
  type KnownDevice,
  type RegisteredDevice
} from '~/utils/pi/deviceRegistry'
import type { PiInfo } from '~/utils/pi/piClient'

const NOW = new Date('2026-10-23T18:00:00Z')

function info(deviceId: string, name: string, hash: string | null = null, state: PiInfo['state'] = 'IDLE', timelineId?: number | null): PiInfo {
  return {
    apiVersion: 1, version: 't', simulate: false, board: 'rpi4b', catalogVersion: 3, state,
    device: { deviceId, name, apSsid: 'belen', apIp: '10.42.0.1', netMode: 'ap' },
    show: { hash, name: hash ? 'Pessebre' : null, ...(timelineId !== undefined ? { timelineId } : {}) }
  }
}
const known = (deviceId: string, name: string, url = `http://${name.toLowerCase()}.local:8080`): KnownDevice =>
  ({ deviceId, name, url, lastSeenAt: NOW.toISOString() })
const registered = (id: number, deviceId: string | null, name: string, patch: Partial<RegisteredDevice> = {}): RegisteredDevice =>
  ({ id, deviceId, name, online: false, lastSeenAt: null, lastShowHash: null, lastShowName: null, ...patch })

describe('rememberDevice / forgetDevice', () => {
  it('adds a new Pi and keeps the list sorted by name', () => {
    const list = rememberDevice([known('b', 'Sant Pere')], info('a', 'Badia'), 'http://10.42.0.1:8080', NOW)
    expect(list.map(d => d.name)).toEqual(['Badia', 'Sant Pere'])
    expect(list[0]).toEqual({ deviceId: 'a', name: 'Badia', url: 'http://10.42.0.1:8080', lastSeenAt: NOW.toISOString() })
  })

  it('refreshes name and address of a known Pi instead of duplicating it', () => {
    const list = rememberDevice([known('a', 'Vell', 'http://old:8080')], info('a', 'Nou'), 'http://belen.local:8080', NOW)
    expect(list).toEqual([{ deviceId: 'a', name: 'Nou', url: 'http://belen.local:8080', lastSeenAt: NOW.toISOString() }])
  })

  it('forgets by deviceId', () => {
    expect(forgetDevice([known('a', 'A'), known('b', 'B')], 'a').map(d => d.deviceId)).toEqual(['b'])
  })
})

describe('parseKnownDevices', () => {
  it('reads a stored list and drops malformed entries', () => {
    const raw = JSON.stringify([known('a', 'A'), { deviceId: '', name: 'x', url: 'u', lastSeenAt: 'n' }, { name: 'sense id' }, null, 7])
    expect(parseKnownDevices(raw)).toEqual([known('a', 'A')])
  })

  it.each([null, '', 'no json', '{"a":1}'])('returns nothing for %j', (raw) => {
    expect(parseKnownDevices(raw)).toEqual([])
  })
})

describe('mergeDevices', () => {
  it('lists local and registered devices once, merged by deviceId', () => {
    const entries = mergeDevices([known('a', 'Badia')], [registered(1, 'a', 'Badia (Stocka)', { online: true }), registered(2, 'c', 'Cala')])
    expect(entries.map(e => [e.key, e.registered, !!e.url])).toEqual([['a', true, true], ['c', true, false]])
    expect(entries[0]!.cloudOnline).toBe(true)
    expect(entries[0]!.name).toBe('Badia')
  })

  it('keys a registered device that never reported its id by its Stocka id', () => {
    expect(mergeDevices([], [registered(9, null, 'Nova')])[0]!.key).toBe('stocka:9')
  })

  it('reachable devices come first, then the ones with an address, then registered only', () => {
    const entries = mergeDevices(
      [known('a', 'Alfa'), known('b', 'Beta')],
      [registered(3, 'z', 'Zero')],
      { b: { reachable: true, info: info('b', 'Beta') }, a: { reachable: false, info: null } })
    expect(entries.map(e => e.name)).toEqual(['Beta', 'Alfa', 'Zero'])
    expect(entries.map(e => e.reachable)).toEqual([true, false, null])
  })

  it('takes name, show and state from a live probe of the same device', () => {
    const [e] = mergeDevices([known('a', 'Vell')], [], { a: { reachable: true, info: info('a', 'Nou', 'sha256:x', 'PLAYING', 12) } })
    expect(e).toMatchObject({ name: 'Nou', reachable: true, activeHash: 'sha256:x', activeName: 'Pessebre', activeTimelineId: 12, state: 'PLAYING' })
    // an older player does not report the timeline
    expect(mergeDevices([known('a', 'A')], [], { a: { reachable: true, info: info('a', 'A', 'sha256:x') } })[0]!.activeTimelineId).toBeNull()
  })

  it('ignores a probe answered by another Pi at the same address', () => {
    const [e] = mergeDevices([known('a', 'Alfa')], [], { a: { reachable: true, info: info('b', 'Beta', 'sha256:y') } })
    expect(e).toMatchObject({ name: 'Alfa', reachable: false, activeHash: null })
  })

  it('uses the last heartbeat only while the Pi does not answer live', () => {
    const reg = [registered(1, 'a', 'Alfa', { lastShowHash: 'sha256:old', lastShowName: 'Antic', lastShowTimelineId: 5 })]
    expect(mergeDevices([known('a', 'Alfa')], reg)[0]).toMatchObject({ activeHash: 'sha256:old', activeName: 'Antic', activeTimelineId: 5 })
    const live = mergeDevices([known('a', 'Alfa')], reg, { a: { reachable: true, info: info('a', 'Alfa', 'sha256:new', 'IDLE', 9) } })[0]
    expect(live).toMatchObject({ activeHash: 'sha256:new', activeTimelineId: 9 })
    expect(mergeDevices([], [registered(2, 'z', 'Z', { lastShowHash: 'sha256:z', lastShowTimelineId: 3 })])[0]!.activeTimelineId).toBe(3)
    expect(mergeDevices([], [registered(3, 'y', 'Y')])[0]!.activeTimelineId).toBeNull()
  })
})

describe('showSync', () => {
  const now = { hash: 'sha256:now', timelineId: 7 }
  it.each([
    ['this show as it is now', 'sha256:now', 7, true, 'current'],
    ['an older version of this timeline', 'sha256:old', 7, true, 'outdated'],
    ['another timeline', 'sha256:x', 8, true, 'other'],
    ['a show without timeline id (older player)', 'sha256:x', null, true, 'other'],
    ['the same show from an older player', 'sha256:now', null, true, 'current'],
    ['nothing', null, null, true, 'none'],
    ['not probed', 'sha256:now', 7, false, 'unknown']
  ] as const)('%s → %s', (_label, hash, timelineId, isKnown, expected) => {
    expect(showSync({ activeHash: hash, activeTimelineId: timelineId }, now, isKnown)).toBe(expected)
  })

  it('without the current hash (show with errors) only the timeline id can tell', () => {
    expect(showSync({ activeHash: 'sha256:a', activeTimelineId: 7 }, { hash: null, timelineId: 7 }, true)).toBe('outdated')
    expect(showSync({ activeHash: 'sha256:a', activeTimelineId: 8 }, { hash: null, timelineId: 7 }, true)).toBe('other')
  })

  it('an unsaved timeline (no id) never matches a device', () => {
    expect(showSync({ activeHash: 'sha256:a', activeTimelineId: null }, { hash: 'sha256:b', timelineId: null }, true)).toBe('other')
  })
})
