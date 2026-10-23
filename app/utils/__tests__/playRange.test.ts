import { describe, expect, it } from 'vitest'
import { normalizeRangeEnd, rangeEndOf } from '~/utils/playRange'

describe('normalizeRangeEnd', () => {
  it.each([
    [null, null],
    [Number.NaN, null],
    [30_000.4, 30_000],
    [5_000, null], // equal to Inicio
    [4_000, null], // before Inicio
    [60_000, null], // the end of the show is the same as no «Fins»
    [70_000, null] // past the end
  ])('%s → %s (Inicio 5 s, show 60 s)', (input, expected) => {
    expect(normalizeRangeEnd(input, 5_000, 60_000)).toBe(expected)
  })
})

describe('rangeEndOf', () => {
  it('uses «Fins» when it is valid', () => {
    expect(rangeEndOf(30_000, 5_000, 60_000)).toBe(30_000)
  })

  it('falls back to the end of the show', () => {
    expect(rangeEndOf(null, 5_000, 60_000)).toBe(60_000)
    expect(rangeEndOf(4_000, 5_000, 60_000)).toBe(60_000) // Inicio moved past it
    expect(rangeEndOf(30_000, 0, 20_000)).toBe(20_000) // the show got shorter
  })
})
