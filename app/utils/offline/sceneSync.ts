import { emptyDocument, type SceneDocument } from '~/types/editor'
import { isNetworkFailure, OfflineUnavailableError } from '~/utils/offline/cachedRequest'
import type { KvStore } from '~/utils/offline/kvStore'
import { mergeScenes, resolveMerge, type MergeResult, type MergeSide } from '~/utils/sceneMerge'

// Keeps a timeline's scene in two places: the server (source of truth) and the laptop (IndexedDB).
// Every edit is written locally first; the server copy follows when it can be reached. The local
// record remembers which server version it started from (`base` / `baseVersion`), so when the
// server moved on meanwhile the two editions are merged three-way (see `sceneMerge`).

export interface SceneRecord {
  key: string
  orgSlug: string
  timelineId: number
  timelineName: string
  /** Latest local edition. */
  document: SceneDocument
  /** Last edition known to be on the server (null: the timeline had no scene yet). */
  base: SceneDocument | null
  /** Server version of {@link base}; null when the server had no scene. */
  baseVersion: number | null
  /** The local edition has changes the server does not have yet. */
  pending: boolean
  /** Epoch ms of the last local write. */
  updatedAt: number
  /** Epoch ms of the last successful sync with the server. */
  syncedAt: number | null
}

export interface RemoteScene {
  document: SceneDocument | null
  version: number | null
}

/** The server side of the sync: the editor's API through the BFF. */
export interface SceneServer {
  fetch(): Promise<RemoteScene>
  /** Saves and returns the new version; throws {@link VersionConflictError} on a stale version. */
  put(document: SceneDocument, version: number | null): Promise<number>
}

/** The server refused the save because its version moved on (HTTP 409 `timeline_scenes.version_conflict`). */
export class VersionConflictError extends Error {
  constructor() {
    super('La escena es va modificar en una altra sessió.')
    this.name = 'VersionConflictError'
  }
}

export interface SceneContext {
  kv: KvStore
  server: SceneServer
  orgSlug: string
  timelineId: number
  timelineName: string
  now?: () => number
}

export interface OpenedScene {
  document: SceneDocument
  /** Server version the editor builds on (what the next save sends). */
  version: number | null
  /** Changes still to upload (offline edits, or a merge to save). */
  pending: boolean
  /** The server could not be reached: the document is the local copy. */
  offline: boolean
  /** The local and server editions both changed the same things: the user must choose. */
  merge?: MergeResult
  /** Server version the pending merge was computed against. */
  remoteVersion?: number | null
  /** The local and server editions were merged automatically. */
  merged?: boolean
}

export type SaveOutcome =
  | { status: 'saved', version: number }
  | { status: 'merged', version: number, document: SceneDocument }
  | { status: 'offline' }
  | { status: 'conflict', merge: MergeResult, remoteVersion: number | null }

export function sceneKey(orgSlug: string, timelineId: number): string {
  return `${orgSlug}/${timelineId}`
}

export async function readRecord(kv: KvStore, orgSlug: string, timelineId: number): Promise<SceneRecord | undefined> {
  return await kv.get<SceneRecord>('scenes', sceneKey(orgSlug, timelineId)).catch(() => undefined)
}

/** Every timeline with a local copy, most recently edited first. */
export async function listRecords(kv: KvStore): Promise<SceneRecord[]> {
  const all = await kv.values<SceneRecord>('scenes').catch(() => [] as SceneRecord[])
  return all.sort((a, b) => b.updatedAt - a.updatedAt)
}

function newRecord(ctx: SceneContext, patch: Partial<SceneRecord> & Pick<SceneRecord, 'document'>): SceneRecord {
  const now = (ctx.now ?? Date.now)()
  return {
    key: sceneKey(ctx.orgSlug, ctx.timelineId),
    orgSlug: ctx.orgSlug,
    timelineId: ctx.timelineId,
    timelineName: ctx.timelineName,
    base: null,
    baseVersion: null,
    pending: false,
    updatedAt: now,
    syncedAt: null,
    ...patch
  }
}

/**
 * A plain JSON copy: the editor hands over reactive (Proxy) documents, which IndexedDB's structured
 * clone refuses (`DataCloneError`). Records are JSON by nature.
 */
function plain<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

async function write(ctx: SceneContext, record: SceneRecord): Promise<void> {
  await ctx.kv.put('scenes', record.key, plain(record))
}

/**
 * Opens a timeline: the server copy when it is reachable, merged with pending local edits if
 * there are any; the local copy when it is not.
 */
export async function openScene(ctx: SceneContext): Promise<OpenedScene> {
  const local = await readRecord(ctx.kv, ctx.orgSlug, ctx.timelineId)
  let remote: RemoteScene
  try {
    remote = await ctx.server.fetch()
  } catch (error) {
    if (!isNetworkFailure(error)) throw error
    if (!local) throw new OfflineUnavailableError(sceneKey(ctx.orgSlug, ctx.timelineId), error)
    return { document: local.document, version: local.baseVersion, pending: local.pending, offline: true }
  }
  const now = (ctx.now ?? Date.now)()
  const remoteDoc = remote.document ?? emptyDocument()

  if (!local || !local.pending) {
    await write(ctx, newRecord(ctx, { document: remoteDoc, base: remote.document, baseVersion: remote.version, syncedAt: now }))
    return { document: remoteDoc, version: remote.version, pending: false, offline: false }
  }
  if (remote.version === local.baseVersion) {
    // Nobody saved meanwhile: the local edition simply goes up.
    await write(ctx, { ...local, timelineName: ctx.timelineName })
    return { document: local.document, version: local.baseVersion, pending: true, offline: false }
  }
  const merge = mergeScenes(local.base, local.document, remoteDoc)
  if (merge.conflicts.length > 0) {
    return { document: local.document, version: local.baseVersion, pending: true, offline: false, merge, remoteVersion: remote.version }
  }
  const { document } = resolveMerge(merge)
  await write(ctx, { ...local, timelineName: ctx.timelineName, document, base: remote.document, baseVersion: remote.version, updatedAt: now })
  return { document, version: remote.version, pending: true, offline: false, merged: true }
}

/** Writes the local edition (marked pending) without touching the server. */
export async function saveLocal(ctx: SceneContext, document: SceneDocument, version: number | null, base?: SceneDocument | null): Promise<SceneRecord> {
  const existing = await readRecord(ctx.kv, ctx.orgSlug, ctx.timelineId)
  const record: SceneRecord = existing
    ? { ...existing, timelineName: ctx.timelineName || existing.timelineName, document, pending: true, updatedAt: (ctx.now ?? Date.now)() }
    : newRecord(ctx, { document, base: base ?? null, baseVersion: version, pending: true })
  if (existing && existing.baseVersion !== version) {
    // The editor moved to another server version (a merge was applied): it becomes the new base.
    record.baseVersion = version
    if (base !== undefined) record.base = base
  }
  await write(ctx, record)
  return record
}

/**
 * Saves the document locally, then on the server with `version`. A stale version triggers a
 * three-way merge against the server's current edition; without conflicts the merge is saved
 * right away, with conflicts the caller asks the user.
 */
export async function saveScene(ctx: SceneContext, document: SceneDocument, version: number | null): Promise<SaveOutcome> {
  const record = await saveLocal(ctx, document, version)
  const now = (ctx.now ?? Date.now)()
  let newVersion: number
  try {
    newVersion = await ctx.server.put(document, version)
  } catch (error) {
    if (isNetworkFailure(error)) return { status: 'offline' }
    if (!(error instanceof VersionConflictError)) throw error
    return await mergeAfterConflict(ctx, record)
  }
  await write(ctx, { ...record, base: document, baseVersion: newVersion, pending: false, syncedAt: now })
  return { status: 'saved', version: newVersion }
}

/** How many times a save retries when the server moves on again while a merge is being saved. */
const MAX_MERGE_ATTEMPTS = 3

async function mergeAfterConflict(ctx: SceneContext, record: SceneRecord, attempt = 1): Promise<SaveOutcome> {
  let remote: RemoteScene
  try {
    remote = await ctx.server.fetch()
  } catch (error) {
    if (isNetworkFailure(error)) return { status: 'offline' }
    throw error
  }
  const merge = mergeScenes(record.base, record.document, remote.document ?? emptyDocument())
  if (merge.conflicts.length > 0) return { status: 'conflict', merge, remoteVersion: remote.version }
  const { document } = resolveMerge(merge)
  return await saveMerged(ctx, record, document, remote, attempt)
}

async function saveMerged(ctx: SceneContext, record: SceneRecord, document: SceneDocument, remote: RemoteScene, attempt = 1): Promise<SaveOutcome> {
  const now = (ctx.now ?? Date.now)()
  // From here on the server's edition is the base: a failure leaves the merge pending locally.
  const rebased: SceneRecord = { ...record, document, base: remote.document, baseVersion: remote.version, pending: true, updatedAt: now }
  await write(ctx, rebased)
  try {
    const version = await ctx.server.put(document, remote.version)
    await write(ctx, { ...rebased, base: document, baseVersion: version, pending: false, syncedAt: now })
    return { status: 'merged', version, document }
  } catch (error) {
    if (isNetworkFailure(error)) return { status: 'offline' }
    if (error instanceof VersionConflictError && attempt < MAX_MERGE_ATTEMPTS) {
      // Someone saved again while the merge was going up: merge once more against that edition.
      return await mergeAfterConflict(ctx, rebased, attempt + 1)
    }
    throw error
  }
}

/** Applies the user's choices to a conflicting merge and saves the result. */
export async function resolveSceneConflict(
  ctx: SceneContext,
  merge: MergeResult,
  remoteVersion: number | null,
  choices: Record<string, MergeSide>
): Promise<{ outcome: SaveOutcome, document: SceneDocument }> {
  const record = (await readRecord(ctx.kv, ctx.orgSlug, ctx.timelineId)) ?? newRecord(ctx, { document: merge.inputs.local, pending: true })
  const { document } = resolveMerge(merge, choices)
  const outcome = await saveMerged(ctx, record, document, { document: merge.inputs.remote, version: remoteVersion })
  return { outcome, document }
}

/**
 * Re-applies edits made while a save was in flight on top of what the save produced (a merge): the
 * document that was sent is the common ancestor of both, so the in-flight edits win any clash.
 */
export function rebaseEdits(sent: SceneDocument, current: SceneDocument, saved: SceneDocument): SceneDocument {
  const merge = mergeScenes(sent, current, saved)
  const choices = Object.fromEntries(merge.conflicts.map(c => [c.id, 'local' as const]))
  return resolveMerge(merge, choices).document
}
