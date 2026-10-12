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
  /**
   * When true, clips may overlap (a piece can run several actions at once): the neighbours only
   * act as snap targets. When false, the clip is clamped so it never overlaps them.
   */
  allowOverlap?: boolean
}

/**
 * Start of a dragged clip: rounded to the grid, magnetised to its neighbours' edges and the extra
 * targets, and (unless overlapping is allowed) clamped so it never overlaps the clips around it.
 */
export function constrainMove(clip: ClipSpan, others: ClipSpan[], desiredStart: number, opts: MoveOptions = {}): number {
  const { gridMs = 50, snapMs = 0, snapTargets = [], allowOverlap = false } = opts
  const range = freeRange(clip, others)
  let start = Math.max(0, gridMs > 0 ? Math.round(desiredStart / gridMs) * gridMs : desiredStart)
  if (snapMs > 0) {
    // The start may snap to a target, or the end may (then the start follows).
    const startTargets = [range.prevEnd, ...snapTargets]
    const endTargets = [range.nextStart, ...snapTargets].map(t => t - clip.durationMs)
    start = Math.max(0, snapTo(start, [...startTargets, ...endTargets], snapMs))
  }
  if (allowOverlap) return start
  return Math.min(range.maxStart, Math.max(range.minStart, start))
}

export interface ResizeOptions extends MoveOptions {
  /** Shortest allowed clip (ms). */
  minMs?: number
}

/**
 * Duration of a clip resized from its right edge: rounded to the grid, magnetised to the next
 * clip's start and the extra targets, never shorter than `minMs` nor (unless overlapping is
 * allowed) reaching into the next clip.
 */
export function constrainResize(clip: ClipSpan, others: ClipSpan[], desiredDuration: number, opts: ResizeOptions = {}): number {
  const { gridMs = 50, snapMs = 0, snapTargets = [], minMs = 100, allowOverlap = false } = opts
  const range = freeRange(clip, others)
  let duration = gridMs > 0 ? Math.round(desiredDuration / gridMs) * gridMs : desiredDuration
  if (snapMs > 0) {
    const endTargets = [range.nextStart, ...snapTargets].map(t => t - clip.startMs)
    duration = snapTo(duration, endTargets, snapMs)
  }
  if (allowOverlap) return Math.max(minMs, duration)
  const maxDuration = Math.max(minMs, range.nextStart - clip.startMs)
  return Math.min(maxDuration, Math.max(minMs, duration))
}

/**
 * Sub-lane of every clip of a track so overlapping clips are drawn one under the other instead of
 * on top of each other: clips are taken in start order and each goes to the first lane whose last
 * clip ended before it starts (classic interval layout). Returns the lane per clip id and how many
 * lanes the track needs (at least 1).
 */
export function assignLanes(clips: ClipSpan[]): { lanes: Map<string, number>, count: number } {
  const lanes = new Map<string, number>()
  const laneEnds: number[] = []
  const ordered = [...clips].sort((a, b) => a.startMs - b.startMs || end(b) - end(a))
  for (const c of ordered) {
    let lane = laneEnds.findIndex(e => e <= c.startMs)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(0)
    }
    laneEnds[lane] = end(c)
    if (c.id != null) lanes.set(c.id, lane)
  }
  return { lanes, count: Math.max(1, laneEnds.length) }
}
