interface ExchangeBody {
  ticket: string
}

interface BackendLoginResponse {
  accessToken?: string
  expiresIn?: number
  user?: unknown
}

/**
 * BFF endpoint that exchanges a handoff ticket (minted by the main Stocka app) for this editor's
 * own session. Calls the backend's `POST /auth/handoff/exchange` and writes the BFF cookie pair.
 */
export default defineEventHandler(async (event) => {
  const body = await readBody<ExchangeBody>(event)
  const base = getBackendBaseUrl()

  let response: Awaited<ReturnType<typeof $fetch.raw<BackendLoginResponse>>>
  try {
    response = await $fetch.raw<BackendLoginResponse>(`${base}/auth/handoff/exchange`, {
      method: 'POST',
      body: { ticket: body?.ticket },
      headers: {
        'Accept-Language': getHeader(event, 'accept-language') ?? 'es'
      }
    })
  } catch (err) {
    return forwardBackendError(event, err)
  }

  const data = response._data
  if (!data || !data.accessToken || data.expiresIn == null) {
    return forwardBackendError(event, new Error('malformed backend response'))
  }
  const refresh = extractRefreshFromBackend(response.headers)
  if (!refresh) {
    return forwardBackendError(event, new Error('refresh cookie missing in backend response'))
  }

  setAuthCookies(event, data.accessToken, data.expiresIn, refresh.value, refresh.maxAge)
  return { user: data.user, expiresIn: data.expiresIn }
})
