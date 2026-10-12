/** Tick marks of the timeline ruler, chosen so labels never overlap at the current zoom. */

export interface RulerTick {
  ms: number
  label: string
}

export interface Ruler {
  /** Distance between labelled ticks (ms). */
  intervalMs: number
  /** Labelled ticks, from 0 to the end. */
  major: RulerTick[]
  /** Unlabelled ticks between the major ones (never on a major tick). */
  minor: number[]
}

/** "Nice" intervals, in ms: tenths and quarters of a second, then seconds, then minutes. */
const STEPS = [50, 100, 200, 250, 500, 1000, 2000, 5000, 10_000, 15_000, 30_000, 60_000, 120_000, 300_000, 600_000, 900_000, 1_800_000, 3_600_000]
const NICE = new Set(STEPS)

/** Formats a ruler time: `12s`, `0,5s` under a minute, `m:ss` from a minute, `h:mm:ss` from an hour. */
export function formatRulerTime(ms: number): string {
  if (ms < 60_000) {
    const s = ms / 1000
    return (Number.isInteger(s) ? String(s) : s.toFixed(2).replace(/0+$/, '').replace('.', ',')) + 's'
  }
  const totalSec = Math.round(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`
}

/** Smallest nice interval whose width on screen is at least `minPx` (the last step when none is). */
export function pickInterval(pxPerMs: number, minPx: number): number {
  return STEPS.find(step => step * pxPerMs >= minPx) ?? STEPS[STEPS.length - 1]!
}

/**
 * Ruler ticks for a scene of `durationMs` drawn at `pxPerMs`: labelled ticks at least `minLabelPx`
 * apart and, when there is room (`minMinorPx`), unlabelled ticks at a nice fraction of the interval.
 */
export function rulerTicks(durationMs: number, pxPerMs: number, minLabelPx = 56, minMinorPx = 10): Ruler {
  const intervalMs = pickInterval(pxPerMs, minLabelPx)
  const major: RulerTick[] = []
  for (let ms = 0; ms <= durationMs; ms += intervalMs) major.push({ ms, label: formatRulerTime(ms) })

  const minorStep = [10, 5, 4, 3, 2]
    .map(d => intervalMs / d)
    .find(step => NICE.has(step) && step * pxPerMs >= minMinorPx)
  const minor: number[] = []
  if (minorStep) {
    for (let ms = minorStep; ms <= durationMs; ms += minorStep) {
      if (ms % intervalMs !== 0) minor.push(ms)
    }
  }
  return { intervalMs, major, minor }
}
