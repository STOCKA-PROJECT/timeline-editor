import type { LedPoint, SceneItem } from '~/types/editor'

// Where the LEDs of a piece sit on the board. An item keeps a polyline in fractions of its own size
// (`SceneItem.ledPath`) and its N LEDs are spread evenly along it, LED 0 at the first point. Pure
// geometry: the board draws the dots along it and the inspector offers the presets.

export interface Point {
  x: number
  y: number
}

export type LedPathPreset = 'horizontal' | 'vertical' | 'bottom' | 'perimeter'

/** Ready-made paths, in fractions of the item's size. */
export const LED_PATH_PRESETS: Record<LedPathPreset, LedPoint[]> = {
  horizontal: [{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }],
  vertical: [{ x: 0.5, y: 0 }, { x: 0.5, y: 1 }],
  bottom: [{ x: 0, y: 1 }, { x: 1, y: 1 }],
  perimeter: [{ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }]
}

export const LED_PATH_PRESET_LABELS: Record<LedPathPreset, string> = {
  horizontal: 'Horitzontal',
  vertical: 'Vertical',
  bottom: 'Vora inferior',
  perimeter: 'Perímetre'
}

/** A fresh copy of a preset, safe to store in the scene. */
export function presetPath(name: LedPathPreset): LedPoint[] {
  return LED_PATH_PRESETS[name].map(p => ({ ...p }))
}

/** The path of an item: its own, or the default (a line across the middle, left to right). */
export function ledPathOf(item: Pick<SceneItem, 'ledPath'>): LedPoint[] {
  return item.ledPath?.length ? item.ledPath : LED_PATH_PRESETS.horizontal
}

const samePoint = (a: LedPoint, b: LedPoint) => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6

/** Name of the preset a path matches, or null for a custom one. */
export function presetOfPath(path: LedPoint[]): LedPathPreset | null {
  for (const [name, preset] of Object.entries(LED_PATH_PRESETS)) {
    if (preset.length === path.length && preset.every((p, i) => samePoint(p, path[i]!))) return name as LedPathPreset
  }
  return null
}

/** Same path, LED 0 at the other end. */
export function reverseLedPath(path: LedPoint[]): LedPoint[] {
  return [...path].reverse()
}

/** Length in pixels of the path scaled to an item of `width` × `height`. */
export function pathLength(path: LedPoint[], width: number, height: number): number {
  let total = 0
  for (let i = 1; i < path.length; i++) {
    total += Math.hypot((path[i]!.x - path[i - 1]!.x) * width, (path[i]!.y - path[i - 1]!.y) * height)
  }
  return total
}

/**
 * Centre of every LED, in item pixels: `count` LEDs spread evenly along the path scaled to
 * `width` × `height`, each in the middle of its slot. A path without length puts them all on its
 * first point.
 */
export function ledPositions(path: LedPoint[], count: number, width: number, height: number): Point[] {
  const pts = path.map(p => ({ x: p.x * width, y: p.y * height }))
  if (pts.length === 0 || count <= 0) return []
  const lengths = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i]!.x, p.y - pts[i]!.y))
  const total = lengths.reduce((a, b) => a + b, 0)
  if (total === 0) return Array.from({ length: count }, () => ({ ...pts[0]! }))
  const out: Point[] = []
  let seg = 0
  let passed = 0
  for (let i = 0; i < count; i++) {
    const d = (total * (i + 0.5)) / count
    while (seg < lengths.length - 1 && passed + lengths[seg]! < d) passed += lengths[seg++]!
    const f = lengths[seg]! > 0 ? Math.min(1, (d - passed) / lengths[seg]!) : 0
    const a = pts[seg]!
    const b = pts[seg + 1]!
    out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f })
  }
  return out
}

/** Item pixels → board pixels (the item's position and rotation applied, as the board draws it). */
export function itemToBoard(p: Point, item: Pick<SceneItem, 'x' | 'y' | 'rotation'>): Point {
  const r = (item.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  return { x: item.x + p.x * cos - p.y * sin, y: item.y + p.x * sin + p.y * cos }
}

const round3 = (n: number) => Math.round(n * 1000) / 1000

/** Board pixels → fraction of the item's size (the inverse of {@link itemToBoard}), for a clicked point. */
export function boardToItemFraction(p: Point, item: Pick<SceneItem, 'x' | 'y' | 'rotation' | 'width' | 'height'>): LedPoint {
  const r = (-item.rotation * Math.PI) / 180
  const cos = Math.cos(r)
  const sin = Math.sin(r)
  const dx = p.x - item.x
  const dy = p.y - item.y
  return { x: round3((dx * cos - dy * sin) / item.width), y: round3((dx * sin + dy * cos) / item.height) }
}
