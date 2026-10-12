import { describe, expect, it } from 'vitest'
import { computePeaks, peaksBetween } from '~/utils/audioPeaks'

describe('computePeaks', () => {
  it('keeps the loudest sample of every slice across channels, capped at 1', () => {
    // 10 samples per second, 2 slices per second → 5 samples per slice.
    const left = new Float32Array([0.125, 0.25, 0.375, 0.25, 0.125, 0, 0, 0, 0, 0])
    const right = new Float32Array([0, 0, 0, 0, 0, -0.75, 0, 0, 0, 1.5])
    const peaks = computePeaks([left, right], 10, 2)
    expect(peaks.perSecond).toBe(2)
    expect(peaks.durationSec).toBe(1)
    expect(Array.from(peaks.peaks)).toEqual([0.375, 1])
  })

  it('rounds the last partial slice up and handles empty input', () => {
    expect(computePeaks([new Float32Array(7)], 10, 2).peaks.length).toBe(2)
    expect(computePeaks([new Float32Array(0)], 10, 2).peaks.length).toBe(0)
    expect(computePeaks([], 0).durationSec).toBe(0)
  })
})

describe('peaksBetween', () => {
  // Values exactly representable in float32, so equality holds after the Float32Array round trip.
  const data = { perSecond: 1, durationSec: 4, peaks: new Float32Array([0.125, 0.5, 0.75, 0.25]) }

  it('maps one column per pixel onto the window, taking the loudest slice', () => {
    expect(Array.from(peaksBetween(data, 0, 4, 4))).toEqual([0.125, 0.5, 0.75, 0.25])
    expect(Array.from(peaksBetween(data, 0, 4, 2))).toEqual([0.5, 0.75])
    expect(Array.from(peaksBetween(data, 1, 3, 4))).toEqual([0.5, 0.5, 0.75, 0.75])
  })

  it('is silent past the end of the file and for empty windows', () => {
    expect(Array.from(peaksBetween(data, 3, 5, 2))).toEqual([0.25, 0])
    expect(peaksBetween(data, 2, 2, 3).length).toBe(3)
    expect(Array.from(peaksBetween(data, 2, 2, 3))).toEqual([0, 0, 0])
    expect(peaksBetween(data, 0, 4, 0).length).toBe(0)
  })
})
