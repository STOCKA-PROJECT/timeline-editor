/** Stable client-side id generator for editor entities (layers, items, tracks, clips). */
export function nextId(prefix: string): string {
  const rand = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2)
  return `${prefix}-${rand}`
}
