// Waveform data: the loudest sample per slice of time, computed once per decoded file and sliced
// per clip at draw time. Pure so it can be tested without an AudioContext.

export interface AudioPeaks {
  /** Slices per second of audio. */
  perSecond: number
  /** Peak (0–1) of every slice, all channels merged. */
  peaks: Float32Array
  durationSec: number
}

/** Peaks of one or more channels of samples at `sampleRate`, `perSecond` slices per second. */
export function computePeaks(channels: ArrayLike<number>[], sampleRate: number, perSecond = 100): AudioPeaks {
  const length = channels.reduce((max, c) => Math.max(max, c.length), 0)
  const samplesPerSlice = Math.max(1, Math.round(sampleRate / perSecond))
  const slices = Math.ceil(length / samplesPerSlice)
  const peaks = new Float32Array(slices)
  for (let s = 0; s < slices; s++) {
    const from = s * samplesPerSlice
    const to = Math.min(length, from + samplesPerSlice)
    let peak = 0
    for (const channel of channels) {
      for (let i = from; i < to && i < channel.length; i++) {
        const v = Math.abs(channel[i] ?? 0)
        if (v > peak) peak = v
      }
    }
    peaks[s] = Math.min(1, peak)
  }
  return { perSecond, peaks, durationSec: sampleRate > 0 ? length / sampleRate : 0 }
}

/**
 * Peaks of the window [fromSec, toSec] resampled to `columns` values (one per pixel column): the
 * loudest slice under each column. Columns past the end of the file are 0.
 */
export function peaksBetween(data: AudioPeaks, fromSec: number, toSec: number, columns: number): Float32Array {
  const out = new Float32Array(Math.max(0, Math.floor(columns)))
  if (out.length === 0 || toSec <= fromSec) return out
  const secPerColumn = (toSec - fromSec) / out.length
  for (let c = 0; c < out.length; c++) {
    const a = Math.floor((fromSec + c * secPerColumn) * data.perSecond)
    const b = Math.max(a + 1, Math.ceil((fromSec + (c + 1) * secPerColumn) * data.perSecond))
    let peak = 0
    for (let i = Math.max(0, a); i < b && i < data.peaks.length; i++) {
      const v = data.peaks[i] ?? 0
      if (v > peak) peak = v
    }
    out[c] = peak
  }
  return out
}

/** Draws peaks as a centred bar waveform filling a canvas context of `width × height`. */
export function drawPeaks(ctx: CanvasRenderingContext2D, peaks: Float32Array, width: number, height: number, color: string) {
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = color
  const mid = height / 2
  for (let x = 0; x < peaks.length && x < width; x++) {
    const h = Math.max(1, (peaks[x] ?? 0) * (height - 2))
    ctx.fillRect(x, mid - h / 2, 1, h)
  }
}
