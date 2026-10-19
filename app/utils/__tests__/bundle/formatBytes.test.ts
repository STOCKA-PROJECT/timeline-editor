import { describe, expect, it } from 'vitest'
import { formatBytes } from '~/utils/bundle/formatBytes'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1, '1 B'],
    [999, '999 B'],
    [1000, '1 kB'],
    [1536, '1,5 kB'],
    [5770, '5,8 kB'],
    [3773952, '3,8 MB'],
    [25_000_000, '25 MB'],
    [1_200_000_000, '1,2 GB'],
    [9_999_000_000_000, '9.999 GB']
  ])('formatBytes(%d) → %j', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })

  it.each([[-1], [Number.NaN], [Number.POSITIVE_INFINITY]])('shows a dash for %s', (bytes) => {
    expect(formatBytes(bytes)).toBe('—')
  })
})
