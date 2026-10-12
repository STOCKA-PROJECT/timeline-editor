/** The part of a clip that matters for collisions on a track. */
export interface ClipSpan {
  id?: string
  startMs: number
  durationMs: number
}

/** Free interval a clip may occupy on its track without overlapping its neighbours. */
export interface FreeRange {
  /** End of the closest clip that starts before this one (0 when there is none). */
  prevEnd: number
  /** Start of the closest clip that starts after this one (Infinity when there is none). */
  nextStart: number
  /** Smallest start the clip may take while keeping its duration. */
  minStart: number
  /** Largest start the clip may take while keeping its duration. */
  maxStart: number
}

const end = (c: ClipSpan) => c.startMs + c.durationMs

/**
 * Neighbours of `clip` among `others` (same track, the clip itself excluded by id), judged from
 * the clip's current position: a clip never jumps over another one while dragging, it stops at
 * the edge. The current position is always inside the range, so clips that already overlap in
 * older scenes can still be moved (just never made to overlap more).
 */
export function freeRange(clip: ClipSpan, others: ClipSpan[]): FreeRange {
  let prevEnd = 0
  let nextStart = Number.POSITIVE_INFINITY
  for (const o of others) {
    if (o.id != null && o.id === clip.id) continue
    if (o.startMs < clip.startMs || (o.startMs === clip.startMs && end(o) <= clip.startMs)) {
      prevEnd = Math.max(prevEnd, end(o))
    } else if (o.startMs >= clip.startMs && !(o.startMs === clip.startMs && end(o) <= clip.startMs)) {
      nextStart = Math.min(nextStart, o.startMs)
    }
  }
  return {
    prevEnd,
    nextStart,
    minStart: Math.min(prevEnd, clip.startMs),
    maxStart: Math.max(nextStart - clip.durationMs, clip.startMs)
  }
}

/** Snaps `value` to the closest target within `thresholdMs`, or returns it unchanged. */
export function snapTo(value: number, targets: number[], thresholdMs: number): number {
  let best = value
  let bestDist = thresholdMs
  for (const t of targets) {
    if (!Number.isFinite(t)) continue
    const d = Math.abs(t - value)
    if (d <= bestDist) {
      best = t
      bestDist = d
    }
  }
  return best
}

export interface MoveOptions {
  /** Grid the start is rounded to before snapping (ms). */
  gridMs?: number
  /** Magnetic distance for the snap targets (ms); 0 disables snapping. */
  snapMs?: number
  /** Extra positions the clip start or end may snap to (playhead, 0...). */
  snapTargets?: number[]
}

/**
 * Start of a dragged clip: rounded to the grid, magnetised to its neighbours' edges and the extra
 * targets, and clamped so it never overlaps the clips around it.
 */
export function constrainMove(clip: ClipSpan, others: ClipSpan[], desiredStart: number, opts: MoveOptions = {}): number {
  const { gridMs = 50, snapMs = 0, snapTargets = [] } = opts
  const range = freeRange(clip, others)
  let start = Math.max(0, gridMs > 0 ? Math.round(desiredStart / gridMs) * gridMs : desiredStart)
  if (snapMs > 0) {
    // The start may snap to a target, or the end may (then the start follows).
    const startTargets = [range.prevEnd, ...snapTargets]
    const endTargets = [range.nextStart, ...snapTargets].map(t => t - clip.durationMs)
    start = snapTo(start, [...startTargets, ...endTargets], snapMs)
  }
  return Math.min(range.maxStart, Math.max(range.minStart, start))
}

export interface ResizeOptions extends MoveOptions {
  /** Shortest allowed clip (ms). */
  minMs?: number
}

/**
 * Duration of a clip resized from its right edge: rounded to the grid, magnetised to the next
 * clip's start and the extra targets, never shorter than `minMs` nor reaching into the next clip.
 */
export function constrainResize(clip: ClipSpan, others: ClipSpan[], desiredDuration: number, opts: ResizeOptions = {}): number {
  const { gridMs = 50, snapMs = 0, snapTargets = [], minMs = 100 } = opts
  const range = freeRange(clip, others)
  let duration = gridMs > 0 ? Math.round(desiredDuration / gridMs) * gridMs : desiredDuration
  if (snapMs > 0) {
    const endTargets = [range.nextStart, ...snapTargets].map(t => t - clip.startMs)
    duration = snapTo(duration, endTargets, snapMs)
  }
  const maxDuration = Math.max(minMs, range.nextStart - clip.startMs)
  return Math.min(maxDuration, Math.max(minMs, duration))
}

/**
 * Where a new clip dropped at `atMs` fits on a track: null when `atMs` falls inside an existing
 * clip, otherwise the start (at `atMs`) and a duration cut down to the free space before the
 * next clip (never below `minMs`).
 */
export function fitNewClip(others: ClipSpan[], atMs: number, defaultMs: number, minMs = 100): ClipSpan | null {
  const startMs = Math.max(0, Math.round(atMs))
  if (others.some(o => o.startMs <= startMs && startMs < end(o))) return null
  const nextStart = others.filter(o => o.startMs > startMs).reduce((m, o) => Math.min(m, o.startMs), Number.POSITIVE_INFINITY)
  const room = nextStart - startMs
  if (room < minMs) return null
  return { startMs, durationMs: Math.min(defaultMs, room) }
}
