import { describe, expect, it } from 'vitest'
import {
  applyPending,
  deviceEntries,
  entryKey,
  isSameDevice,
  matchRegistered,
  parsePendingConnections,
  queueConnection,
  showSync,
  type RegisteredDevice
} from '~/utils/pi/deviceRegistry'
import type { PiInfo } from '~/utils/pi/piClient'

function info(deviceId: string, name: string, hash: string | null = null, state: PiInfo['state'] = 'IDLE', timelineId?: number | null): PiInfo {
  return {
    apiVersion: 1, version: 't', simulate: false, board: 'rpi4b', catalogVersion: 3, state,
    device: { deviceId, name, apSsid: 'belen', apIp: '10.42.0.1', netMode: 'ap' },
    show: { hash, name: hash ? 'Pessebre' : null, ...(timelineId !== undefined ? { timelineId } : {}) }
  }
}
const registered = (id: number, deviceId: string | null, name: string, patch: Partial<RegisteredDevice> = {}): RegisteredDevice =>
  ({ id, deviceId, name, online: false, lastSeenAt: null, lastShowHash: null, lastShowName: null, ...patch })
const BELEN = 'http://belen.local:8080'
const AP = 'http://10.42.0.1:8080'

describe('isSameDevice / matchRegistered', () => {
  it('a bound device is only its own Pi; an unbound one takes any', () => {
    expect(isSameDevice({ deviceId: 'a' }, info('a', 'A'))).toBe(true)
    expect(isSameDevice({ deviceId: 'a' }, info('b', 'B'))).toBe(false)
    expect(isSameDevice({ deviceId: null }, info('b', 'B'))).toBe(true)
  })

  it('matches by uuid first, wherever it answered', () => {
    const list = [registered(1, null, 'Sense id', { localUrl: AP }), registered(2, 'a', 'Badia', { localUrl: BELEN })]
    expect(matchRegistered(list, info('a', 'Badia'), AP)?.id).toBe(2)
  })

  it('falls back to an unbound device saved at that address', () => {
    const list = [registered(1, null, 'Sense id', { localUrl: AP }), registered(2, 'z', 'Altre', { localUrl: AP })]
    expect(matchRegistered(list, info('a', 'Nova'), AP)?.id).toBe(1)
  })

  it('finds nothing for an unknown Pi at another address, or when the device at that address is bound to another Pi', () => {
    expect(matchRegistered([registered(1, null, 'X', { localUrl: AP })], info('a', 'A'), BELEN)).toBeNull()
    expect(matchRegistered([registered(1, 'z', 'X', { localUrl: AP })], info('a', 'A'), AP)).toBeNull()
    expect(matchRegistered([registered(1, null, 'X')], info('a', 'A'), AP)).toBeNull()
  })
})

describe('deviceEntries', () => {
  it('lists every saved device with its address and PIN, keyed by its Stocka id', () => {
    const [e] = deviceEntries([registered(9, null, 'Nova', { localUrl: BELEN, pin: '123456', online: true })])
    expect(e).toMatchObject({ key: entryKey(9), id: 9, url: BELEN, pin: '123456', cloudOnline: true, reachable: null, deviceId: null })
  })

  it('a PIN typed in this session wins over the saved one', () => {
    const [e] = deviceEntries([registered(1, 'a', 'A', { localUrl: BELEN, pin: '111111' })], {}, { [entryKey(1)]: '222222' })
    expect(e!.pin).toBe('222222')
  })

  it('without address there is nothing to probe: reachable stays null and old probes are ignored', () => {
    const [e] = deviceEntries([registered(1, 'a', 'A', { localUrl: null })], { [entryKey(1)]: { reachable: true, info: info('a', 'A') } })
    expect(e).toMatchObject({ url: null, reachable: null, state: null })
  })

  it('reachable devices come first, then the ones with an address, then the ones without', () => {
    const entries = deviceEntries(
      [registered(1, 'a', 'Alfa', { localUrl: AP }), registered(2, 'b', 'Beta', { localUrl: BELEN }), registered(3, 'z', 'Zero')],
      { [entryKey(2)]: { reachable: true, info: info('b', 'Beta') }, [entryKey(1)]: { reachable: false, info: null } })
    expect(entries.map(e => e.name)).toEqual(['Beta', 'Alfa', 'Zero'])
    expect(entries.map(e => e.reachable)).toEqual([true, false, null])
  })

  it('takes show and state from a live probe of the same Pi but keeps the name saved in Stocka', () => {
    const [e] = deviceEntries([registered(1, 'a', 'Pessebre gran', { localUrl: BELEN })],
      { [entryKey(1)]: { reachable: true, info: info('a', 'belen', 'sha256:x', 'PLAYING', 12) } })
    expect(e).toMatchObject({ name: 'Pessebre gran', reachable: true, activeHash: 'sha256:x', activeName: 'Pessebre', activeTimelineId: 12, state: 'PLAYING' })
    const [old] = deviceEntries([registered(1, 'a', 'A', { localUrl: BELEN })], { [entryKey(1)]: { reachable: true, info: info('a', 'A', 'sha256:x') } })
    expect(old!.activeTimelineId).toBeNull()
  })

  it('learns the uuid of an unbound device from its live probe', () => {
    const [e] = deviceEntries([registered(1, null, 'A', { localUrl: BELEN })], { [entryKey(1)]: { reachable: true, info: info('uuid-a', 'A') } })
    expect(e).toMatchObject({ deviceId: 'uuid-a', reachable: true, otherAtUrl: null })
  })

  it('reports another Pi answering at the saved address as not reachable, naming it', () => {
    const [e] = deviceEntries([registered(1, 'a', 'Alfa', { localUrl: BELEN, lastShowHash: 'sha256:old' })],
      { [entryKey(1)]: { reachable: true, info: info('b', 'Beta', 'sha256:y') } })
    expect(e).toMatchObject({ reachable: false, otherAtUrl: 'Beta', activeHash: 'sha256:old', state: null })
  })

  it('uses the last heartbeat only while the Pi does not answer live', () => {
    const reg = [registered(1, 'a', 'Alfa', { localUrl: BELEN, lastShowHash: 'sha256:old', lastShowName: 'Antic', lastShowTimelineId: 5 })]
    expect(deviceEntries(reg)[0]).toMatchObject({ activeHash: 'sha256:old', activeName: 'Antic', activeTimelineId: 5 })
    expect(deviceEntries(reg, { [entryKey(1)]: { reachable: false, info: null } })[0]).toMatchObject({ activeHash: 'sha256:old', reachable: false })
    const live = deviceEntries(reg, { [entryKey(1)]: { reachable: true, info: info('a', 'Alfa', 'sha256:new', 'IDLE', 9) } })[0]
    expect(live).toMatchObject({ activeHash: 'sha256:new', activeTimelineId: 9 })
    expect(deviceEntries([registered(3, 'y', 'Y')])[0]!.activeTimelineId).toBeNull()
  })

  it('works with an older backend that sends no address nor PIN', () => {
    const [e] = deviceEntries([registered(1, 'a', 'A')])
    expect(e).toMatchObject({ url: null, pin: null })
  })
})

describe('pending connections', () => {
  it('queues changes per device, later values winning', () => {
    let pending = queueConnection({}, 1, { localUrl: BELEN })
    pending = queueConnection(pending, 1, { pin: '123456' })
    pending = queueConnection(pending, 1, { localUrl: AP })
    pending = queueConnection(pending, 2, { deviceId: 'b' })
    expect(pending).toEqual({ 1: { localUrl: AP, pin: '123456' }, 2: { deviceId: 'b' } })
  })

  it('reads a stored queue and drops malformed entries and fields', () => {
    const raw = JSON.stringify({ 1: { localUrl: AP, pin: 5, extra: 'x' }, abc: { pin: '1' }, 2: 'no', 3: {}, 4: { deviceId: 'd' } })
    expect(parsePendingConnections(raw)).toEqual({ 1: { localUrl: AP }, 4: { deviceId: 'd' } })
  })

  it.each([null, '', 'no json', '[1]', '7'])('reads nothing from %j', (raw) => {
    expect(parsePendingConnections(raw)).toEqual({})
  })

  it('shows the devices as they will be once the queue reaches Stocka', () => {
    const list = [registered(1, null, 'A', { localUrl: BELEN, pin: '111111', hasPin: true }), registered(2, 'b', 'B')]
    const out = applyPending(list, { 1: { localUrl: AP, pin: '', deviceId: 'a' } })
    expect(out[0]).toMatchObject({ localUrl: AP, pin: null, hasPin: false, deviceId: 'a' })
    expect(out[1]).toBe(list[1])
    expect(applyPending(list, { 1: { localUrl: '' } })[0]).toMatchObject({ localUrl: null, pin: '111111' })
    expect(applyPending(list, { 1: { pin: '222222' } })[0]).toMatchObject({ pin: '222222', hasPin: true, localUrl: BELEN })
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
