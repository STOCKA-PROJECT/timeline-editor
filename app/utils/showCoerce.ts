import type { CatalogParam } from '~/types/catalog'

// Turns the loosely typed values the editor holds (strings from inputs, numbers, arrays) into the
// exact JSON the Raspberry Pi controllers expect, following the catalog parameter type.

export type Rgb = [number, number, number]

export type CoerceResult =
  | { ok: true, value: unknown, omitted?: false }
  | { ok: true, value: undefined, omitted: true }
  | { ok: false, reason: 'required' | 'type' | 'range' | 'enum', expected: string }

const TYPE_LABEL: Record<CatalogParam['type'], string> = {
  int: 'un enter',
  number: 'un número',
  bool: 'un booleà',
  string: 'text',
  rgb: 'un color [r, g, b]',
  enum: 'un valor de la llista'
}

/** Parses a colour given as `[r,g,b]`, `"[r,g,b]"`, `"r,g,b"`, `"#rrggbb"` or `"#rgb"`. */
export function parseRgb(value: unknown): Rgb | null {
  if (Array.isArray(value)) {
    if (value.length !== 3) return null
    const out = value.map(c => (typeof c === 'string' && c.trim() !== '' ? Number(c) : c))
    return out.every(c => Number.isInteger(c) && c >= 0 && c <= 255) ? (out as Rgb) : null
  }
  if (typeof value !== 'string') return null
  const text = value.trim()
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(text)
  if (hex) {
    let h = hex[1]!
    if (h.length === 3) h = h.split('').map(c => c + c).join('')
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)]
  }
  const triple = /^\[?\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\]?$/.exec(text)
  if (!triple) return null
  const out = [Number(triple[1]), Number(triple[2]), Number(triple[3])]
  return out.every(c => c <= 255) ? (out as Rgb) : null
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

function withinBounds(spec: CatalogParam, n: number): boolean {
  return (spec.min === undefined || n >= spec.min) && (spec.max === undefined || n <= spec.max)
}

function rangeLabel(spec: CatalogParam): string {
  return `entre ${spec.min ?? '-∞'} i ${spec.max ?? '∞'}`
}

/** Coerces one value against its catalog parameter. Blank optionals are omitted. */
export function coerceParam(value: unknown, spec: CatalogParam): CoerceResult {
  if (isBlank(value)) {
    return spec.required ? { ok: false, reason: 'required', expected: TYPE_LABEL[spec.type] } : { ok: true, value: undefined, omitted: true }
  }
  switch (spec.type) {
    case 'int': {
      const n = toNumber(value)
      if (n === null || !Number.isInteger(n) || typeof value === 'boolean') return { ok: false, reason: 'type', expected: TYPE_LABEL.int }
      if (!withinBounds(spec, n)) return { ok: false, reason: 'range', expected: rangeLabel(spec) }
      return { ok: true, value: n }
    }
    case 'number': {
      const n = toNumber(value)
      if (n === null || typeof value === 'boolean') return { ok: false, reason: 'type', expected: TYPE_LABEL.number }
      if (!withinBounds(spec, n)) return { ok: false, reason: 'range', expected: rangeLabel(spec) }
      return { ok: true, value: n }
    }
    case 'bool': {
      if (typeof value === 'boolean') return { ok: true, value }
      if (value === 'true') return { ok: true, value: true }
      if (value === 'false') return { ok: true, value: false }
      return { ok: false, reason: 'type', expected: TYPE_LABEL.bool }
    }
    case 'string': {
      if (typeof value === 'string') return { ok: true, value: value.trim() }
      if (typeof value === 'number') return { ok: true, value: String(value) }
      return { ok: false, reason: 'type', expected: TYPE_LABEL.string }
    }
    case 'rgb': {
      const rgb = parseRgb(value)
      return rgb ? { ok: true, value: rgb } : { ok: false, reason: 'type', expected: TYPE_LABEL.rgb }
    }
    case 'enum': {
      if (typeof value === 'string' && spec.values?.includes(value)) return { ok: true, value }
      return { ok: false, reason: 'enum', expected: (spec.values ?? []).join(', ') }
    }
  }
}
