/**
 * Browser-side approximation of the LED animations of the belén player
 * (`rpi4-system/app/modules/leds/animations/*.py`), used to preview a clip before exporting.
 * Same palettes, parameters, 30 fps cadence and per-pixel rules; randomness differs, and the
 * preview loops where the device would stop.
 */

export type Rgb = [number, number, number]

export interface LedAnimator {
  /** Advances the animation by `dtSec` seconds and returns the colour of every pixel. */
  step(dtSec: number): Rgb[]
}

export interface LedPreviewOptions {
  /** Number of pixels of the target (segment or strip). */
  pixels: number
  /** Clip length in seconds: the duration of transitions (fade, sunrise, sunset). */
  durationSec?: number | null
  /** Optional sub-range of the target the action applies to (0-based, inclusive, any order). */
  first?: number | null
  last?: number | null
}

const FRAME = 1 / 30
const BLACK: Rgb = [0, 0, 0]

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))
const scale = (c: Rgb, k: number): Rgb => [Math.floor(c[0] * k), Math.floor(c[1] * k), Math.floor(c[2] * k)]
const randBetween = (lo: number, hi: number) => lo + Math.random() * (hi - lo)
const randInt = (lo: number, hi: number) => Math.floor(randBetween(lo, hi + 1))

function num(params: Record<string, unknown>, key: string, fallback: number): number {
  const v = params[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}
function rgb(params: Record<string, unknown>, key: string, fallback: Rgb): Rgb {
  const v = params[key]
  return Array.isArray(v) && v.length === 3 && v.every(n => typeof n === 'number') ? (v as Rgb) : fallback
}
function rgbList(params: Record<string, unknown>, key: string): Rgb[] {
  const v = params[key]
  return Array.isArray(v) ? v.filter((c): c is Rgb => Array.isArray(c) && c.length === 3) : []
}

/** Pixel range of the action inside the target, like `LedsController._get_animation_range`. */
export function animationRange(opts: LedPreviewOptions): { start: number, count: number } {
  const n = Math.max(1, Math.floor(opts.pixels))
  if (opts.first == null && opts.last == null) return { start: 0, count: n }
  const a = clamp(Math.floor(opts.first ?? 0), 0, n - 1)
  const b = clamp(Math.floor(opts.last ?? n - 1), 0, n - 1)
  return { start: Math.min(a, b), count: Math.abs(b - a) + 1 }
}

/** Fixed-step driver: accumulates real time and runs whole 30 fps frames, like the device loops. */
function framed(frame: () => Rgb[]): LedAnimator {
  let acc = 0
  let last: Rgb[] | null = null
  return {
    step(dtSec) {
      acc += Math.min(dtSec, 0.5)
      let out = last
      while (acc >= FRAME || out === null) {
        acc = Math.max(0, acc - FRAME)
        out = frame()
        if (acc < FRAME) break
      }
      last = out
      return out
    }
  }
}

/** Linear interpolation through `sequence` over `durationSec`, holding the last colour afterwards. */
function fadeSequence(sequence: Rgb[], durationSec: number, count: number): () => Rgb[] {
  const segments = Math.max(1, sequence.length - 1)
  const segDuration = Math.max(0.05, durationSec) / segments
  let t = 0
  return () => {
    const total = segDuration * segments
    let color: Rgb
    if (t >= total) {
      color = sequence[sequence.length - 1]!
    } else {
      const idx = Math.min(segments - 1, Math.floor(t / segDuration))
      const f = (t - idx * segDuration) / segDuration
      const a = sequence[idx]!
      const b = sequence[idx + 1]!
      color = [0, 1, 2].map(i => Math.round(a[i]! + (b[i]! - a[i]!) * f)) as Rgb
    }
    t += FRAME
    return Array.from({ length: count }, () => color)
  }
}

/** Builds the animator of `type` with the given (already coerced) parameters, or null when unknown. */
export function createLedAnimation(type: string, params: Record<string, unknown>, opts: LedPreviewOptions): LedAnimator | null {
  const { count } = animationRange(opts)
  const duration = opts.durationSec && opts.durationSec > 0 ? opts.durationSec : null
  switch (type) {
    case 'fade': {
      const seq = [rgb(params, 'from_color', BLACK), ...rgbList(params, 'waypoints'), rgb(params, 'color', BLACK)]
      return framed(fadeSequence(seq, duration ?? 1, count))
    }
    case 'sunrise':
      return framed(fadeSequence([BLACK, [20, 10, 5], [255, 100, 50], [255, 200, 100]], duration ?? 10, count))
    case 'sunset':
      return framed(fadeSequence([[255, 200, 100], [255, 150, 50], [255, 80, 0], [200, 40, 0], BLACK], duration ?? 15, count))
    case 'stars': {
      const density = num(params, 'density', 0.1)
      const speed = num(params, 'speed', 0.5)
      const star = rgb(params, 'color', [255, 255, 255])
      const bg = rgb(params, 'background', BLACK)
      const states = new Map<number, { brightness: number, direction: 1 | -1, speed: number }>()
      for (let i = 0; i < Math.max(1, Math.floor(count * density)); i++) {
        states.set(randInt(0, count - 1), { brightness: Math.random(), direction: Math.random() < 0.5 ? -1 : 1, speed: randBetween(0.01, 0.05) * speed })
      }
      return framed(() => {
        const out: Rgb[] = Array.from({ length: count }, () => bg)
        const remove: number[] = []
        for (const [pixel, s] of states) {
          s.brightness += s.direction * s.speed
          if (s.brightness >= 1) { s.brightness = 1; s.direction = -1 }
          else if (s.brightness <= 0) {
            s.brightness = 0
            if (Math.random() < 0.3) remove.push(pixel)
            else s.direction = 1
          }
          out[pixel] = scale(star, s.brightness)
        }
        for (const pixel of remove) {
          states.delete(pixel)
          states.set(randInt(0, count - 1), { brightness: 0, direction: 1, speed: randBetween(0.01, 0.05) * speed })
        }
        return out
      })
    }
    case 'fire': {
      const intensity = num(params, 'intensity', 1)
      const speed = num(params, 'speed', 1)
      const palette: Rgb[] = [[255, 50, 0], [255, 100, 0], [255, 150, 0]]
      const states = Array.from({ length: count }, () => ({ color: randInt(0, 2), brightness: Math.random(), flicker: randBetween(0.05, 0.15) * speed }))
      return framed(() => states.map((s) => {
        s.brightness = clamp(s.brightness + randBetween(-s.flicker, s.flicker), 0.2, 1)
        if (Math.random() < 0.1 * speed) s.color = randInt(0, 2)
        return scale(palette[s.color]!, s.brightness * intensity)
      }))
    }
    case 'window_light': {
      const color = rgb(params, 'color', [255, 180, 50])
      const flicker = num(params, 'flicker_speed', 0.3)
      let acc = 0
      return framed(() => {
        const brightness = clamp(0.8 + Math.sin(acc) * 0.15, 0.6, 1)
        acc += flicker * FRAME
        const c = scale(color, brightness)
        return Array.from({ length: count }, () => c)
      })
    }
    case 'candle': {
      const intensity = num(params, 'intensity', 1)
      const speed = num(params, 'speed', 1)
      let brightness = 0.7 * intensity
      return framed(() => {
        brightness = clamp(brightness + randBetween(-0.08, 0.08) * speed, 0.4 * intensity, 1 * intensity)
        const c = scale([255, 150, 30], brightness)
        return Array.from({ length: count }, () => c)
      })
    }
    case 'moonlight': {
      const base = num(params, 'brightness', 0.3)
      const flicker = num(params, 'flicker', 0.05)
      let acc = 0
      return framed(() => {
        const b = clamp(base + Math.sin(acc * 0.5) * flicker, 0.1, 0.5)
        acc += FRAME
        const c = scale([100, 150, 255], b)
        return Array.from({ length: count }, () => c)
      })
    }
    case 'clouds': {
      const speed = num(params, 'speed', 0.5)
      const color = rgb(params, 'color', [200, 200, 220])
      let acc = 0
      return framed(() => {
        const out = Array.from({ length: count }, (_, i) => scale(color, 0.3 + Math.sin(i * 0.1 + acc * speed) * 0.2))
        acc += FRAME
        return out
      })
    }
    case 'shooting_star': {
      const color = rgb(params, 'color', [255, 255, 255])
      const speed = Math.max(0.1, num(params, 'speed', 2))
      const interval = Math.max(0.5, num(params, 'interval', 30))
      // The device waits a whole interval before the first star; the preview shows one right away.
      let sinceStar = interval
      let trail: { pos: number, dir: 1 | -1, len: number, i: number, wait: number } | null = null
      const pixels: Rgb[] = Array.from({ length: count }, () => BLACK)
      return framed(() => {
        if (trail) {
          trail.wait -= 1
          if (trail.wait <= 0) {
            if (trail.i < trail.len) {
              if (trail.pos >= 0 && trail.pos < count) pixels[trail.pos] = scale(color, clamp(1 - trail.i / trail.len, 0, 1))
              trail.pos += trail.dir
              trail.i += 1
              trail.wait = Math.max(1, Math.round(1 / speed))
            } else {
              pixels.fill(BLACK)
              trail = null
              sinceStar = 0
            }
          }
        } else {
          sinceStar += FRAME
          if (sinceStar >= interval) {
            trail = { pos: randInt(0, count - 1), dir: Math.random() < 0.5 ? -1 : 1, len: Math.max(1, Math.min(10, Math.floor(count / 4))), i: 0, wait: 0 }
          }
        }
        return [...pixels]
      })
    }
    case 'aurora': {
      const speed = num(params, 'speed', 0.3)
      const intensity = num(params, 'intensity', 0.6)
      const palette: Rgb[] = [[0, 255, 100], [0, 200, 150], [0, 150, 255], [50, 100, 255]]
      let acc = 0
      return framed(() => {
        const out = Array.from({ length: count }, (_, i) => {
          const wave = (Math.sin(i * 0.15 + acc * speed) + Math.sin(i * 0.25 + acc * speed * 1.3) + Math.cos(i * 0.1 + acc * speed * 0.7)) / 3
          const b = clamp(0.2 + wave * 0.4 * intensity, 0.1, 1)
          return scale(palette[Math.floor((i / count) * palette.length) % palette.length]!, b)
        })
        acc += FRAME
        return out
      })
    }
    case 'snow': {
      const density = num(params, 'density', 0.05)
      const speed = num(params, 'speed', 1)
      const bg = rgb(params, 'background', [10, 20, 50])
      const maxFlakes = Math.floor(count * density)
      const flakes: Array<{ pos: number, speed: number }> = []
      return framed(() => {
        const out: Rgb[] = Array.from({ length: count }, () => bg)
        if (flakes.length < maxFlakes && Math.random() < 0.3) flakes.push({ pos: randInt(0, count - 1), speed: randBetween(0.5, 1.5) * speed })
        for (const f of flakes) {
          if (f.pos >= 0 && f.pos < count) out[f.pos] = [255, 255, 255]
          f.pos += Math.trunc(f.speed)
        }
        for (let i = flakes.length - 1; i >= 0; i--) if (flakes[i]!.pos >= count) flakes.splice(i, 1)
        return out
      })
    }
    default:
      return null
  }
}

/** Solid colour (the `fill` action), for the same preview widget. */
export function createLedFill(color: Rgb, opts: LedPreviewOptions): LedAnimator {
  const { count } = animationRange(opts)
  const frame = Array.from({ length: count }, () => color)
  return { step: () => frame }
}

/** Places the colours of an action's range inside the whole target (the rest stays off). */
export function placeInTarget(frame: Rgb[], opts: LedPreviewOptions): Rgb[] {
  const n = Math.max(1, Math.floor(opts.pixels))
  const { start } = animationRange(opts)
  const out: Rgb[] = Array.from({ length: n }, () => BLACK)
  frame.forEach((c, i) => { if (start + i < n) out[start + i] = c })
  return out
}

/** Every animation the preview can draw. */
export const PREVIEWABLE_ANIMATIONS = ['fade', 'sunrise', 'sunset', 'stars', 'fire', 'window_light', 'candle', 'moonlight', 'clouds', 'shooting_star', 'aurora', 'snow'] as const
