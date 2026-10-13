import { describe, expect, it } from 'vitest'
import {
  LED_PATH_PRESETS,
  boardToItemFraction,
  itemToBoard,
  ledPathOf,
  ledPositions,
  pathLength,
  presetOfPath,
  presetPath,
  reverseLedPath
} from '~/utils/ledPath'

const close = (a: { x: number, y: number }, b: { x: number, y: number }) => {
  expect(a.x).toBeCloseTo(b.x, 6)
  expect(a.y).toBeCloseTo(b.y, 6)
}

describe('ledPathOf', () => {
  it('falls back to the horizontal line when the item has no path (or an empty one)', () => {
    expect(ledPathOf({})).toBe(LED_PATH_PRESETS.horizontal)
    expect(ledPathOf({ ledPath: null })).toBe(LED_PATH_PRESETS.horizontal)
    expect(ledPathOf({ ledPath: [] })).toBe(LED_PATH_PRESETS.horizontal)
    const own = [{ x: 0, y: 0 }, { x: 1, y: 1 }]
    expect(ledPathOf({ ledPath: own })).toBe(own)
  })
})

describe('presets', () => {
  it('recognises a preset and reports custom paths as null', () => {
    expect(presetOfPath(presetPath('perimeter'))).toBe('perimeter')
    expect(presetOfPath([{ x: 0, y: 0.5 }, { x: 1, y: 0.5 }])).toBe('horizontal')
    expect(presetOfPath([{ x: 1, y: 0.5 }, { x: 0, y: 0.5 }])).toBeNull()
    expect(presetOfPath([{ x: 0, y: 0.5 }])).toBeNull()
  })

  it('presetPath returns a copy that does not share points with the preset', () => {
    const copy = presetPath('vertical')
    copy[0]!.x = 0.9
    expect(LED_PATH_PRESETS.vertical[0]!.x).toBe(0.5)
  })

  it('reverseLedPath puts LED 0 at the other end without touching the original', () => {
    const path = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }]
    expect(reverseLedPath(path)).toEqual([{ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 0 }])
    expect(path[0]).toEqual({ x: 0, y: 0 })
  })
})

describe('pathLength', () => {
  it('scales the fractions to the item size and sums the segments', () => {
    expect(pathLength(LED_PATH_PRESETS.horizontal, 200, 50)).toBe(200)
    expect(pathLength(LED_PATH_PRESETS.perimeter, 200, 50)).toBe(500)
    expect(pathLength([{ x: 0.5, y: 0.5 }], 200, 50)).toBe(0)
  })
})

describe('ledPositions', () => {
  it('spreads the LEDs evenly along a line, each in the middle of its slot', () => {
    const dots = ledPositions(LED_PATH_PRESETS.horizontal, 4, 100, 20)
    expect(dots.map(d => d.x)).toEqual([12.5, 37.5, 62.5, 87.5])
    expect(dots.every(d => d.y === 10)).toBe(true)
  })

  it('follows the corners of a multi-segment path', () => {
    // Bottom-left → top-left → top-right on a 100 × 100 item: 200 px, 4 LEDs every 50 px.
    const path = [{ x: 0, y: 1 }, { x: 0, y: 0 }, { x: 1, y: 0 }]
    const dots = ledPositions(path, 4, 100, 100)
    close(dots[0]!, { x: 0, y: 75 })
    close(dots[1]!, { x: 0, y: 25 })
    close(dots[2]!, { x: 25, y: 0 })
    close(dots[3]!, { x: 75, y: 0 })
  })

  it('puts a single LED in the middle and every LED on the first point of a path without length', () => {
    close(ledPositions(LED_PATH_PRESETS.vertical, 1, 40, 80)[0]!, { x: 20, y: 40 })
    expect(ledPositions([{ x: 0.25, y: 0.5 }], 3, 100, 100)).toEqual([{ x: 25, y: 50 }, { x: 25, y: 50 }, { x: 25, y: 50 }])
    expect(ledPositions([], 3, 100, 100)).toEqual([])
    expect(ledPositions(LED_PATH_PRESETS.horizontal, 0, 100, 100)).toEqual([])
  })
})

describe('item ↔ board', () => {
  const item = { x: 100, y: 50, width: 200, height: 100, rotation: 90 }

  it('itemToBoard rotates clockwise around the item origin, as the board draws it', () => {
    close(itemToBoard({ x: 0, y: 0 }, item), { x: 100, y: 50 })
    close(itemToBoard({ x: 200, y: 0 }, item), { x: 100, y: 250 })
    close(itemToBoard({ x: 50, y: 20 }, { x: 0, y: 0, rotation: 0 }), { x: 50, y: 20 })
  })

  it('boardToItemFraction is the inverse, in fractions of the size rounded to 3 decimals', () => {
    expect(boardToItemFraction({ x: 100, y: 250 }, item)).toEqual({ x: 1, y: 0 })
    expect(boardToItemFraction(itemToBoard({ x: 50, y: 25 }, item), item)).toEqual({ x: 0.25, y: 0.25 })
    expect(boardToItemFraction({ x: 33.3333, y: 10 }, { x: 0, y: 0, width: 100, height: 100, rotation: 0 })).toEqual({ x: 0.333, y: 0.1 })
    // Points outside the item are allowed (a strip may stick out of the picture).
    expect(boardToItemFraction({ x: -50, y: 0 }, { x: 0, y: 0, width: 100, height: 100, rotation: 0 })).toEqual({ x: -0.5, y: 0 })
  })
})
