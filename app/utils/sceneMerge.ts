import type { SceneClip, SceneDocument, SceneItem, SceneLayer, SceneTrack } from '~/types/editor'

// Three-way merge of two editions of the same scene that started from a common version (`base`):
// the local one (edited on this laptop, maybe offline) and the remote one (saved meanwhile from
// another session, the web or the MCP assistant). Entities are matched by id (UUIDs, so two
// sessions never mint the same one):
//   - changed on one side only → that side wins (including additions and deletions);
//   - changed on both sides to the same thing → no conflict;
//   - changed on both sides differently → a conflict the user resolves (mine or theirs).
// Scalar parts (board, duration, fps) and each port of `stripOrder` follow the same rule.

export type MergeEntityKind = 'layer' | 'item' | 'track' | 'clip'
export type MergeScalarKind = 'board' | 'durationMs' | 'fps' | 'stripOrder'
export type MergeConflictKind = MergeEntityKind | MergeScalarKind
export type MergeSide = 'local' | 'remote'

export interface MergeConflict {
  /** Stable id inside the merge (`clip:<id>`, `board`, `stripOrder:<port>`…). */
  id: string
  kind: MergeConflictKind
  /** Entity id or `stripOrder` port; absent for board, duration and fps. */
  entityId?: string
  base: unknown
  local: unknown
  remote: unknown
}

export interface MergeResult {
  /** The merged document with every conflict resolved in favour of the remote side. */
  merged: SceneDocument
  conflicts: MergeConflict[]
  /** Inputs, kept to re-resolve the conflicts with the user's choices. */
  inputs: { base: SceneDocument | null, local: SceneDocument, remote: SceneDocument }
}

export interface ResolvedMerge {
  document: SceneDocument
  /** Tracks and clips dropped because what they hung from was deleted on the other side. */
  removedOrphans: number
}

/** JSON with sorted keys: equality of two values regardless of key order. */
export function stableStringify(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`
  const obj = value as Record<string, unknown>
  const keys = Object.keys(obj).filter(k => obj[k] !== undefined).sort()
  return `{${keys.map(k => `${JSON.stringify(k)}:${stableStringify(obj[k])}`).join(',')}}`
}

function same(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b)
}

type Entity = { id: string }
const COLLECTIONS = { layer: 'layers', item: 'items', track: 'tracks', clip: 'clips' } as const satisfies Record<MergeEntityKind, keyof SceneDocument>

/** Outcome of one value under the three-way rule; `conflict` keeps the remote value tentatively. */
function pick<T>(base: T | undefined, local: T | undefined, remote: T | undefined): { value: T | undefined, conflict: boolean } {
  const localChanged = !same(local, base)
  const remoteChanged = !same(remote, base)
  if (!localChanged) return { value: remote, conflict: false }
  if (!remoteChanged) return { value: local, conflict: false }
  if (same(local, remote)) return { value: local, conflict: false }
  return { value: remote, conflict: true }
}

function byId<T extends Entity>(list: T[] | undefined): Map<string, T> {
  return new Map((list ?? []).map(e => [e.id, e]))
}

/** Ids in output order: the remote order, then what only the local side has, in its order. */
function orderedIds(local: Entity[], remote: Entity[]): string[] {
  const out = remote.map(e => e.id)
  const seen = new Set(out)
  for (const e of local) {
    if (!seen.has(e.id)) {
      out.push(e.id)
      seen.add(e.id)
    }
  }
  return out
}

function mergeCollection<T extends Entity>(
  kind: MergeEntityKind,
  base: T[] | undefined,
  local: T[] | undefined,
  remote: T[] | undefined,
  conflicts: MergeConflict[],
  choose: (id: string) => MergeSide | undefined
): T[] {
  const b = byId(base)
  const l = byId(local)
  const r = byId(remote)
  // An id the base had but neither side still has needs no decision; it simply stays deleted.
  const ids = orderedIds(local ?? [], remote ?? [])
  const out: T[] = []
  for (const id of ids) {
    const outcome = pick(b.get(id), l.get(id), r.get(id))
    let value = outcome.value
    if (outcome.conflict) {
      const conflictId = `${kind}:${id}`
      conflicts.push({ id: conflictId, kind, entityId: id, base: b.get(id), local: l.get(id), remote: r.get(id) })
      if (choose(conflictId) === 'local') value = l.get(id)
    }
    if (value !== undefined) out.push(value)
  }
  return out
}

function mergeScalar<T>(
  kind: MergeScalarKind,
  base: T | undefined,
  local: T | undefined,
  remote: T | undefined,
  conflicts: MergeConflict[],
  choose: (id: string) => MergeSide | undefined,
  entityId?: string
): T | undefined {
  const outcome = pick(base, local, remote)
  if (!outcome.conflict) return outcome.value
  const conflictId = entityId === undefined ? kind : `${kind}:${entityId}`
  conflicts.push({ id: conflictId, kind, entityId, base, local, remote })
  return choose(conflictId) === 'local' ? local : outcome.value
}

function mergeStripOrder(
  base: Record<string, string[]> | undefined,
  local: Record<string, string[]> | undefined,
  remote: Record<string, string[]> | undefined,
  conflicts: MergeConflict[],
  choose: (id: string) => MergeSide | undefined
): Record<string, string[]> {
  const ports = [...new Set([...Object.keys(remote ?? {}), ...Object.keys(local ?? {})])]
  const out: Record<string, string[]> = {}
  for (const port of ports) {
    const value = mergeScalar('stripOrder', base?.[port], local?.[port], remote?.[port], conflicts, choose, port)
    if (value !== undefined) out[port] = value
  }
  return out
}

function mergeWith(
  base: SceneDocument | null,
  local: SceneDocument,
  remote: SceneDocument,
  choose: (id: string) => MergeSide | undefined
): { document: SceneDocument, conflicts: MergeConflict[] } {
  const conflicts: MergeConflict[] = []
  const document: SceneDocument = {
    schemaVersion: Math.max(local.schemaVersion ?? 1, remote.schemaVersion ?? 1),
    board: mergeScalar('board', base?.board, local.board, remote.board, conflicts, choose) ?? remote.board,
    layers: mergeCollection<SceneLayer>('layer', base?.layers, local.layers, remote.layers, conflicts, choose),
    items: mergeCollection<SceneItem>('item', base?.items, local.items, remote.items, conflicts, choose),
    tracks: mergeCollection<SceneTrack>('track', base?.tracks, local.tracks, remote.tracks, conflicts, choose),
    clips: mergeCollection<SceneClip>('clip', base?.clips, local.clips, remote.clips, conflicts, choose),
    durationMs: mergeScalar('durationMs', base?.durationMs, local.durationMs, remote.durationMs, conflicts, choose) ?? remote.durationMs,
    fps: mergeScalar('fps', base?.fps, local.fps, remote.fps, conflicts, choose),
    stripOrder: mergeStripOrder(base?.stripOrder, local.stripOrder, remote.stripOrder, conflicts, choose)
  }
  if (document.fps === undefined) delete document.fps
  return { document, conflicts }
}

/** Three-way merge; conflicts are reported and tentatively resolved in favour of the remote side. */
export function mergeScenes(base: SceneDocument | null, local: SceneDocument, remote: SceneDocument): MergeResult {
  const { document, conflicts } = mergeWith(base, local, remote, () => undefined)
  return { merged: document, conflicts, inputs: { base, local, remote } }
}

/**
 * Applies the user's choice for each conflict (missing choices keep the remote side), then drops
 * what lost its parent: tracks whose item is gone, clips whose track is gone, and strip-order ids of
 * items that no longer exist. Items whose layer is gone move to the top layer instead of vanishing.
 */
export function resolveMerge(result: MergeResult, choices: Record<string, MergeSide> = {}): ResolvedMerge {
  const { base, local, remote } = result.inputs
  const { document } = mergeWith(base, local, remote, id => choices[id])
  return removeOrphans(document)
}

/** Keeps the document consistent after a merge; see {@link resolveMerge}. */
export function removeOrphans(doc: SceneDocument): ResolvedMerge {
  const layerIds = new Set(doc.layers.map(l => l.id))
  const topLayer = [...doc.layers].sort((a, b) => b.z - a.z)[0]?.id
  const items = doc.items.map(i => (layerIds.has(i.layerId) || !topLayer ? i : { ...i, layerId: topLayer }))
  const itemIds = new Set(items.map(i => i.id))
  const tracks = doc.tracks.filter(t => itemIds.has(t.itemId))
  const trackIds = new Set(tracks.map(t => t.id))
  const clips = doc.clips.filter(c => trackIds.has(c.trackId))
  const stripOrder = Object.fromEntries(
    Object.entries(doc.stripOrder ?? {}).map(([port, ids]) => [port, ids.filter(id => itemIds.has(id))])
  )
  const removedOrphans = (doc.tracks.length - tracks.length) + (doc.clips.length - clips.length)
  return { document: { ...doc, items, tracks, clips, stripOrder }, removedOrphans }
}

/** Which collection holds an entity kind (for the conflict dialog). */
export function collectionOf(kind: MergeEntityKind): (typeof COLLECTIONS)[MergeEntityKind] {
  return COLLECTIONS[kind]
}
