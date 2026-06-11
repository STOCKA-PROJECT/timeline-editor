import { FetchError } from 'ofetch'
import type { H3Event } from 'h3'
import { setResponseStatus, setResponseHeader } from 'h3'

/**
 * Forwards a backend error to the client preserving status and the ProblemDetail body (so
 * `code` is readable client-side). Return (don't throw) the result from a handler.
 */
export function forwardBackendError(event: H3Event, err: unknown): unknown {
  if (err instanceof FetchError && err.statusCode) {
    const body = err.data ?? err.response?._data ?? null
    setResponseStatus(event, err.statusCode, err.statusMessage)
    const upstreamType = err.response?.headers.get('content-type') ?? 'application/problem+json'
    setResponseHeader(event, 'content-type', upstreamType)
    return body
  }

  console.error('[backend] upstream error:', err)
  setResponseStatus(event, 502, 'Bad Gateway')
  setResponseHeader(event, 'content-type', 'application/problem+json')
  return {
    type: 'about:blank',
    title: 'Bad Gateway',
    status: 502,
    code: 'gateway.upstream_unreachable',
    detail: 'No se ha podido contactar con el servidor.'
  }
}
