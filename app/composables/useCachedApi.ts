import { cachedBytes, cachedRequest, requestKey } from '~/utils/offline/cachedRequest'

type Query = Record<string, string | number | boolean | undefined>

/**
 * Reads through the BFF with a local copy behind them: online the answer is stored, offline the
 * stored answer comes back (see `cachedRequest`). Attachment bytes are cached forever (`cachedBytes`).
 */
export function useCachedApi() {
  const api = useApi()
  const connectivity = useConnectivityStore()

  async function get<T>(path: string, query?: Query): Promise<T> {
    const kv = await useOfflineDb()
    const res = await cachedRequest<T>(kv, requestKey(path, query), () => api<T>(path, query ? { query } : undefined), {
      onOutcome: connectivity.report
    })
    return res.data
  }

  /** Bytes of a same-origin URL (`/api/...`), from the local copy when there is one. */
  async function bytes(url: string): Promise<ArrayBuffer> {
    const kv = await useOfflineDb()
    return await cachedBytes(kv, url, () => api<ArrayBuffer>(url.replace(/^\/api/, ''), { responseType: 'arrayBuffer' }))
  }

  return { get, bytes }
}
