const UNITS = ['B', 'kB', 'MB', 'GB'] as const
const formatter = new Intl.NumberFormat('ca', { maximumFractionDigits: 1 })

/** `3,8 MB`: decimal units with at most one decimal, Catalan separators; `—` when not a size. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000
    unit++
  }
  return `${formatter.format(unit === 0 ? Math.round(value) : value)} ${UNITS[unit]}`
}
