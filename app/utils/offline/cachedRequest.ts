import type { KvStore } from '~/utils/offline/kvStore'

// "Network first, local copy as fallback" for the editor's reads. A successful answer is stored;
// when the network is down the last stored answer is returned instead. Real answers of the server
// (403, 404, 409…) are never masked by the cache: only failures to reach it fall back.

/** HTTP statuses that mean "the server (or the BFF in front of it) could not be reached". */
const UNREACHABLE_STATUSES = new Set([0, 502, 503, 504])

type MaybeHttpError = { response?: { status?: number }, status?: number, statusCode?: number, name?: string }

/** True when an error means the backend could not be reached (offline, DNS, gateway down). */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true // fetch() rejects with TypeError when offline
  const e = error as MaybeHttpError | null
  if (!e || typeof e !== 'object') return false
  const status = e.response?.status ?? e.status ?? e.statusCode
  if (status === undefined) return e.name === 'FetchError' || e.name === 'AbortError'
  return UNREACHABLE_STATUSES.has(status)
}

export interface StoredResponse<T> {
  data: T
  /** Epoch ms when it was fetched. */
  savedAt: number
}

export interface CachedResult<T> {
  data: T
  fromCache: boolean
  /** When the data was fetched from the server (now, or when it was cached). */
  savedAt: number
}

export interface CachedRequestOptions {
  now?: () => number
  /** Called with the outcome; lets the app track whether it is working offline. */
  onOutcome?: (outcome: 'network' | 'cache') => void
}

/** Thrown when the network is down and nothing was cached for that key. */
export class OfflineUnavailableError extends Error {
  constructor(readonly key: string, cause?: unknown) {
    super(`Sense connexió i sense còpia local de ${key}.`, { cause })
    this.name = 'OfflineUnavailableError'
  }
}

/**
 * Runs `fetcher`; on success stores the answer under `key` in the `responses` store, on a network
 * failure returns the stored answer (or throws {@link OfflineUnavailableError}). Any other error is
 * rethrown untouched.
 */
export async function cachedRequest<T>(
  kv: KvStore,
  key: string,
  fetcher: () => Promise<T>,
  options: CachedRequestOptions = {}
): Promise<CachedResult<T>> {
  const now = options.now ?? Date.now
  try {
    const data = await fetcher()
    const savedAt = now()
    // A failing write (quota, private mode) must not break the online path.
    await kv.put<StoredResponse<T>>('responses', key, { data, savedAt }).catch(() => undefined)
    options.onOutcome?.('network')
    return { data, fromCache: false, savedAt }
  } catch (error) {
    if (!isNetworkFailure(error)) throw error
    const stored = await kv.get<StoredResponse<T>>('responses', key).catch(() => undefined)
    if (!stored) throw new OfflineUnavailableError(key, error)
    options.onOutcome?.('cache')
    return { data: stored.data, fromCache: true, savedAt: stored.savedAt }
  }
}

/**
 * Same as {@link cachedRequest} for raw bytes (`blobs` store), but cache first: an attachment's
 * bytes never change (a new upload is a new attachment), so a stored copy is always valid.
 */
export async function cachedBytes(
  kv: KvStore,
  key: string,
  fetcher: () => Promise<ArrayBuffer>
): Promise<ArrayBuffer> {
  const stored = await kv.get<ArrayBuffer>('blobs', key).catch(() => undefined)
  if (stored) return stored
  try {
    const bytes = await fetcher()
    await kv.put('blobs', key, bytes).catch(() => undefined)
    return bytes
  } catch (error) {
    if (isNetworkFailure(error)) throw new OfflineUnavailableError(key, error)
    throw error
  }
}

/** Stable cache key of a GET: path plus its sorted query string. */
export function requestKey(path: string, query?: Record<string, string | number | boolean | undefined>): string {
  if (!query) return path
  const parts = Object.entries(query)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
  return parts.length ? `${path}?${parts.join('&')}` : path
}
