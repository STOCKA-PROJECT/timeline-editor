import { describe, expect, it } from 'vitest'
import { endOfLastClip, formatTimeInput, normalizeRangeEnd, parseTimeInput, rangeEndOf, timelineViewMs } from '~/utils/playRange'

describe('normalizeRangeEnd', () => {
  it.each([
    [null, null],
    [Number.NaN, null],
    [30_000.4, 30_000],
    [5_000, null], // equal to Inici
    [4_000, null], // before Inici
    [60_000, 60_000], // the end of the show, typed on purpose
    [70_000, 70_000] // after the last clip: silence before it repeats
  ])('%s → %s (Inici 5 s)', (input, expected) => {
    expect(normalizeRangeEnd(input, 5_000)).toBe(expected)
  })
})

describe('rangeEndOf', () => {
  it('uses «Fi» when it is after Inici, also past the last clip', () => {
    expect(rangeEndOf(30_000, 5_000, 60_000)).toBe(30_000)
    expect(rangeEndOf(90_000, 5_000, 60_000)).toBe(90_000)
  })

  it('empty, or no longer after Inici, it is the end of the last clip', () => {
    expect(rangeEndOf(null, 5_000, 60_000)).toBe(60_000)
    expect(rangeEndOf(4_000, 5_000, 60_000)).toBe(60_000) // Inici moved past it
  })
})

describe('endOfLastClip', () => {
  it('is null without clips', () => {
    expect(endOfLastClip([])).toBeNull()
  })

  it('is the latest end, whatever the order', () => {
    expect(endOfLastClip([{ startMs: 118_000, durationMs: 4000 }, { startMs: 0, durationMs: 200_000 }, { startMs: 5000, durationMs: 1 }])).toBe(200_000)
  })

  it('counts a clip at 0 that lasts nothing as 0', () => {
    expect(endOfLastClip([{ startMs: 0, durationMs: 0 }])).toBe(0)
  })
})

describe('timelineViewMs', () => {
  it('leaves at least 30 s after the show', () => {
    expect(timelineViewMs(60_000)).toBe(90_000)
  })

  it('leaves a fifth of a long show', () => {
    expect(timelineViewMs(600_000)).toBe(720_000)
  })
})

describe('parseTimeInput', () => {
  it.each([
    ['5:15', 315_000],
    ['5:15.5', 315_500],
    ['5:15,5', 315_500],
    ['0:07', 7_000],
    ['12:3', 723_000],
    ['315', 315_000],
    ['315,25', 315_250],
    ['  26 ', 26_000]
  ])('%j → %d ms', (text, ms) => {
    expect(parseTimeInput(text)).toBe(ms)
  })

  it('an empty field means no value', () => {
    expect(parseTimeInput('')).toBeNull()
    expect(parseTimeInput('   ')).toBeNull()
  })

  it.each(['abc', '5:75', '1:2:3', '-3', '5:', ':15', '1e3'])('%j is not a time', (text) => {
    expect(parseTimeInput(text)).toBeUndefined()
  })
})

describe('formatTimeInput', () => {
  it.each([
    [0, '0:00'],
    [7_000, '0:07'],
    [315_000, '5:15'],
    [315_500, '5:15.5'],
    [315_449, '5:15.4'],
    [3_599_960, '60:00']
  ])('%d ms → %s', (ms, text) => {
    expect(formatTimeInput(ms)).toBe(text)
  })

  it('reads back what it writes', () => {
    for (const ms of [0, 1_200, 59_900, 315_500, 1_234_500]) expect(parseTimeInput(formatTimeInput(ms))).toBe(ms)
  })
})
