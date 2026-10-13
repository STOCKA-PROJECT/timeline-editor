import { describe, expect, it } from 'vitest'
import { layoutStrip, ledLengthFromAttributes, orderItems, uniqueName } from '~/utils/stripLayout'

describe('ledLengthFromAttributes', () => {
  const attr = (attributeName: string, displayName: string, type: string, value: string | null) =>
    ({ attributeName, displayName, type: type as never, value })

  it('reads a positive numeric length attribute by technical or visible name, accents ignored', () => {
    expect(ledLengthFromAttributes([attr('longitud', 'Longitud', 'INTEGER', '16')])).toBe(16)
    expect(ledLengthFromAttributes([attr('n_leds', 'Nombre de LED', 'DECIMAL', '28.4')])).toBe(28)
    expect(ledLengthFromAttributes([attr('x', 'Longitud', 'INTEGER', '12')])).toBe(12)
  })

  it('ignores non-numeric, empty, zero or unrelated attributes', () => {
    expect(ledLengthFromAttributes([attr('longitud', 'Longitud', 'TEXT', '16')])).toBeNull()
    expect(ledLengthFromAttributes([attr('longitud', 'Longitud', 'INTEGER', null)])).toBeNull()
    expect(ledLengthFromAttributes([attr('longitud', 'Longitud', 'INTEGER', '0')])).toBeNull()
    expect(ledLengthFromAttributes([attr('amplada', 'Amplada', 'INTEGER', '16')])).toBeNull()
    expect(ledLengthFromAttributes(undefined)).toBeNull()
  })
})

describe('orderItems', () => {
  it('puts the saved order first and appends newcomers, dropping ids no longer assigned', () => {
    expect(orderItems(['a', 'b', 'c'], ['c', 'a'])).toEqual(['c', 'a', 'b'])
    expect(orderItems(['a', 'b'], ['z', 'b', 'b'])).toEqual(['b', 'a'])
    expect(orderItems(['a', 'b'], undefined)).toEqual(['a', 'b'])
    expect(orderItems([], ['a'])).toEqual([])
  })
})

describe('layoutStrip', () => {
  const lengths: Record<string, number | null> = { a: 16, b: 28, c: null }

  it('lays pieces one after the other by their lengths', () => {
    const layout = layoutStrip(['a', 'b'], id => lengths[id] ?? null, 300)
    expect(layout.get('a')).toEqual({ offset: 0, length: 16, explicit: true })
    expect(layout.get('b')).toEqual({ offset: 16, length: 28, explicit: true })
  })

  it('gives a piece without length the rest of the strip', () => {
    const layout = layoutStrip(['a', 'c'], id => lengths[id] ?? null, 44)
    expect(layout.get('c')).toEqual({ offset: 16, length: 28, explicit: false })
    // Not last: it swallows the rest and whatever follows gets nothing.
    const bad = layoutStrip(['c', 'a'], id => lengths[id] ?? null, 44)
    expect(bad.get('c')).toEqual({ offset: 0, length: 44, explicit: false })
    expect(bad.get('a')).toEqual({ offset: 44, length: 16, explicit: true })
  })

  it('handles an unknown strip length and an empty strip', () => {
    expect(layoutStrip(['c'], () => null, null).get('c')).toEqual({ offset: 0, length: 0, explicit: false })
    expect(layoutStrip([], () => null, 10).size).toBe(0)
  })
})

describe('uniqueName', () => {
  it('suffixes #2, #3… while the name is taken and registers the result', () => {
    const taken = new Set(['Focos', 'Focos #2'])
    expect(uniqueName('Casa', taken)).toBe('Casa')
    expect(uniqueName('Focos', taken)).toBe('Focos #3')
    expect(taken.has('Casa')).toBe(true)
    expect(taken.has('Focos #3')).toBe(true)
  })
})
