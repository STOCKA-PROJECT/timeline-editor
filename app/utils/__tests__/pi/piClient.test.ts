import { describe, expect, it } from 'vitest'
import { normalizePiUrl, PiApiError, PiClient, targetAddressSpaceOf } from '~/utils/pi/piClient'

interface Call { url: string, method: string, headers: Record<string, string>, body?: unknown }

/** Scripted fetch: each handler answers one request in order; records every call. */
function scripted(handlers: Array<(call: Call) => Response | Promise<Response>>) {
  const calls: Call[] = []
  const fetch = async (url: string, init: RequestInit = {}) => {
    const call: Call = { url, method: init.method ?? 'GET', headers: init.headers as Record<string, string>, body: init.body }
    calls.push(call)
    const handler = handlers.shift()
    if (!handler) throw new Error(`unexpected request ${call.method} ${url}`)
    return handler(call)
  }
  return { fetch, calls }
}
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
const noSleep = async () => {}

describe('normalizePiUrl', () => {
  it.each([
    ['belen.local', 'http://belen.local:8080'],
    ['10.42.0.1', 'http://10.42.0.1:8080'],
    [' http://belen.local:8080/ ', 'http://belen.local:8080'],
    ['http://192.168.1.20:9000/api/info', 'http://192.168.1.20:9000'],
    ['https://pi.example', 'https://pi.example']
  ])('%s → %s', (input, expected) => {
    expect(normalizePiUrl(input)).toBe(expected)
  })

  it.each(['', '   ', 'ftp://x', 'http://'])('rejects %j', (input) => {
    expect(() => normalizePiUrl(input)).toThrow(PiApiError)
  })
})

describe('targetAddressSpaceOf', () => {
  it.each([
    ['http://belen.local:8080', 'local'],
    ['http://10.42.0.1:8080', 'local'],
    ['http://192.168.137.107:8080', 'local'],
    ['http://localhost:18080', undefined],
    ['http://127.0.0.1:8080', undefined],
    ['http://[::1]:8080', undefined],
    ['http://pi.localhost:8080', undefined]
  ])('%s → %s', (url, expected) => {
    expect(targetAddressSpaceOf(url)).toBe(expected)
  })

  it('the hint travels only to LAN addresses', async () => {
    const seen: unknown[] = []
    const fetch = async (_u: string, init?: RequestInit) => { seen.push((init as { targetAddressSpace?: string }).targetAddressSpace); return json(200, {}) }
    await new PiClient('belen.local', { fetch }).status()
    await new PiClient('localhost:18080', { fetch }).status()
    expect(seen).toEqual(['local', undefined])
  })
})

describe('PiClient requests', () => {
  it('reads without the PIN and parses JSON', async () => {
    const { fetch, calls } = scripted([() => json(200, { state: 'IDLE' })])
    const client = new PiClient('belen.local', { fetch })
    expect(await client.status()).toEqual({ state: 'IDLE' })
    expect(calls[0]!.url).toBe('http://belen.local:8080/api/status')
    expect(calls[0]!.headers.Authorization).toBeUndefined()
  })

  it('commands carry the PIN and the actor name', async () => {
    const { fetch, calls } = scripted([() => json(200, { state: 'PLAYING' })])
    const client = new PiClient('belen.local', { fetch, pin: '123456', name: 'Joan' })
    await client.play(2)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.headers).toMatchObject({ Authorization: 'Pin 123456', 'X-Name': 'Joan', 'Content-Type': 'application/json' })
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ cycles: 2 })
  })

  it('a command without PIN fails before reaching the Pi', async () => {
    const { fetch, calls } = scripted([])
    await expect(new PiClient('belen.local', { fetch }).stop()).rejects.toMatchObject({ status: 401, code: 'pin_required' })
    expect(calls).toHaveLength(0)
  })

  it('maps error bodies to PiApiError with code and body', async () => {
    const { fetch } = scripted([() => json(409, { error: 'busy', message: 'ocupat', extra: 1 })])
    const err = await new PiClient('x', { fetch, pin: '1' }).stop().catch(e => e)
    expect(err).toBeInstanceOf(PiApiError)
    expect(err).toMatchObject({ status: 409, code: 'busy', message: 'ocupat', body: { extra: 1 } })
    expect(err.unreachable).toBe(false)
  })

  it('an error without a JSON body still has a code', async () => {
    const { fetch } = scripted([() => new Response('nope', { status: 500 })])
    await expect(new PiClient('x', { fetch }).info()).rejects.toMatchObject({ status: 500, code: 'http_500' })
  })

  it('a network failure is an unreachable PiApiError', async () => {
    const fetch = async () => { throw new TypeError('Failed to fetch') }
    const err = await new PiClient('belen.local', { fetch }).info().catch(e => e)
    expect(err).toMatchObject({ status: 0, code: 'unreachable' })
    expect(err.unreachable).toBe(true)
    expect(err.message).toContain('http://belen.local:8080')
  })

  it('a Pi that never answers is given up after the timeout (unreachable)', async () => {
    const fetch = (_url: string, init: RequestInit = {}) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(init.signal!.reason))
    })
    const started = Date.now()
    const err = await new PiClient('belen.local', { fetch }).info().catch(e => e)
    expect(err).toMatchObject({ code: 'unreachable' })
    expect(Date.now() - started).toBeLessThan(6000)
  }, 10_000)

  it('every request carries an abort signal', async () => {
    const { fetch, calls } = scripted([() => json(200, {})])
    let signal: AbortSignal | undefined
    await new PiClient('x', { fetch: (u, init) => { signal = init?.signal ?? undefined; return fetch(u, init) } }).status()
    expect(signal).toBeInstanceOf(AbortSignal)
    expect(calls).toHaveLength(1)
  })

  it('checkPin: true on success, false on pin_invalid, rethrows the rest', async () => {
    const { fetch } = scripted([
      () => json(200, { authenticated: true }),
      () => json(401, { error: 'pin_invalid', message: 'x' }),
      () => json(429, { error: 'pin_locked', message: 'x' })
    ])
    const client = new PiClient('x', { fetch })
    expect(await client.checkPin('1')).toBe(true)
    expect(await client.checkPin('2')).toBe(false)
    await expect(client.checkPin('3')).rejects.toMatchObject({ code: 'pin_locked' })
  })

  it('assets: a Pi without the endpoint is assumed to have nothing', async () => {
    const { fetch } = scripted([() => json(404, { error: 'not_found', message: 'x' }), () => json(200, { audio: ['a.mp3'] })])
    const client = new PiClient('x', { fetch })
    expect(await client.assets()).toEqual({})
    expect(await client.assets()).toEqual({ audio: ['a.mp3'] })
  })

  it('logs and alerts unwrap their lists', async () => {
    const { fetch, calls } = scripted([() => json(200, { lines: ['l1'] }), () => json(200, {}), () => json(200, { alerts: [{ code: 'x' }] })])
    const client = new PiClient('x', { fetch })
    expect(await client.logs(50.4)).toEqual(['l1'])
    expect(calls[0]!.url).toContain('/api/logs?n=50')
    expect(await client.logs()).toEqual([])
    expect(await client.alerts()).toEqual([{ code: 'x' }])
  })

  it('unlockMotor and activate escape their path parts', async () => {
    const { fetch, calls } = scripted([() => json(200, {}), () => json(200, {})])
    const client = new PiClient('x', { fetch, pin: '1' })
    await client.unlockMotor('Àngel 1')
    await client.activate('sha256:ab')
    expect(calls[0]!.url).toContain('/api/motors/%C3%80ngel%201/unlock')
    expect(calls[1]!.url).toContain('/api/bundles/sha256%3Aab/activate')
  })
})

describe('PiClient.uploadBundle', () => {
  const bytes = new Uint8Array(Array.from({ length: 10 }, (_, i) => i))

  it('sends the pieces with Content-Range and finishes with activation', async () => {
    const { fetch, calls } = scripted([
      () => json(201, { uploadId: 'u1', received: 0 }),
      () => json(200, { received: 4 }),
      () => json(200, { received: 8 }),
      () => json(200, { received: 10 }),
      () => json(200, { ok: true, activated: true })
    ])
    const progress: number[] = []
    const report = await new PiClient('x', { fetch, pin: '1', sleep: noSleep }).uploadBundle(bytes, 'show.belen.zip', {
      activate: true, chunkBytes: 4, onProgress: p => progress.push(p.sent)
    })
    expect(report).toMatchObject({ ok: true, activated: true })
    expect(JSON.parse(String(calls[0]!.body))).toEqual({ name: 'show.belen.zip', size: 10 })
    expect(calls.slice(1, 4).map(c => c.headers['Content-Range'])).toEqual(['bytes 0-3/10', 'bytes 4-7/10', 'bytes 8-9/10'])
    expect(Array.from(calls[3]!.body as Uint8Array)).toEqual([8, 9])
    expect(calls[4]!.url).toContain('/api/uploads/u1/finish?activate=1')
    expect(progress).toEqual([0, 4, 8, 10])
  })

  it('without activation the finish has no query', async () => {
    const { fetch, calls } = scripted([
      () => json(201, { uploadId: 'u1', received: 0 }),
      () => json(200, { received: 10 }),
      () => json(200, { ok: true, activated: false })
    ])
    await new PiClient('x', { fetch, pin: '1' }).uploadBundle(bytes, 'a.zip', { chunkBytes: 100 })
    expect(calls[2]!.url.endsWith('/finish')).toBe(true)
  })

  it('follows the Pi when it reports another offset (409 bad_offset)', async () => {
    const { fetch, calls } = scripted([
      () => json(201, { uploadId: 'u1', received: 0 }),
      () => json(409, { error: 'bad_offset', message: 'x', received: 6 }),
      () => json(200, { received: 10 }),
      () => json(200, { ok: true })
    ])
    await new PiClient('x', { fetch, pin: '1' }).uploadBundle(bytes, 'a.zip', { chunkBytes: 100 })
    expect(calls[2]!.headers['Content-Range']).toBe('bytes 6-9/10')
  })

  it('retries a piece lost on the way, resuming where the Pi is', async () => {
    const { fetch, calls } = scripted([
      () => json(201, { uploadId: 'u1', received: 0 }),
      () => { throw new TypeError('network') },
      () => json(200, { uploadId: 'u1', received: 0 }),
      () => json(200, { received: 10 }),
      () => json(200, { ok: true })
    ])
    await new PiClient('x', { fetch, pin: '1', sleep: noSleep }).uploadBundle(bytes, 'a.zip', { chunkBytes: 100 })
    expect(calls[2]!.method).toBe('GET')
    expect(calls[3]!.headers['Content-Range']).toBe('bytes 0-9/10')
  })

  it('gives up after repeated failures', async () => {
    const failing = () => { throw new TypeError('network') }
    const { fetch } = scripted([
      () => json(201, { uploadId: 'u1', received: 0 }),
      ...Array.from({ length: 12 }, () => failing)
    ])
    await expect(new PiClient('x', { fetch, pin: '1', sleep: noSleep }).uploadBundle(bytes, 'a.zip')).rejects.toMatchObject({ code: 'unreachable' })
  })

  it('a refused piece (4xx other than bad_offset) is not retried', async () => {
    const { fetch, calls } = scripted([
      () => json(201, { uploadId: 'u1', received: 0 }),
      () => json(401, { error: 'pin_invalid', message: 'x' })
    ])
    await expect(new PiClient('x', { fetch, pin: '1', sleep: noSleep }).uploadBundle(bytes, 'a.zip')).rejects.toMatchObject({ code: 'pin_invalid' })
    expect(calls).toHaveLength(2)
  })
})

describe('PiClient.watch', () => {
  it('parses each status frame, skips malformed ones and closes', () => {
    let source: { onmessage: ((e: { data: string }) => void) | null, onerror: ((e: unknown) => void) | null, close: () => void, closed?: boolean } | null = null
    const client = new PiClient('belen.local', {
      eventSource: (url) => {
        expect(url).toBe('http://belen.local:8080/api/events')
        source = { onmessage: null, onerror: null, close() { this.closed = true } }
        return source
      }
    })
    const seen: string[] = []
    let errors = 0
    const stop = client.watch(s => seen.push(s.state), () => errors++)
    source!.onmessage!({ data: JSON.stringify({ state: 'IDLE' }) })
    source!.onmessage!({ data: '{broken' })
    source!.onmessage!({ data: JSON.stringify({ state: 'PLAYING' }) })
    source!.onerror!(new Event('error'))
    stop()
    expect(seen).toEqual(['IDLE', 'PLAYING'])
    expect(errors).toBe(1)
    expect(source!.closed).toBe(true)
  })
})

describe('syncClock', () => {
  it('posts this computer time without PIN while none is known', async () => {
    const { fetch, calls } = scripted([() => json(200, { reliable: true, source: 'client', now: '2026-10-23T18:30:00', adjusted: true, offsetMs: 5000 })])
    const result = await new PiClient('belen.local', { fetch }).syncClock(1_800_000_000_000)
    expect(result.adjusted).toBe(true)
    expect(calls[0]!.method).toBe('POST')
    expect(calls[0]!.url).toBe('http://belen.local:8080/api/clock')
    expect(JSON.parse(calls[0]!.body as string)).toEqual({ epochMs: 1_800_000_000_000 })
    expect(calls[0]!.headers.Authorization).toBeUndefined()
  })

  it('sends the PIN when it has one', async () => {
    const { fetch, calls } = scripted([() => json(200, { reliable: true, source: 'client', now: 'x', adjusted: false, offsetMs: 0 })])
    const client = new PiClient('belen.local', { fetch })
    client.pin = '123456'
    await client.syncClock()
    expect(calls[0]!.headers.Authorization).toBe('Pin 123456')
  })

  it('surfaces a 401 as PiApiError', async () => {
    const { fetch } = scripted([() => json(401, { error: 'pin_required', message: 'Hace falta el PIN' })])
    await expect(new PiClient('belen.local', { fetch }).syncClock()).rejects.toMatchObject({ status: 401, code: 'pin_required' })
  })
})
