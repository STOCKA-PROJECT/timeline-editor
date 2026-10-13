import type { PieceAttributeValueResponseDto } from '~/types/api'

// Pieces on a LED strip: several pieces share one `led_strip` port, laid out one after the other
// along the strip in the order the scene keeps per port. Each piece takes as many LEDs as its own
// length attribute says; the export turns every piece into a segment of the strip (first/last
// absolute) so the player addresses them by name, and clips keep first/last relative to the piece.

/** Piece attributes that give the number of LEDs of the figure (technical or visible name). */
const LED_COUNT_ATTRS = new Set(['leds', 'led', 'num_leds', 'n_leds', 'led_count', 'longitud', 'length', 'pixels', 'nombre_de_led', 'nombre de led'])
const NUMERIC_TYPES = new Set(['INTEGER', 'DECIMAL', 'PRICE'])
const normalize = (s: string) => s.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '').trim()

/** LEDs of a piece according to its numeric length attribute (e.g. «Longitud»), or null when it has none. */
export function ledLengthFromAttributes(values: Pick<PieceAttributeValueResponseDto, 'attributeName' | 'displayName' | 'type' | 'value'>[] | undefined): number | null {
  for (const a of values ?? []) {
    if (!NUMERIC_TYPES.has(a.type) || a.value == null) continue
    if (LED_COUNT_ATTRS.has(normalize(a.attributeName)) || LED_COUNT_ATTRS.has(normalize(a.displayName ?? ''))) {
      const n = Math.round(Number(a.value))
      if (Number.isFinite(n) && n > 0) return n
    }
  }
  return null
}

/** Items assigned to a port in strip order: the ones the saved order knows first, then the rest as given. */
export function orderItems(assigned: string[], order: string[] | undefined): string[] {
  const set = new Set(assigned)
  const seen = new Set<string>()
  const known = (order ?? []).filter(id => set.has(id) && !seen.has(id) && seen.add(id))
  return [...known, ...assigned.filter(id => !seen.has(id))]
}

export interface StripSlot {
  offset: number
  /** LEDs of the piece; a piece without length takes what is left of the strip (0 when none). */
  length: number
  /** Whether the length came from the piece (false: the rest of the strip). */
  explicit: boolean
}

/** Position of every item along a strip of `stripLength` LEDs, in the given order. */
export function layoutStrip(itemIds: string[], lengthOf: (itemId: string) => number | null, stripLength: number | null): Map<string, StripSlot> {
  const out = new Map<string, StripSlot>()
  let offset = 0
  for (const id of itemIds) {
    const own = lengthOf(id)
    const length = own != null ? own : Math.max(0, (stripLength ?? 0) - offset)
    out.set(id, { offset, length, explicit: own != null })
    offset += length
  }
  return out
}

/** `base`, or `base #2`, `base #3`… until it is not in `taken` (which it then joins). */
export function uniqueName(base: string, taken: Set<string>): string {
  let name = base
  for (let n = 2; taken.has(name); n++) name = `${base} #${n}`
  taken.add(name)
  return name
}
