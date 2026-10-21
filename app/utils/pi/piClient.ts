// Client of the belén Raspberry Pi's local API (`rpi4-system/app/api/server.py`), used by the
// installed editor on the laptop. The Pi lives on the local network (`http://belen.local:8080`,
// `http://10.42.0.1:8080` on its own Wi-Fi): Chrome lets a secure page reach it after asking for
// the "local network access" permission; the Pi answers CORS for the editor's origins. Reads are
// public; commands carry the PIN in `Authorization: Pin <pin>` (no cookies across origins).

export const DEFAULT_PI_PORT = 8080
export const DEFAULT_PI_URLS = ['http://belen.local:8080', 'http://10.42.0.1:8080'] as const
/** Size of each piece of a resumable upload (the Pi accepts any size up to its limit). */
export const UPLOAD_CHUNK_BYTES = 1024 * 1024
const UPLOAD_RETRIES = 4
/** Ordinary requests: an address that does not answer is given up quickly. */
export const REQUEST_TIMEOUT_MS = 10_000
/** Finding the Pi (`info`): several candidate addresses are tried one after another. */
export const PROBE_TIMEOUT_MS = 4_000
/** A piece of an upload, or the import (the Pi verifies hashes and the show before answering). */
export const SLOW_TIMEOUT_MS = 120_000
const RETRY_DELAYS_MS = [500, 1000, 2000, 4000]

export type PiState = 'BOOT' | 'SAFE' | 'IDLE' | 'PLAYING' | 'TEST' | 'ERROR'

export interface PiInfo {
  apiVersion: number
  version: string
  simulate: boolean
  device: { deviceId: string, name: string, apSsid: string, apIp: string, netMode: string }
  board: string
  catalogVersion: number
  show: { hash: string | null, name: string | null }
  state: PiState
}

export interface PiAlert {
  code: string
  port: string | null
  message: string
  at: string
  [extra: string]: unknown
}

export interface PiSensor { active: boolean, raw: boolean | null, onActive: string, blocked: boolean, address: string }
export interface PiMotor {
  direction: 'forward' | 'reverse' | null
  runningS: number
  lastEnd: string | null
  locked: boolean
  blocked: boolean
  limitForward: string | null
  limitReverse: string | null
}

export interface PiStatus {
  state: PiState
  showHash: string | null
  showName: string | null
  durationMs: number | null
  cycle: number
  cyclesTarget: number | null
  cycleMs: number
  overrides: string[]
  hardware: Array<{ name: string, kind: string, off: boolean }>
  lastError: string | null
  sensors?: Record<string, PiSensor>
  motors?: Record<string, PiMotor>
  alerts?: PiAlert[]
  dmx?: { connected: boolean, error: string | null } | null
  [extra: string]: unknown
}

export interface PiBundles {
  active: string | null
  previous: string | null
  shows: Array<{ hash: string, name: string, size: number, importedAt: string, active: boolean, previous: boolean }>
}

export interface PiIssue { level?: string, code: string, message: string }

export interface PiImportReport {
  ok: boolean
  hash: string | null
  name: string | null
  errors: PiIssue[]
  warnings: PiIssue[]
  imported: string[]
  skipped: string[]
  activated: boolean
  activateError?: { error: string, message: string }
  [extra: string]: unknown
}

export interface UploadProgress { sent: number, total: number }

/** An error answer of the Pi (`{error, message}`), or a failure to reach it (`status` 0). */
export class PiApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string, readonly body?: Record<string, unknown>) {
    super(message)
    this.name = 'PiApiError'
  }

  /** The Pi could not be reached (wrong address, other network, permission denied). */
  get unreachable(): boolean {
    return this.status === 0
  }
}

/** `belen.local` → `http://belen.local:8080`; keeps an explicit scheme and port; drops the path. */
export function normalizePiUrl(input: string): string {
  const raw = input.trim()
  if (!raw) throw new PiApiError(0, 'bad_url', 'Escriu l’adreça de la Raspberry.')
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`
  let url: URL
  try {
    url = new URL(withScheme)
  } catch {
    throw new PiApiError(0, 'bad_url', `Adreça no vàlida: ${input}`)
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new PiApiError(0, 'bad_url', `Adreça no vàlida: ${input}`)
  const port = url.port || (url.protocol === 'http:' ? String(DEFAULT_PI_PORT) : '')
  return `${url.protocol}//${url.hostname}${port ? `:${port}` : ''}`
}

/**
 * Address space hint for Chrome's Local Network Access: `local` for the Pi on the LAN; nothing for
 * loopback (an SSH tunnel on `localhost`), where Chrome would refuse a `local` hint as a mismatch.
 */
export function targetAddressSpaceOf(baseUrl: string): 'local' | undefined {
  const host = new URL(baseUrl).hostname.replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host === '::1' || /^127\./.test(host)) return undefined
  return 'local'
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
type EventSourceLike = { onmessage: ((e: { data: string }) => void) | null, onerror: ((e: unknown) => void) | null, onopen?: ((e: unknown) => void) | null, close(): void }

export interface PiClientOptions {
  fetch?: FetchLike
  pin?: string | null
  /** Who acts, for the Pi's log (`X-Name`). */
  name?: string
  eventSource?: (url: string) => EventSourceLike
  sleep?: (ms: number) => Promise<void>
}

export class PiClient {
  readonly baseUrl: string
  pin: string | null
  private readonly fetchFn: FetchLike
  private readonly name: string
  private readonly eventSourceFn?: (url: string) => EventSourceLike
  private readonly sleep: (ms: number) => Promise<void>

  constructor(baseUrl: string, options: PiClientOptions = {}) {
    this.baseUrl = normalizePiUrl(baseUrl)
    this.pin = options.pin ?? null
    this.fetchFn = options.fetch ?? ((input, init) => globalThis.fetch(input, init))
    this.name = options.name ?? 'editor'
    this.eventSourceFn = options.eventSource
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)))
  }

  private async request<T>(method: string, path: string, init: { body?: BodyInit, json?: unknown, pin?: boolean, headers?: Record<string, string>, timeoutMs?: number } = {}): Promise<T> {
    const headers: Record<string, string> = { Accept: 'application/json', ...(init.headers ?? {}) }
    let body = init.body
    if (init.json !== undefined) {
      headers['Content-Type'] = 'application/json'
      body = JSON.stringify(init.json)
    }
    if (init.pin) {
      if (!this.pin) throw new PiApiError(401, 'pin_required', 'Cal el PIN de la Raspberry per a aquesta acció.')
      headers.Authorization = `Pin ${this.pin}`
      headers['X-Name'] = this.name
    }
    let response: Response
    try {
      // `targetAddressSpace` tells Chrome the request goes to the local network (Local Network Access);
      // other browsers ignore the unknown option. Loopback addresses must not carry it.
      const signal = AbortSignal.timeout(init.timeoutMs ?? REQUEST_TIMEOUT_MS)
      const space = targetAddressSpaceOf(this.baseUrl)
      response = await this.fetchFn(`${this.baseUrl}${path}`, { method, headers, body, signal, ...(space ? { targetAddressSpace: space } : {}) } as RequestInit)
    } catch (error) {
      throw new PiApiError(0, 'unreachable',
        `No s'ha pogut contactar amb la Raspberry a ${this.baseUrl}: comprova que el portàtil és a la mateixa xarxa i que Chrome té permís d'accés a la xarxa local.`,
        { cause: String(error) })
    }
    const text = await response.text()
    let data: unknown = null
    if (text) {
      try {
        data = JSON.parse(text)
      } catch {
        data = null
      }
    }
    if (!response.ok) {
      const err = (data && typeof data === 'object' ? data : {}) as Record<string, unknown>
      throw new PiApiError(response.status, String(err.error ?? `http_${response.status}`), String(err.message ?? `La Raspberry ha respost ${response.status}`), err)
    }
    return data as T
  }

  info(): Promise<PiInfo> { return this.request('GET', '/api/info', { timeoutMs: PROBE_TIMEOUT_MS }) }
  status(): Promise<PiStatus> { return this.request('GET', '/api/status') }
  bundles(): Promise<PiBundles> { return this.request('GET', '/api/bundles') }
  async assets(): Promise<Record<string, string[]>> {
    try {
      return await this.request<Record<string, string[]>>('GET', '/api/assets')
    } catch (error) {
      // A Pi older than the endpoint: assume it has nothing and send every file.
      if (error instanceof PiApiError && error.status === 404) return {}
      throw error
    }
  }

  async logs(lines = 200): Promise<string[]> {
    const data = await this.request<{ lines?: string[] }>('GET', `/api/logs?n=${Math.max(1, Math.round(lines))}`)
    return data.lines ?? []
  }

  async alerts(): Promise<PiAlert[]> {
    const data = await this.request<{ alerts?: PiAlert[] }>('GET', '/api/alerts')
    return data.alerts ?? []
  }

  /** Checks the PIN against the Pi (opens and forgets a session). */
  async checkPin(pin: string): Promise<boolean> {
    try {
      await this.request('POST', '/api/session', { json: { pin, name: this.name } })
      return true
    } catch (error) {
      if (error instanceof PiApiError && error.code === 'pin_invalid') return false
      throw error
    }
  }

  play(cycles?: number): Promise<PiStatus> { return this.request('POST', '/api/play', { json: cycles ? { cycles } : {}, pin: true }) }
  stop(): Promise<PiStatus> { return this.request('POST', '/api/stop', { json: {}, pin: true }) }
  panic(): Promise<PiStatus> { return this.request('POST', '/api/panic', { json: {}, pin: true }) }
  clearAlerts(): Promise<{ cleared: number }> { return this.request('DELETE', '/api/alerts', { pin: true }) }
  unlockMotor(motor: string): Promise<{ motor: string, unlocked: boolean }> {
    return this.request('POST', `/api/motors/${encodeURIComponent(motor)}/unlock`, { json: {}, pin: true })
  }

  activate(hash: string): Promise<PiStatus | Record<string, unknown>> {
    return this.request('POST', `/api/bundles/${encodeURIComponent(hash)}/activate`, { json: {}, pin: true })
  }

  /**
   * Uploads a `.belen.zip` in resumable pieces and imports it (`activate` makes it the active show
   * when the Pi is idle). A piece that fails to arrive is retried; when the Pi reports a different
   * offset (`409 bad_offset`) the upload continues from where the Pi actually is.
   */
  async uploadBundle(bytes: Uint8Array, name: string, options: { activate?: boolean, chunkBytes?: number, onProgress?: (p: UploadProgress) => void } = {}): Promise<PiImportReport> {
    const total = bytes.length
    const chunk = Math.max(1, options.chunkBytes ?? UPLOAD_CHUNK_BYTES)
    const created = await this.request<{ uploadId: string, received: number }>('POST', '/api/uploads', { json: { name, size: total }, pin: true })
    const id = encodeURIComponent(created.uploadId)
    let offset = created.received ?? 0
    options.onProgress?.({ sent: offset, total })
    let failures = 0
    while (offset < total) {
      const end = Math.min(offset + chunk, total) - 1
      try {
        const res = await this.request<{ received: number }>('PUT', `/api/uploads/${id}`, {
          body: bytes.slice(offset, end + 1),
          headers: { 'Content-Range': `bytes ${offset}-${end}/${total}`, 'Content-Type': 'application/octet-stream' },
          pin: true,
          timeoutMs: SLOW_TIMEOUT_MS
        })
        offset = res.received
        failures = 0
      } catch (error) {
        if (error instanceof PiApiError && error.code === 'bad_offset' && typeof error.body?.received === 'number') {
          offset = error.body.received
          continue
        }
        const retriable = error instanceof PiApiError && (error.unreachable || error.status >= 500)
        if (!retriable || failures >= UPLOAD_RETRIES) throw error
        await this.sleep(RETRY_DELAYS_MS[Math.min(failures, RETRY_DELAYS_MS.length - 1)]!)
        failures++
        // Ask the Pi where it is before resending.
        const state = await this.request<{ received: number }>('GET', `/api/uploads/${id}`).catch(() => null)
        if (state) offset = state.received
        continue
      }
      options.onProgress?.({ sent: offset, total })
    }
    return await this.request<PiImportReport>('POST', `/api/uploads/${id}/finish${options.activate ? '?activate=1' : ''}`, { json: {}, pin: true, timeoutMs: SLOW_TIMEOUT_MS })
  }

  /** Live status of the Pi (Server-Sent Events). Returns a function that closes the stream. */
  watch(onStatus: (status: PiStatus) => void, onError?: () => void): () => void {
    const factory = this.eventSourceFn ?? (url => new EventSource(url) as unknown as EventSourceLike)
    const source = factory(`${this.baseUrl}/api/events`)
    source.onmessage = (e) => {
      try {
        onStatus(JSON.parse(e.data) as PiStatus)
      } catch {
        // a malformed frame is skipped; the next one replaces it
      }
    }
    source.onerror = () => onError?.()
    return () => source.close()
  }
}
