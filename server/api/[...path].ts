import { getProxyRequestHeaders, readRawBody } from 'h3'

/** Methods whose request body is forwarded to the backend (same set h3's proxy uses). */
const PAYLOAD_METHODS = new Set(['PATCH', 'POST', 'PUT', 'DELETE'])

/**
 * Upstream response headers that describe the transport, not the content. `fetch` already decoded
 * the body, so `content-encoding` (and, with it, the `content-length` of the encoded bytes) would
 * lie; the rest are hop-by-hop.
 */
const TRANSPORT_HEADERS = ['content-encoding', 'transfer-encoding', 'connection', 'keep-alive']

/**
 * Proxy `/api/*` → backend, lifting the session cookie into `Authorization`.
 *
 * The upstream body is handed over as a web `Response` so that it streams. h3's `proxyRequest`
 * writes the body chunk by chunk with `res.write`, and on Cloudflare the response is a mock
 * (`node-mock-http`) that `Buffer.concat`s every chunk onto everything received so far: a multi-MB
 * cover served through `/content` (the lightbox, the board's images) costs gigabytes of copies and
 * the Worker dies with error 1102 ("exceeded resource limits"). Returning a `Response` takes h3's
 * `sendStream` path, which hands the `ReadableStream` to the runtime untouched. Same fix as the
 * main frontend's proxy (2026-10-27).
 */
export default defineEventHandler(async (event) => {
  const base = getBackendBaseUrl()
  const path = event.path.replace(/^\/api\/?/, '/')
  const target = `${base}${path}`

  const headers = new Headers()
  for (const [name, value] of Object.entries(getProxyRequestHeaders(event))) {
    if (typeof value === 'string') headers.set(name, value)
  }
  // This is a server-to-server call, so drop the browser's Origin header before forwarding. The
  // backend applies browser CORS to requests that carry an Origin, and the editor's origin is not
  // in its allowlist — leaving it in makes the backend reject non-simple requests (e.g. the
  // autosave PUT) with 403 "Invalid CORS request".
  headers.delete('origin')
  const token = getCookie(event, 'stocka_token')
  if (token) headers.set('authorization', `Bearer ${token}`)

  // Raw bytes (a Buffer) or nothing; typed as BodyInit because h3 declares a wider union.
  const body = PAYLOAD_METHODS.has(event.method)
    ? (await readRawBody(event, false).catch(() => undefined)) as BodyInit | undefined
    : undefined

  let upstream: Response
  try {
    upstream = await fetch(target, {
      method: event.method,
      headers,
      body,
      // A 302 from the backend (e.g. `/download`) must reach the browser as such.
      redirect: 'manual'
    })
  } catch (err) {
    return forwardBackendError(event, err)
  }

  const responseHeaders = new Headers(upstream.headers)
  if (responseHeaders.has('content-encoding')) responseHeaders.delete('content-length')
  for (const name of TRANSPORT_HEADERS) responseHeaders.delete(name)

  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers: responseHeaders
  })
})
