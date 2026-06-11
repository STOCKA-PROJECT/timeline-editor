import type { FetchOptions } from 'ofetch'
import type { User } from '~/types/api'

const AUTH_ENDPOINTS = ['/auth/exchange', '/auth/refresh']
const REFRESHABLE_ERROR_CODES = new Set(['auth.token_expired', 'auth.unauthenticated'])

type ApiErrorBody = { code?: string }
type ApiFetchError = { response?: { status?: number, _data?: ApiErrorBody } }

function requestUrl(req: unknown): string {
  if (typeof req === 'string') return req
  if (req instanceof URL) return req.toString()
  if (req instanceof Request) return req.url
  return ''
}

function isAuthEndpoint(url: string): boolean {
  return AUTH_ENDPOINTS.some(seg => url.includes(seg))
}

/** Single in-flight refresh shared by concurrent 401s. */
let refreshInFlight: Promise<boolean> | null = null

/**
 * HTTP client for the editor. Talks to the local BFF (`/api`), which proxies to the backend with
 * the access-token cookie. On a 401 with a refreshable code, rotates the session once and retries.
 */
export function useApi() {
  const auth = useAuthStore()
  const ssrCookie = import.meta.server ? useRequestHeaders(['cookie']).cookie : undefined

  const baseFetch = $fetch.create({
    baseURL: '/api',
    onRequest({ options }) {
      const headers = new Headers(options.headers as HeadersInit | undefined)
      if (!headers.has('Accept')) headers.set('Accept', 'application/problem+json, application/json')
      if (ssrCookie && !headers.has('cookie')) headers.set('cookie', ssrCookie)
      options.headers = headers
    }
  } satisfies FetchOptions)

  async function tryRefresh(): Promise<boolean> {
    if (import.meta.server) return false
    if (!refreshInFlight) {
      refreshInFlight = (async () => {
        try {
          const data = await baseFetch<{ user: User, expiresIn: number }>('/auth/refresh', { method: 'POST' })
          auth.setSession(data)
          return true
        } catch {
          return false
        } finally {
          refreshInFlight = null
        }
      })()
    }
    return refreshInFlight
  }

  return async <T>(
    url: Parameters<typeof baseFetch>[0],
    opts?: Parameters<typeof baseFetch>[1]
  ): Promise<T> => {
    try {
      return await baseFetch<T>(url, opts)
    } catch (err) {
      const error = err as ApiFetchError
      if (error.response?.status !== 401) throw err
      if (isAuthEndpoint(requestUrl(url))) throw err

      const code = error.response._data?.code
      if (code && !REFRESHABLE_ERROR_CODES.has(code)) throw err

      const refreshed = await tryRefresh()
      if (!refreshed) {
        auth.clearLocalSession()
        if (import.meta.client) navigateTo('/open')
        throw err
      }
      return await baseFetch<T>(url, opts)
    }
  }
}
