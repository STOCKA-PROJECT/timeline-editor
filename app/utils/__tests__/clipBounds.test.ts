import { describe, expect, it } from 'vitest'
import { assignLanes, constrainMove, constrainResize, constrainResizeStart, freeRange, snapTo } from '~/utils/clipBounds'

const a = { id: 'a', startMs: 0, durationMs: 1000 }
const b = { id: 'b', startMs: 3000, durationMs: 1000 }
const c = { id: 'c', startMs: 6000, durationMs: 1000 }
const track = [a, b, c]

describe('freeRange', () => {
  it('bounds a clip by the end of the previous one and the start of the next one', () => {
    expect(freeRange(b, track)).toEqual({ prevEnd: 1000, nextStart: 6000, minStart: 1000, maxStart: 5000 })
  })

  it('uses 0 and Infinity when there is no neighbour on that side', () => {
    expect(freeRange(a, track)).toMatchObject({ prevEnd: 0, nextStart: 3000, minStart: 0, maxStart: 2000 })
    expect(freeRange(c, track)).toMatchObject({ prevEnd: 4000, nextStart: Infinity, maxStart: Infinity })
  })

  it('ignores the clip itself and keeps the current position reachable when clips already overlap', () => {
    const overlapping = { id: 'x', startMs: 500, durationMs: 1000 }
    const r = freeRange(overlapping, [a, overlapping, b])
    expect(r.minStart).toBe(500)
    expect(r.maxStart).toBe(2000)
  })

  it('treats a zero-length neighbour at the same start as previous', () => {
    const r = freeRange({ id: 'y', startMs: 2000, durationMs: 500 }, [{ id: 'z', startMs: 2000, durationMs: 0 }])
    expect(r.prevEnd).toBe(2000)
    expect(r.nextStart).toBe(Infinity)
  })
})

describe('snapTo', () => {
  it('snaps to the closest target within the threshold and otherwise keeps the value', () => {
    expect(snapTo(1040, [1000, 2000], 60)).toBe(1000)
    expect(snapTo(1960, [1000, 2000], 60)).toBe(2000)
    expect(snapTo(1500, [1000, 2000], 60)).toBe(1500)
    expect(snapTo(1500, [Infinity, 1490], 60)).toBe(1490)
  })
})

describe('constrainMove', () => {
  it('rounds to the grid and clamps against both neighbours', () => {
    expect(constrainMove(b, track, 3120)).toBe(3100)
    expect(constrainMove(b, track, 500)).toBe(1000)
    expect(constrainMove(b, track, 9000)).toBe(5000)
  })

  it('never goes below 0 and is unbounded on the right without a next clip', () => {
    expect(constrainMove(a, track, -400)).toBe(0)
    expect(constrainMove(c, track, 99_000)).toBe(99_000)
  })

  it('does not jump over a neighbour even when dragged far past it', () => {
    expect(constrainMove(a, track, 10_000)).toBe(2000)
  })

  it('magnetises the start to the previous end and the end to the next start', () => {
    expect(constrainMove(b, track, 1120, { snapMs: 200 })).toBe(1000)
    expect(constrainMove(b, track, 4850, { snapMs: 200 })).toBe(5000)
    expect(constrainMove(b, track, 4700, { snapMs: 200 })).toBe(4700)
  })

  it('snaps to extra targets such as the playhead, by start or by end', () => {
    expect(constrainMove(b, track, 2460, { snapMs: 100, snapTargets: [2500] })).toBe(2500)
    expect(constrainMove(b, track, 1540, { snapMs: 100, snapTargets: [2500] })).toBe(1500)
  })

  it('a snap can not push the clip into a neighbour', () => {
    expect(constrainMove(b, track, 5000, { snapMs: 300, snapTargets: [5200] })).toBe(5000)
  })
})

describe('constrainResize', () => {
  it('rounds, enforces the minimum and stops at the next clip', () => {
    expect(constrainResize(b, track, 1530)).toBe(1550)
    expect(constrainResize(b, track, 20)).toBe(100)
    expect(constrainResize(b, track, 9000)).toBe(3000)
  })

  it('is unbounded without a next clip and snaps the end to the next start or a target', () => {
    expect(constrainResize(c, track, 50_000)).toBe(50_000)
    expect(constrainResize(b, track, 2880, { snapMs: 200 })).toBe(3000)
    expect(constrainResize(b, track, 1960, { snapMs: 100, snapTargets: [5000] })).toBe(2000)
  })

  it('keeps the minimum even when the next clip is closer than that', () => {
    const tight = { id: 't', startMs: 2950, durationMs: 50 }
    expect(constrainResize(tight, [tight, b], 500)).toBe(100)
  })
})

describe('allowOverlap', () => {
  it('lets a clip move over and past its neighbours, still snapping to their edges', () => {
    expect(constrainMove(b, track, 500, { allowOverlap: true })).toBe(500)
    expect(constrainMove(b, track, 9000, { allowOverlap: true })).toBe(9000)
    expect(constrainMove(b, track, 1120, { allowOverlap: true, snapMs: 200 })).toBe(1000)
    expect(constrainMove(b, track, -400, { allowOverlap: true })).toBe(0)
  })

  it('lets a clip grow into the next one but never below the minimum', () => {
    expect(constrainResize(b, track, 9000, { allowOverlap: true })).toBe(9000)
    expect(constrainResize(b, track, 20, { allowOverlap: true })).toBe(100)
    expect(constrainResize(b, track, 2880, { allowOverlap: true, snapMs: 200 })).toBe(3000)
  })
})

describe('assignLanes', () => {
  it('keeps non-overlapping clips on one lane', () => {
    const { lanes, count } = assignLanes(track)
    expect(count).toBe(1)
    expect([...lanes.values()]).toEqual([0, 0, 0])
  })

  it('stacks overlapping clips on the first free lane', () => {
    const x = { id: 'x', startMs: 500, durationMs: 1000 }
    const y = { id: 'y', startMs: 800, durationMs: 300 }
    const z = { id: 'z', startMs: 1500, durationMs: 100 }
    const { lanes, count } = assignLanes([a, x, y, z, b])
    expect(count).toBe(3)
    expect(lanes.get('a')).toBe(0)
    expect(lanes.get('x')).toBe(1)
    expect(lanes.get('y')).toBe(2)
    expect(lanes.get('z')).toBe(0)
    expect(lanes.get('b')).toBe(0)
  })

  it('a clip may start exactly where the previous one ends on the same lane', () => {
    const { count } = assignLanes([{ id: 'p', startMs: 0, durationMs: 1000 }, { id: 'q', startMs: 1000, durationMs: 1000 }])
    expect(count).toBe(1)
  })

  it('an empty track still has one lane', () => {
    expect(assignLanes([]).count).toBe(1)
  })
})

describe('constrainResize with a maximum', () => {
  it('caps the duration at maxMs (the rest of an audio file) but never under minMs', () => {
    expect(constrainResize(a, [], 5000, { allowOverlap: true, maxMs: 2500 })).toBe(2500)
    expect(constrainResize(a, [], 500, { allowOverlap: true, maxMs: 2500 })).toBe(500)
    expect(constrainResize(a, [], 5000, { allowOverlap: true, maxMs: 20, minMs: 100 })).toBe(100)
  })
})

describe('constrainResizeStart', () => {
  it('moves the left edge on the grid while the end stays put, never shorter than minMs', () => {
    expect(constrainResizeStart(b, track, 3220, { allowOverlap: true })).toBe(3200)
    expect(constrainResizeStart(b, track, 3990, { allowOverlap: true, minMs: 100 })).toBe(3900)
    expect(constrainResizeStart(b, track, 4500, { allowOverlap: true, minMs: 100 })).toBe(3900)
  })

  it('snaps to the previous clip end and the extra targets', () => {
    expect(constrainResizeStart(b, track, 1030, { allowOverlap: true, snapMs: 60 })).toBe(1000)
    expect(constrainResizeStart(b, track, 2040, { allowOverlap: true, snapMs: 60, snapTargets: [2000] })).toBe(2000)
    expect(constrainResizeStart(b, track, 2040, { allowOverlap: true, snapMs: 0, snapTargets: [2000] })).toBe(2050)
  })

  it('respects minStartMs (an audio clip cannot start before its file) and never goes below 0', () => {
    expect(constrainResizeStart(b, track, 1500, { allowOverlap: true, minStartMs: 2000 })).toBe(2000)
    expect(constrainResizeStart(a, [], -500, { allowOverlap: true })).toBe(0)
  })

  it('stops at the previous clip when overlapping is not allowed', () => {
    expect(constrainResizeStart(b, track, 500, { allowOverlap: false })).toBe(1000)
    expect(constrainResizeStart(b, track, 500, { allowOverlap: true })).toBe(500)
  })
})
