/**
 * Deterministic JSON: object keys sorted recursively, no whitespace, numbers and strings as
 * `JSON.stringify` writes them. Matches `tools/show_hash.py` in rpi4-system so both sides compute
 * the same show hash (Python normalizes integral floats to ints; `JSON.stringify` never writes
 * `10.0`, and neither escapes non-ASCII characters).
 */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value))
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key]
      if (v !== undefined) out[key] = sortKeys(v)
    }
    return out
  }
  return value
}

/** SHA-256 of a UTF-8 string as lowercase hex, via Web Crypto (browser and Node ≥ 20). */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text)
  const digest = await globalThis.crypto.subtle.digest('SHA-256', data)
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
