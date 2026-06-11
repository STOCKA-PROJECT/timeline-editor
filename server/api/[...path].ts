import { proxyRequest } from 'h3'

/** Forwards every /api/** call to the backend, injecting the access token from the BFF cookie. */
export default defineEventHandler(async (event) => {
  const base = getBackendBaseUrl()
  const path = event.path.replace(/^\/api\/?/, '/')
  const target = `${base}${path}`

  const token = getCookie(event, 'stocka_token')
  const headers: Record<string, string> = {}
  if (token) headers.Authorization = `Bearer ${token}`

  // This is a server-to-server call, so drop the browser's Origin header before forwarding. The
  // backend applies browser CORS to requests that carry an Origin, and the editor's origin is not in
  // its allowlist — leaving it in makes the backend reject non-simple requests (e.g. the autosave
  // PUT) with 403 "Invalid CORS request" while simple GETs (which the browser sends without Origin)
  // still pass.
  if (event.node?.req?.headers) {
    delete event.node.req.headers.origin
  }

  return await proxyRequest(event, target, {
    headers,
    fetchOptions: { redirect: 'manual' }
  })
})
