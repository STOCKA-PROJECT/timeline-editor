interface BackendRefreshResponse {
  accessToken: string
  expiresIn: number
  user: unknown
}

/** Rotates the refresh token (same scheme as the main app's BFF). */
export default defineEventHandler(async (event) => {
  const base = getBackendBaseUrl()
  const refreshCookie = getRefreshCookie(event)

  if (!refreshCookie) {
    clearAuthCookies(event)
    setResponseStatus(event, 401, 'Unauthorized')
    setResponseHeader(event, 'content-type', 'application/problem+json')
    return {
      type: 'about:blank',
      title: 'Unauthorized',
      status: 401,
      code: 'auth.refresh_token_missing',
      detail: 'No hay sesión activa para refrescar.'
    }
  }

  let response: Awaited<ReturnType<typeof $fetch.raw<BackendRefreshResponse>>>
  try {
    response = await $fetch.raw<BackendRefreshResponse>(`${base}/auth/refresh`, {
      method: 'POST',
      headers: {
        'Accept-Language': getHeader(event, 'accept-language') ?? 'es',
        cookie: `stocka_refresh=${refreshCookie}`
      }
    })
  } catch (err) {
    clearAuthCookies(event)
    return forwardBackendError(event, err)
  }

  const data = response._data
  if (!data) {
    clearAuthCookies(event)
    return forwardBackendError(event, new Error('empty backend response'))
  }
  const rotated = extractRefreshFromBackend(response.headers)
  if (!rotated) {
    clearAuthCookies(event)
    return forwardBackendError(event, new Error('refresh cookie missing in backend response'))
  }

  setAuthCookies(event, data.accessToken, data.expiresIn, rotated.value, rotated.maxAge)
  return { user: data.user, expiresIn: data.expiresIn }
})
