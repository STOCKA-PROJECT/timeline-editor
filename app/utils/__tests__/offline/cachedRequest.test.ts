import { describe, expect, it, vi } from 'vitest'
import { cachedBytes, cachedRequest, isNetworkFailure, OfflineUnavailableError, requestKey } from '~/utils/offline/cachedRequest'
import { MemoryKvStore, type KvStore } from '~/utils/offline/kvStore'

function httpError(status: number) {
  return Object.assign(new Error(`HTTP ${status}`), { name: 'FetchError', response: { status } })
}

describe('isNetworkFailure', () => {
  it.each([
    ['a TypeError from fetch', new TypeError('Failed to fetch'), true],
    ['an ofetch error without response', Object.assign(new Error('x'), { name: 'FetchError' }), true],
    ['an aborted request', Object.assign(new Error('x'), { name: 'AbortError' }), true],
    ['status 0', httpError(0), true],
    ['bad gateway', httpError(502), true],
    ['service unavailable', httpError(503), true],
    ['gateway timeout', httpError(504), true],
    ['a status on the error itself', { statusCode: 503 }, true],
    ['not found', httpError(404), false],
    ['forbidden', httpError(403), false],
    ['conflict', httpError(409), false],
    ['server error', httpError(500), false],
    ['a plain error', new Error('boom'), false],
    ['null', null, false],
    ['a string', 'offline', false]
  ])('%s → %s', (_label, error, expected) => {
    expect(isNetworkFailure(error)).toBe(expected)
  })
})

describe('cachedRequest', () => {
  it('online: returns the answer and stores it with its time', async () => {
    const kv = new MemoryKvStore()
    const outcomes: string[] = []
    const res = await cachedRequest(kv, 'k', async () => ({ a: 1 }), { now: () => 42, onOutcome: o => outcomes.push(o) })
    expect(res).toEqual({ data: { a: 1 }, fromCache: false, savedAt: 42 })
    expect(await kv.get('responses', 'k')).toEqual({ data: { a: 1 }, savedAt: 42 })
    expect(outcomes).toEqual(['network'])
  })

  it('offline: returns the last stored answer', async () => {
    const kv = new MemoryKvStore()
    await cachedRequest(kv, 'k', async () => ['first'], { now: () => 1 })
    const outcomes: string[] = []
    const res = await cachedRequest(kv, 'k', async () => { throw new TypeError('offline') }, { onOutcome: o => outcomes.push(o) })
    expect(res).toEqual({ data: ['first'], fromCache: true, savedAt: 1 })
    expect(outcomes).toEqual(['cache'])
  })

  it('offline without a stored answer: OfflineUnavailableError', async () => {
    const kv = new MemoryKvStore()
    await expect(cachedRequest(kv, 'missing', async () => { throw httpError(503) })).rejects.toBeInstanceOf(OfflineUnavailableError)
  })

  it('a real server answer is rethrown and never masked by the cache', async () => {
    const kv = new MemoryKvStore()
    await cachedRequest(kv, 'k', async () => 'cached')
    await expect(cachedRequest(kv, 'k', async () => { throw httpError(403) })).rejects.toMatchObject({ response: { status: 403 } })
  })

  it('a newer answer replaces the stored one', async () => {
    const kv = new MemoryKvStore()
    await cachedRequest(kv, 'k', async () => 'old', { now: () => 1 })
    await cachedRequest(kv, 'k', async () => 'new', { now: () => 2 })
    expect(await kv.get('responses', 'k')).toEqual({ data: 'new', savedAt: 2 })
  })

  it('a failing local write does not break the online answer', async () => {
    const kv: KvStore = { ...new MemoryKvStore(), get: vi.fn(), delete: vi.fn(), values: vi.fn(), put: vi.fn().mockRejectedValue(new Error('quota')) } as unknown as KvStore
    await expect(cachedRequest(kv, 'k', async () => 7)).resolves.toMatchObject({ data: 7, fromCache: false })
  })
})

describe('cachedBytes', () => {
  it('fetches once and then serves the stored bytes even online', async () => {
    const kv = new MemoryKvStore()
    const fetcher = vi.fn(async () => new Uint8Array([1, 2]).buffer)
    const a = await cachedBytes(kv, 'audio/1', fetcher)
    const b = await cachedBytes(kv, 'audio/1', fetcher)
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(Array.from(new Uint8Array(a))).toEqual([1, 2])
    expect(Array.from(new Uint8Array(b))).toEqual([1, 2])
  })

  it('offline without a copy: OfflineUnavailableError', async () => {
    await expect(cachedBytes(new MemoryKvStore(), 'x', async () => { throw new TypeError('offline') })).rejects.toBeInstanceOf(OfflineUnavailableError)
  })

  it('other errors are rethrown', async () => {
    await expect(cachedBytes(new MemoryKvStore(), 'x', async () => { throw httpError(404) })).rejects.toMatchObject({ response: { status: 404 } })
  })
})

describe('requestKey', () => {
  it('is the path alone without a query', () => {
    expect(requestKey('/a')).toBe('/a')
    expect(requestKey('/a', {})).toBe('/a')
  })

  it('sorts the query and drops undefined values', () => {
    expect(requestKey('/p', { size: 200, sort: 'name,asc', page: undefined })).toBe('/p?size=200&sort=name%2Casc')
    expect(requestKey('/p', { b: 1, a: true })).toBe(requestKey('/p', { a: true, b: 1 }))
  })
})
