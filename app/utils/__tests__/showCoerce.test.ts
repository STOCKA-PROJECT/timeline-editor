import { describe, expect, it } from 'vitest'
import { coerceParam, parseRgb, parseRgbList } from '~/utils/showCoerce'

describe('parseRgb', () => {
  it.each([
    [[255, 50, 0], [255, 50, 0]],
    [['255', '50', '0'], [255, 50, 0]],
    ['[255,50,0]', [255, 50, 0]],
    ['[255, 50, 0]', [255, 50, 0]],
    ['255,50,0', [255, 50, 0]],
    [' 255 , 50 , 0 ', [255, 50, 0]],
    ['#ff3200', [255, 50, 0]],
    ['#FF3200', [255, 50, 0]],
    ['#f30', [255, 51, 0]]
  ])('parses %j', (value, expected) => {
    expect(parseRgb(value)).toEqual(expected)
  })

  it.each([['vermell'], ['[256,0,0]'], ['[1,2]'], ['#ggg'], ['#12345'], ['1,2,3,4'], [''], [[1, 2]], [[1, 2, 300]], [[1.5, 2, 3]], [null], [42]])(
    'rejects %j', (value) => {
      expect(parseRgb(value)).toBeNull()
    }
  )
})

describe('coerceParam', () => {
  it('omits blank optionals and requires blank mandatory values', () => {
    expect(coerceParam(undefined, { type: 'int' })).toEqual({ ok: true, value: undefined, omitted: true })
    expect(coerceParam('', { type: 'string' })).toEqual({ ok: true, value: undefined, omitted: true })
    expect(coerceParam(null, { type: 'rgb', required: true })).toMatchObject({ ok: false, reason: 'required' })
  })

  it('int accepts integral numbers and numeric strings, within bounds', () => {
    expect(coerceParam(3, { type: 'int' })).toEqual({ ok: true, value: 3 })
    expect(coerceParam('3', { type: 'int' })).toEqual({ ok: true, value: 3 })
    expect(coerceParam(3.5, { type: 'int' })).toMatchObject({ ok: false, reason: 'type' })
    expect(coerceParam('x', { type: 'int' })).toMatchObject({ ok: false, reason: 'type' })
    expect(coerceParam(true, { type: 'int' })).toMatchObject({ ok: false, reason: 'type' })
    expect(coerceParam(5, { type: 'int', min: 0, max: 4 })).toMatchObject({ ok: false, reason: 'range', expected: 'entre 0 i 4' })
  })

  it('number accepts decimals and checks min', () => {
    expect(coerceParam('2.5', { type: 'number' })).toEqual({ ok: true, value: 2.5 })
    expect(coerceParam(-1, { type: 'number', min: 0 })).toMatchObject({ ok: false, reason: 'range' })
    expect(coerceParam(0, { type: 'number', min: 0 })).toEqual({ ok: true, value: 0 })
  })

  it('bool accepts booleans and the strings true/false', () => {
    expect(coerceParam(true, { type: 'bool' })).toEqual({ ok: true, value: true })
    expect(coerceParam('false', { type: 'bool' })).toEqual({ ok: true, value: false })
    expect(coerceParam(1, { type: 'bool' })).toMatchObject({ ok: false, reason: 'type' })
  })

  it('string trims text and stringifies numbers', () => {
    expect(coerceParam(' nature.mp3 ', { type: 'string' })).toEqual({ ok: true, value: 'nature.mp3' })
    expect(coerceParam(7, { type: 'string' })).toEqual({ ok: true, value: '7' })
    expect(coerceParam({}, { type: 'string' })).toMatchObject({ ok: false, reason: 'type' })
  })

  it('rgb and enum', () => {
    expect(coerceParam('#ff3200', { type: 'rgb' })).toEqual({ ok: true, value: [255, 50, 0] })
    expect(coerceParam('blau', { type: 'rgb' })).toMatchObject({ ok: false, reason: 'type' })
    expect(coerceParam('fade', { type: 'enum', values: ['fade', 'fire'] })).toEqual({ ok: true, value: 'fade' })
    expect(coerceParam('disco', { type: 'enum', values: ['fade', 'fire'] })).toMatchObject({ ok: false, reason: 'enum', expected: 'fade, fire' })
  })
})

describe('rgb_list (fade waypoints)', () => {
  it('parses arrays, JSON text and ;-separated colours in any notation', () => {
    expect(parseRgbList([[1, 2, 3], '#00ff00', '255,0,0'])).toEqual([[1, 2, 3], [0, 255, 0], [255, 0, 0]])
    expect(parseRgbList('[[1,2,3],"#0f0"]')).toEqual([[1, 2, 3], [0, 255, 0]])
    expect(parseRgbList('#f00;#0f0')).toEqual([[255, 0, 0], [0, 255, 0]])
    expect(parseRgbList('[255,0,0]')).toEqual([[255, 0, 0]])
    expect(parseRgbList('')).toEqual([])
    expect(parseRgbList([])).toEqual([])
  })

  it('rejects anything that is not a list of colours', () => {
    expect(parseRgbList([[1, 2, 3], 'blau'])).toBeNull()
    expect(parseRgbList([1, 2, 3])).toBeNull()
    expect(parseRgbList('{}')).toBeNull()
    expect(parseRgbList('[[1,2,300]]')).toBeNull()
    expect(parseRgbList(42)).toBeNull()
  })

  it('coerces to [r,g,b][], omits an empty optional list and requires a non-empty required one', () => {
    expect(coerceParam('#f00;#0f0', { type: 'rgb_list' })).toEqual({ ok: true, value: [[255, 0, 0], [0, 255, 0]] })
    expect(coerceParam([], { type: 'rgb_list' })).toMatchObject({ ok: true, omitted: true })
    expect(coerceParam('', { type: 'rgb_list' })).toMatchObject({ ok: true, omitted: true })
    expect(coerceParam([], { type: 'rgb_list', required: true })).toMatchObject({ ok: false, reason: 'required' })
    expect(coerceParam('blau', { type: 'rgb_list' })).toMatchObject({ ok: false, reason: 'type' })
  })
})
