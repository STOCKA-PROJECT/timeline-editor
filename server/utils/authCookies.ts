import type { H3Event } from 'h3'
import { setCookie, deleteCookie, getCookie } from 'h3'

/**
 * BFF cookies that mirror the backend session pair (same scheme as the main Stocka app, scoped to
 * this editor's origin).
 *
 * - `stocka_token` carries the short-lived access token. Path=/ so the `/api/[...path].ts` proxy can
 *   lift it into the Authorization header for every backend call.
 * - `stocka_refresh` carries the refresh token. Path=/api/auth so it only travels with /api/auth/*.
 */

const ACCESS_COOKIE = 'stocka_token'
const REFRESH_COOKIE = 'stocka_refresh'
const REFRESH_PATH = '/api/auth'

function parseSetCookie(headerValue: string, name: string): { value: string, maxAge?: number } | null {
  const parts = headerValue.split(';').map(p => p.trim())
  const first = parts[0]
  if (!first || !first.startsWith(name + '=')) return null
  const value = first.slice(name.length + 1)
  let maxAge: number | undefined
  for (let i = 1; i < parts.length; i++) {
    const part = parts[i]!
    const eq = part.indexOf('=')
    const key = (eq === -1 ? part : part.slice(0, eq)).toLowerCase()
    if (key === 'max-age') {
      const raw = part.slice(eq + 1)
      const parsed = Number.parseInt(raw, 10)
      if (Number.isFinite(parsed)) maxAge = parsed
    }
  }
  return { value, maxAge }
}

export function extractCookieFromBackend(headers: Headers, name: string): { value: string, maxAge?: number } | null {
  const headersWithList = headers as Headers & { getSetCookie?: () => string[] }
  const allCookies: string[] = headersWithList.getSetCookie ? headersWithList.getSetCookie() : []
  if (allCookies.length === 0) {
    const single = headers.get('set-cookie')
    if (single) allCookies.push(single)
  }
  for (const cookie of allCookies) {
    const parsed = parseSetCookie(cookie, name)
    if (parsed) return parsed
  }
  return null
}

export function extractRefreshFromBackend(headers: Headers): { value: string, maxAge?: number } | null {
  return extractCookieFromBackend(headers, REFRESH_COOKIE)
}

export function setAuthCookies(
  event: H3Event,
  accessToken: string,
  accessExpiresInMs: number,
  refreshToken: string,
  refreshMaxAgeSeconds: number | undefined
): void {
  setCookie(event, ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'strict',
    maxAge: Math.max(60, Math.floor(accessExpiresInMs / 1000)),
    path: '/'
  })
  setCookie(event, REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: !import.meta.dev,
    sameSite: 'lax',
    maxAge: refreshMaxAgeSeconds,
    path: REFRESH_PATH
  })
}

export function getRefreshCookie(event: H3Event): string | undefined {
  return getCookie(event, REFRESH_COOKIE)
}

export function getAccessCookie(event: H3Event): string | undefined {
  return getCookie(event, ACCESS_COOKIE)
}

export function clearAuthCookies(event: H3Event): void {
  deleteCookie(event, ACCESS_COOKIE, { path: '/' })
  deleteCookie(event, REFRESH_COOKIE, { path: REFRESH_PATH })
}
