import { animationRange, createLedAnimation, createLedFill, type LedAnimator, type Rgb } from '~/utils/ledPreview'

// What the LEDs of one piece show at a moment of the timeline, from its clips, following the
// device: `fill` paints its range and stays, `clear` turns the piece off, `animate` runs either a
// continuous animation (the piece goes off when it ends) or a transition (fade, sunrise, sunset)
// that keeps its final colour. Later clips paint over earlier ones.

/** A LED clip reduced to what the simulation needs. */
export interface LedClipSpec {
  id: string
  startMs: number
  durationMs: number
  action: 'animate' | 'fill' | 'clear'
  animation: string | null
  /** Parameters coerced to catalog values (colours as `[r, g, b]`). */
  params: Record<string, unknown>
  /** Sub-range of the piece the action applies to (0-based, relative to the piece). */
  first: number | null
  last: number | null
  /** Clip length in seconds when the action has a duration parameter (the length of a transition). */
  durationSec: number | null
}

export interface LedTarget {
  /** Colours of the LEDs at `atMs` given the clips of the piece (any order), LED 0 first. */
  frameAt(clips: LedClipSpec[], atMs: number): Rgb[]
}

const TRANSITIONS = new Set(['fade', 'sunrise', 'sunset'])
const BLACK: Rgb = [0, 0, 0]
/** Animators accept at most half a second per step. */
const MAX_STEP_SEC = 0.5

interface Running {
  key: string
  animator: LedAnimator
  /** Position inside the clip the animator has been advanced to. */
  atMs: number
}

function colourOf(params: Record<string, unknown>): Rgb {
  const c = params.color
  return Array.isArray(c) && c.length === 3 ? (c as Rgb) : BLACK
}

/** Paints `frame` over `out` from LED `start` on. */
function paint(out: Rgb[], frame: Rgb[], start: number) {
  frame.forEach((c, i) => { if (start + i < out.length) out[start + i] = c })
}

/** Simulates the `ledCount` LEDs of one piece. Keeps one animator per clip, advanced as time goes on. */
export function createLedTarget(ledCount: number): LedTarget {
  const running = new Map<string, Running>()

  /** The animator of a clip advanced to `clipMs`; rebuilt when the clip changed or time went backwards. */
  function animatorAt(spec: LedClipSpec, clipMs: number): LedAnimator | null {
    const key = JSON.stringify([spec.action, spec.animation, spec.params, spec.first, spec.last, spec.durationSec])
    let r = running.get(spec.id)
    if (!r || r.key !== key || clipMs < r.atMs) {
      const opts = { pixels: ledCount, durationSec: spec.durationSec, first: spec.first, last: spec.last }
      const animator = spec.action === 'animate'
        ? (spec.animation ? createLedAnimation(spec.animation, spec.params, opts) : null)
        : createLedFill(spec.action === 'fill' ? colourOf(spec.params) : BLACK, opts)
      if (!animator) {
        running.delete(spec.id)
        return null
      }
      r = { key, animator, atMs: 0 }
      running.set(spec.id, r)
    }
    for (let remaining = (clipMs - r.atMs) / 1000; remaining > 0; remaining -= MAX_STEP_SEC) {
      r.animator.step(Math.min(MAX_STEP_SEC, remaining))
    }
    r.atMs = clipMs
    return r.animator
  }

  function frameAt(clips: LedClipSpec[], atMs: number): Rgb[] {
    const out: Rgb[] = Array.from({ length: ledCount }, () => BLACK)
    const started = clips.filter(c => c.startMs <= atMs).sort((a, b) => a.startMs - b.startMs)
    for (const spec of started) {
      const endMs = spec.startMs + spec.durationMs
      const ended = atMs >= endMs
      const continuous = spec.action === 'animate' && !TRANSITIONS.has(spec.animation ?? '')
      if (ended && (spec.action === 'clear' || continuous)) {
        // The device clears the whole piece when a continuous animation ends.
        out.fill(BLACK)
        continue
      }
      // A fill or a transition keeps showing where the clip left it (a transition without a
      // duration parameter is frozen where the clip ends).
      const frame = animatorAt(spec, Math.min(atMs, endMs) - spec.startMs)?.step(0)
      if (frame) paint(out, frame, animationRange({ pixels: ledCount, first: spec.first, last: spec.last }).start)
    }
    for (const id of running.keys()) if (!clips.some(c => c.id === id)) running.delete(id)
    return out
  }

  return { frameAt }
}
