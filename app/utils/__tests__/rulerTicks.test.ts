import { describe, expect, it } from 'vitest'
import { formatRulerTime, pickInterval, rulerTicks } from '~/utils/rulerTicks'

describe('formatRulerTime', () => {
  it('uses seconds under a minute, m:ss from a minute and h:mm:ss from an hour', () => {
    expect(formatRulerTime(0)).toBe('0s')
    expect(formatRulerTime(12_000)).toBe('12s')
    expect(formatRulerTime(500)).toBe('0,5s')
    expect(formatRulerTime(250)).toBe('0,25s')
    expect(formatRulerTime(60_000)).toBe('1:00')
    expect(formatRulerTime(90_000)).toBe('1:30')
    expect(formatRulerTime(600_000)).toBe('10:00')
    expect(formatRulerTime(3_600_000)).toBe('1:00:00')
    expect(formatRulerTime(3_725_000)).toBe('1:02:05')
  })
})

describe('pickInterval', () => {
  it('grows as the zoom shrinks so labels keep their minimum spacing', () => {
    expect(pickInterval(0.4, 56)).toBe(200)
    expect(pickInterval(0.04, 56)).toBe(2000)
    expect(pickInterval(0.008, 56)).toBe(10_000)
    expect(pickInterval(0.001, 56)).toBe(60_000)
    expect(pickInterval(0.00001, 56)).toBe(3_600_000)
  })
})

describe('rulerTicks', () => {
  it('labels every interval from 0 to the end and never overlaps', () => {
    const r = rulerTicks(10_000, 0.04)
    expect(r.intervalMs).toBe(2000)
    expect(r.major.map(t => t.label)).toEqual(['0s', '2s', '4s', '6s', '8s', '10s'])
    expect(r.major.every((t, i, a) => i === 0 || (t.ms - a[i - 1]!.ms) * 0.04 >= 56)).toBe(true)
  })

  it('adds nice minor ticks between the labelled ones, never on them', () => {
    const r = rulerTicks(4000, 0.04)
    expect(r.minor).toEqual([500, 1000, 1500, 2500, 3000, 3500])
    const far = rulerTicks(60_000, 0.008)
    expect(far.intervalMs).toBe(10_000)
    expect(far.minor).toEqual([2000, 4000, 6000, 8000, 12_000, 14_000, 16_000, 18_000, 22_000, 24_000, 26_000, 28_000, 32_000, 34_000, 36_000, 38_000, 42_000, 44_000, 46_000, 48_000, 52_000, 54_000, 56_000, 58_000])
  })

  it('skips minor ticks when they would be too dense', () => {
    expect(rulerTicks(10_000, 0.04, 56, 1000).minor).toEqual([])
  })

  it('switches to minutes on a long scene zoomed out', () => {
    const r = rulerTicks(1_000_000, 0.002)
    expect(r.intervalMs).toBe(30_000)
    expect(r.major.slice(0, 4).map(t => t.label)).toEqual(['0s', '30s', '1:00', '1:30'])
  })
})
