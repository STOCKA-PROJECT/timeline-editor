import { describe, expect, it } from 'vitest'
import { PREVIEWABLE_ANIMATIONS, animationRange, createLedAnimation, createLedFill, placeInTarget, type Rgb } from '~/utils/ledPreview'

const valid = (c: Rgb) => c.length === 3 && c.every(n => Number.isInteger(n) && n >= 0 && n <= 255)

describe('animationRange', () => {
  it('covers the whole target by default and clamps a (possibly reversed) sub-range', () => {
    expect(animationRange({ pixels: 44 })).toEqual({ start: 0, count: 44 })
    expect(animationRange({ pixels: 44, first: 16, last: 19 })).toEqual({ start: 16, count: 4 })
    expect(animationRange({ pixels: 44, first: 19, last: 16 })).toEqual({ start: 16, count: 4 })
    expect(animationRange({ pixels: 44, first: 40, last: 99 })).toEqual({ start: 40, count: 4 })
  })
})

describe('createLedAnimation', () => {
  it.each(PREVIEWABLE_ANIMATIONS)('%s returns one valid colour per pixel on every frame', (type) => {
    const anim = createLedAnimation(type, {}, { pixels: 30, durationSec: 2 })!
    expect(anim).not.toBeNull()
    for (let i = 0; i < 20; i++) {
      const frame = anim.step(1 / 30)
      expect(frame).toHaveLength(30)
      expect(frame.every(valid)).toBe(true)
    }
  })

  it('is null for an unknown animation', () => {
    expect(createLedAnimation('disco', {}, { pixels: 10 })).toBeNull()
  })

  it('fade interpolates linearly from from_color through waypoints to color and holds the end', () => {
    const anim = createLedAnimation('fade', { from_color: [0, 0, 0], waypoints: [[100, 100, 100]], color: [200, 0, 0] }, { pixels: 3, durationSec: 2 })!
    const first = anim.step(0)
    expect(first[0]).toEqual([0, 0, 0])
    // 0.5 s = halfway through the first of two 1 s segments.
    const mid = anim.step(0.5)
    expect(mid[0]![0]).toBeGreaterThan(40)
    expect(mid[0]![0]).toBeLessThan(60)
    for (let i = 0; i < 60; i++) anim.step(1 / 30)
    expect(anim.step(1 / 30)[0]).toEqual([200, 0, 0])
  })

  it('fade without from_color starts from black and uses the clip duration', () => {
    const anim = createLedAnimation('fade', { color: [255, 255, 255] }, { pixels: 1, durationSec: 1 })!
    expect(anim.step(0)[0]).toEqual([0, 0, 0])
    for (let i = 0; i < 31; i++) anim.step(1 / 30)
    expect(anim.step(1 / 30)[0]).toEqual([255, 255, 255])
  })

  it('sunrise ends warm and sunset ends dark', () => {
    const sunrise = createLedAnimation('sunrise', {}, { pixels: 1, durationSec: 0.3 })!
    for (let i = 0; i < 12; i++) sunrise.step(1 / 30)
    expect(sunrise.step(1 / 30)[0]).toEqual([255, 200, 100])
    const sunset = createLedAnimation('sunset', {}, { pixels: 1, durationSec: 0.3 })!
    for (let i = 0; i < 12; i++) sunset.step(1 / 30)
    expect(sunset.step(1 / 30)[0]).toEqual([0, 0, 0])
  })

  it('fire stays within its warm palette scaled by intensity', () => {
    const anim = createLedAnimation('fire', { intensity: 0.5 }, { pixels: 20 })!
    for (let i = 0; i < 5; i++) {
      for (const [r, g, b] of anim.step(1 / 30)) {
        expect(r).toBeLessThanOrEqual(128)
        expect(b).toBe(0)
        expect(g).toBeLessThanOrEqual(75)
      }
    }
  })

  it('shooting_star shows a star right away and clears after the trail', () => {
    const anim = createLedAnimation('shooting_star', { speed: 10, interval: 30 }, { pixels: 40 })!
    let lit = 0
    for (let i = 0; i < 4; i++) lit += anim.step(1 / 30).filter(c => c[0] > 0).length
    expect(lit).toBeGreaterThan(0)
    for (let i = 0; i < 40; i++) anim.step(1 / 30)
    expect(anim.step(1 / 30).every(c => c[0] === 0)).toBe(true)
  })

  it('stars and snow paint the background everywhere else', () => {
    const stars = createLedAnimation('stars', { density: 0.1, background: [1, 2, 3], color: [255, 255, 255] }, { pixels: 50 })!
    const frame = stars.step(1 / 30)
    expect(frame.filter(c => c[2] === 3).length).toBeGreaterThanOrEqual(40)
    const snow = createLedAnimation('snow', { density: 0.2 }, { pixels: 50 })!
    expect(snow.step(1 / 30).every(c => (c[0] === 10 && c[1] === 20 && c[2] === 50) || c[0] === 255)).toBe(true)
  })
})

describe('fill and placement', () => {
  it('fills the range with one colour and leaves the rest of the target off', () => {
    const opts = { pixels: 10, first: 2, last: 4 }
    const frame = createLedFill([9, 8, 7], opts).step(0)
    expect(frame).toEqual([[9, 8, 7], [9, 8, 7], [9, 8, 7]])
    const placed = placeInTarget(frame, opts)
    expect(placed).toHaveLength(10)
    expect(placed[1]).toEqual([0, 0, 0])
    expect(placed[2]).toEqual([9, 8, 7])
    expect(placed[4]).toEqual([9, 8, 7])
    expect(placed[5]).toEqual([0, 0, 0])
  })
})
