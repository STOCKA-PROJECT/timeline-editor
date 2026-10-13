import { describe, expect, it } from 'vitest'
import { createLedTarget, type LedClipSpec } from '~/utils/ledTarget'

const RED = [255, 0, 0] as const
const BLUE = [0, 0, 255] as const
const BLACK = [0, 0, 0]

function clip(partial: Partial<LedClipSpec> & Pick<LedClipSpec, 'id' | 'startMs' | 'durationMs' | 'action'>): LedClipSpec {
  return { animation: null, params: {}, first: null, last: null, durationSec: null, ...partial }
}
const fill = (id: string, startMs: number, durationMs: number, color: readonly number[], range: { first?: number, last?: number } = {}) =>
  clip({ id, startMs, durationMs, action: 'fill', params: { color: [...color] }, first: range.first ?? null, last: range.last ?? null })

describe('createLedTarget', () => {
  it('is off before any clip and keeps a fill after its clip ended', () => {
    const target = createLedTarget(4)
    const clips = [fill('a', 1000, 500, RED)]
    expect(target.frameAt(clips, 0)).toEqual([BLACK, BLACK, BLACK, BLACK])
    expect(target.frameAt(clips, 1000)).toEqual([RED, RED, RED, RED])
    expect(target.frameAt(clips, 9000)).toEqual([RED, RED, RED, RED])
  })

  it('paints only the first/last range of the piece and lets later clips paint over earlier ones', () => {
    const target = createLedTarget(5)
    const clips = [fill('a', 0, 100, RED), fill('b', 2000, 100, BLUE, { first: 1, last: 2 })]
    expect(target.frameAt(clips, 1000)).toEqual([RED, RED, RED, RED, RED])
    expect(target.frameAt(clips, 2000)).toEqual([RED, BLUE, BLUE, RED, RED])
  })

  it('clear turns the whole piece off, even LEDs lit by earlier clips', () => {
    const target = createLedTarget(3)
    const clips = [fill('a', 0, 100, RED), clip({ id: 'b', startMs: 500, durationMs: 100, action: 'clear' })]
    expect(target.frameAt(clips, 500)).toEqual([BLACK, BLACK, BLACK])
    expect(target.frameAt(clips, 5000)).toEqual([BLACK, BLACK, BLACK])
  })

  it('a continuous animation lights its range while active and turns the piece off when it ends', () => {
    const target = createLedTarget(6)
    const clips = [
      fill('a', 0, 100, RED),
      clip({ id: 'b', startMs: 1000, durationMs: 2000, action: 'animate', animation: 'window_light', params: { color: [255, 180, 50] }, first: 2, last: 3 })
    ]
    const during = target.frameAt(clips, 2000)
    expect(during.slice(0, 2)).toEqual([RED, RED])
    expect(during.slice(4)).toEqual([RED, RED])
    expect(during[2]![0]).toBeGreaterThan(100)
    expect(target.frameAt(clips, 3000)).toEqual(Array(6).fill(BLACK))
  })

  it('a fade reaches its colour by the end of the clip and holds it afterwards', () => {
    const target = createLedTarget(2)
    const clips = [clip({ id: 'f', startMs: 0, durationMs: 2000, action: 'animate', animation: 'fade', params: { color: [200, 0, 0], from_color: [0, 0, 0] }, durationSec: 2 })]
    expect(target.frameAt(clips, 0)[0]).toEqual([0, 0, 0])
    const mid = target.frameAt(clips, 1000)[0]![0]
    expect(mid).toBeGreaterThan(60)
    expect(mid).toBeLessThan(140)
    expect(target.frameAt(clips, 2000)[0]).toEqual([200, 0, 0])
    expect(target.frameAt(clips, 60000)[0]).toEqual([200, 0, 0])
  })

  it('steps forward in time and rebuilds when the playhead goes back', () => {
    const target = createLedTarget(1)
    const clips = [clip({ id: 'f', startMs: 0, durationMs: 4000, action: 'animate', animation: 'fade', params: { color: [100, 0, 0], from_color: [0, 0, 0] }, durationSec: 4 })]
    const at3 = target.frameAt(clips, 3000)[0]![0]
    const at1 = target.frameAt(clips, 1000)[0]![0]
    expect(at3).toBeGreaterThan(at1)
    expect(at1).toBeGreaterThan(10)
    expect(at1).toBeLessThan(40)
  })

  it('rebuilds the animation when the clip parameters change', () => {
    const target = createLedTarget(2)
    const red = [fill('a', 0, 100, RED)]
    expect(target.frameAt(red, 50)).toEqual([RED, RED])
    const blue = [fill('a', 0, 100, BLUE)]
    expect(target.frameAt(blue, 50)).toEqual([BLUE, BLUE])
  })

  it('ignores an animate clip without a known animation and clips that start later', () => {
    const target = createLedTarget(2)
    const clips = [
      clip({ id: 'x', startMs: 0, durationMs: 1000, action: 'animate', animation: null }),
      clip({ id: 'y', startMs: 0, durationMs: 1000, action: 'animate', animation: 'disco' }),
      fill('z', 5000, 100, RED)
    ]
    expect(target.frameAt(clips, 500)).toEqual([BLACK, BLACK])
  })
})
