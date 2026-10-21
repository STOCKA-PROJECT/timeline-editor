import { describe, expect, it } from 'vitest'
import { emptyDocument, type SceneClip, type SceneDocument, type SceneItem, type SceneTrack } from '~/types/editor'
import { mergeScenes, removeOrphans, resolveMerge, stableStringify } from '~/utils/sceneMerge'

function item(id: string, patch: Partial<SceneItem> = {}): SceneItem {
  return { id, pieceId: 1, layerId: 'layer-1', x: 0, y: 0, width: 100, height: 100, rotation: 0, ...patch }
}
function track(id: string, itemId: string): SceneTrack {
  return { id, itemId, name: id }
}
function clip(id: string, trackId: string, patch: Partial<SceneClip> = {}): SceneClip {
  return { id, trackId, pieceTypeActionId: 1, startMs: 0, durationMs: 1000, paramValues: {}, ...patch }
}

/** A base with one item, its track and two clips. */
function baseDoc(): SceneDocument {
  return {
    ...emptyDocument(),
    items: [item('i1')],
    tracks: [track('t1', 'i1')],
    clips: [clip('c1', 't1'), clip('c2', 't1', { startMs: 2000 })],
    stripOrder: { 5: ['i1'] }
  }
}
function edit(doc: SceneDocument, fn: (d: SceneDocument) => void): SceneDocument {
  const copy = structuredClone(doc)
  fn(copy)
  return copy
}

describe('stableStringify', () => {
  it('ignores key order and undefined keys', () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: undefined } })).toBe(stableStringify({ b: { c: 2 }, a: 1 }))
  })
  it('distinguishes arrays order and values', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]))
    expect(stableStringify(undefined)).not.toBe(stableStringify(null))
  })
})

describe('mergeScenes · one side changed', () => {
  it('nothing changed anywhere → the same document, no conflicts', () => {
    const base = baseDoc()
    const r = mergeScenes(base, base, base)
    expect(r.conflicts).toEqual([])
    expect(stableStringify(r.merged)).toBe(stableStringify(base))
  })

  it('local edit of a clip + remote edit of another clip → both kept', () => {
    const base = baseDoc()
    const local = edit(base, d => { d.clips[0]!.startMs = 500 })
    const remote = edit(base, d => { d.clips[1]!.durationMs = 3000 })
    const r = mergeScenes(base, local, remote)
    expect(r.conflicts).toEqual([])
    expect(r.merged.clips.find(c => c.id === 'c1')!.startMs).toBe(500)
    expect(r.merged.clips.find(c => c.id === 'c2')!.durationMs).toBe(3000)
  })

  it('additions on both sides are all kept: remote order first, then local additions', () => {
    const base = baseDoc()
    const local = edit(base, d => { d.clips.push(clip('cL', 't1')) })
    const remote = edit(base, d => { d.clips.push(clip('cR', 't1')) })
    const r = mergeScenes(base, local, remote)
    expect(r.merged.clips.map(c => c.id)).toEqual(['c1', 'c2', 'cR', 'cL'])
  })

  it('a deletion on one side wins over an untouched entity', () => {
    const base = baseDoc()
    const local = edit(base, d => { d.clips = d.clips.filter(c => c.id !== 'c1') })
    const remote = edit(base, d => { d.clips = d.clips.filter(c => c.id !== 'c2') })
    const r = mergeScenes(base, local, remote)
    expect(r.conflicts).toEqual([])
    expect(r.merged.clips).toEqual([])
  })

  it('both deleting the same entity is not a conflict', () => {
    const base = baseDoc()
    const gone = edit(base, d => { d.clips = d.clips.filter(c => c.id !== 'c1') })
    expect(mergeScenes(base, gone, gone).conflicts).toEqual([])
  })

  it('both making the same change is not a conflict', () => {
    const base = baseDoc()
    const changed = edit(base, d => { d.items[0]!.x = 77 })
    const r = mergeScenes(base, changed, structuredClone(changed))
    expect(r.conflicts).toEqual([])
    expect(r.merged.items[0]!.x).toBe(77)
  })

  it('scalars changed on one side each are merged (board locally, duration remotely)', () => {
    const base = baseDoc()
    const local = edit(base, d => { d.board = { ...d.board, width: 2000 } })
    const remote = edit(base, d => { d.durationMs = 90000 })
    const r = mergeScenes(base, local, remote)
    expect(r.conflicts).toEqual([])
    expect(r.merged.board.width).toBe(2000)
    expect(r.merged.durationMs).toBe(90000)
  })

  it('strip order is merged per port', () => {
    const base = baseDoc()
    const local = edit(base, d => { d.stripOrder = { ...d.stripOrder, 6: ['i1'] } })
    const remote = edit(base, d => { d.stripOrder = { 5: [] } })
    const r = mergeScenes(base, local, remote)
    expect(r.conflicts).toEqual([])
    expect(r.merged.stripOrder).toEqual({ 5: [], 6: ['i1'] })
  })
})

describe('mergeScenes · conflicts', () => {
  it('the same clip changed differently on both sides is a conflict, remote kept tentatively', () => {
    const base = baseDoc()
    const local = edit(base, d => { d.clips[0]!.startMs = 100 })
    const remote = edit(base, d => { d.clips[0]!.startMs = 900 })
    const r = mergeScenes(base, local, remote)
    expect(r.conflicts).toHaveLength(1)
    expect(r.conflicts[0]).toMatchObject({ id: 'clip:c1', kind: 'clip', entityId: 'c1' })
    expect((r.conflicts[0]!.local as SceneClip).startMs).toBe(100)
    expect((r.conflicts[0]!.remote as SceneClip).startMs).toBe(900)
    expect(r.merged.clips.find(c => c.id === 'c1')!.startMs).toBe(900)
  })

  it('edited locally but deleted remotely is a conflict', () => {
    const base = baseDoc()
    const local = edit(base, d => { d.clips[0]!.label = 'nou' })
    const remote = edit(base, d => { d.clips = d.clips.filter(c => c.id !== 'c1') })
    const r = mergeScenes(base, local, remote)
    expect(r.conflicts.map(c => c.id)).toEqual(['clip:c1'])
    expect(r.conflicts[0]!.remote).toBeUndefined()
    expect(r.merged.clips.some(c => c.id === 'c1')).toBe(false)
  })

  it('board, duration, fps and a strip-order port can each conflict', () => {
    const base = baseDoc()
    const local = edit(base, d => { d.board.width = 1; d.durationMs = 1000; d.fps = 24; d.stripOrder = { 5: [] } })
    const remote = edit(base, d => { d.board.width = 2; d.durationMs = 2000; d.fps = 25; d.stripOrder = { 5: ['i1', 'x'] } })
    const ids = mergeScenes(base, local, remote).conflicts.map(c => c.id)
    expect(ids).toEqual(['board', 'durationMs', 'fps', 'stripOrder:5'])
  })

  it('without a base (never synced) only differing shared parts conflict', () => {
    const local = edit(emptyDocument(), d => { d.items = [item('a')] })
    const remote = edit(emptyDocument(), d => { d.items = [item('b')]; d.durationMs = 30000 })
    const r = mergeScenes(null, local, remote)
    expect(r.merged.items.map(i => i.id)).toEqual(['b', 'a'])
    expect(r.conflicts.map(c => c.id)).toEqual(['durationMs'])
  })
})

describe('resolveMerge', () => {
  function conflicting() {
    const base = baseDoc()
    const local = edit(base, d => { d.clips[0]!.startMs = 100; d.durationMs = 1000 })
    const remote = edit(base, d => { d.clips[0]!.startMs = 900; d.durationMs = 2000 })
    return mergeScenes(base, local, remote)
  }

  it('without choices keeps the remote side', () => {
    const { document } = resolveMerge(conflicting())
    expect(document.clips[0]!.startMs).toBe(900)
    expect(document.durationMs).toBe(2000)
  })

  it('applies each choice independently', () => {
    const { document } = resolveMerge(conflicting(), { 'clip:c1': 'local', durationMs: 'remote' })
    expect(document.clips[0]!.startMs).toBe(100)
    expect(document.durationMs).toBe(2000)
  })

  it('choosing the local side of "deleted remotely" brings the entity back', () => {
    const base = baseDoc()
    const local = edit(base, d => { d.clips[0]!.label = 'nou' })
    const remote = edit(base, d => { d.clips = d.clips.filter(c => c.id !== 'c1') })
    const { document } = resolveMerge(mergeScenes(base, local, remote), { 'clip:c1': 'local' })
    expect(document.clips.find(c => c.id === 'c1')!.label).toBe('nou')
  })

  it('drops tracks and clips whose item was deleted on the other side', () => {
    const base = baseDoc()
    const local = edit(base, d => { d.clips.push(clip('c3', 't1')) })
    const remote = edit(base, d => { d.items = []; d.tracks = []; d.clips = []; d.stripOrder = { 5: [] } })
    const r = mergeScenes(base, local, remote)
    expect(r.conflicts).toEqual([])
    const resolved = resolveMerge(r)
    expect(resolved.document.items).toEqual([])
    expect(resolved.document.clips).toEqual([])
    expect(resolved.removedOrphans).toBe(1)
  })
})

describe('removeOrphans', () => {
  it('moves items of a deleted layer to the top layer and cleans the strip order', () => {
    const doc: SceneDocument = {
      ...emptyDocument(),
      layers: [
        { id: 'low', name: 'a', z: 0, visible: true, locked: false, opacity: 1 },
        { id: 'top', name: 'b', z: 3, visible: true, locked: false, opacity: 1 }
      ],
      items: [item('i1', { layerId: 'gone' })],
      tracks: [track('t1', 'i1'), track('t2', 'ghost')],
      clips: [clip('c1', 't1'), clip('c2', 't2')],
      stripOrder: { 5: ['ghost', 'i1'] }
    }
    const { document, removedOrphans } = removeOrphans(doc)
    expect(document.items[0]!.layerId).toBe('top')
    expect(document.tracks.map(t => t.id)).toEqual(['t1'])
    expect(document.clips.map(c => c.id)).toEqual(['c1'])
    expect(document.stripOrder).toEqual({ 5: ['i1'] })
    expect(removedOrphans).toBe(2)
  })

  it('a consistent document is left as it is', () => {
    const doc = baseDoc()
    const { document, removedOrphans } = removeOrphans(doc)
    expect(stableStringify(document)).toBe(stableStringify(doc))
    expect(removedOrphans).toBe(0)
  })
})
