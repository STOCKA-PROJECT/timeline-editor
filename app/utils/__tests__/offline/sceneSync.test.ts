import { describe, expect, it } from 'vitest'
import { emptyDocument, type SceneDocument } from '~/types/editor'
import { OfflineUnavailableError } from '~/utils/offline/cachedRequest'
import { MemoryKvStore } from '~/utils/offline/kvStore'
import {
  listRecords,
  openScene,
  readRecord,
  rebaseEdits,
  resolveSceneConflict,
  saveLocal,
  saveScene,
  VersionConflictError,
  type SceneContext,
  type SceneServer
} from '~/utils/offline/sceneSync'

const offline = () => new TypeError('Failed to fetch')

/** In-memory backend with optimistic versions, switchable offline. */
class FakeServer implements SceneServer {
  document: SceneDocument | null = null
  version: number | null = null
  online = true
  puts: Array<{ version: number | null }> = []

  async fetch() {
    if (!this.online) throw offline()
    return { document: this.document ? structuredClone(this.document) : null, version: this.version }
  }

  async put(document: SceneDocument, version: number | null) {
    if (!this.online) throw offline()
    this.puts.push({ version })
    if (version !== this.version) throw new VersionConflictError()
    this.document = structuredClone(document)
    this.version = (this.version ?? 0) + 1
    return this.version
  }

  /** Another session saves directly. */
  saveElsewhere(fn: (d: SceneDocument) => void) {
    const doc = structuredClone(this.document ?? emptyDocument())
    fn(doc)
    this.document = doc
    this.version = (this.version ?? 0) + 1
  }
}

function setup() {
  const kv = new MemoryKvStore()
  const server = new FakeServer()
  let clock = 1000
  const ctx: SceneContext = { kv, server, orgSlug: 'org', timelineId: 7, timelineName: 'Nadal', now: () => clock++ }
  return { kv, server, ctx }
}

function withDuration(doc: SceneDocument, ms: number): SceneDocument {
  return { ...structuredClone(doc), durationMs: ms }
}

describe('openScene', () => {
  it('online without a local copy: the server edition, stored locally as synced', async () => {
    const { ctx, server, kv } = setup()
    server.saveElsewhere(d => { d.durationMs = 5000 })
    const opened = await openScene(ctx)
    expect(opened).toMatchObject({ version: 1, pending: false, offline: false })
    expect(opened.document.durationMs).toBe(5000)
    const record = await readRecord(kv, 'org', 7)
    expect(record).toMatchObject({ baseVersion: 1, pending: false, timelineName: 'Nadal' })
  })

  it('online, timeline without scene: an empty document with version null', async () => {
    const { ctx } = setup()
    const opened = await openScene(ctx)
    expect(opened.version).toBeNull()
    expect(opened.document.items).toEqual([])
  })

  it('offline with a local copy: the local edition, flagged offline', async () => {
    const { ctx, server } = setup()
    server.saveElsewhere(d => { d.durationMs = 5000 })
    await openScene(ctx)
    server.online = false
    const opened = await openScene(ctx)
    expect(opened).toMatchObject({ offline: true, pending: false, version: 1 })
    expect(opened.document.durationMs).toBe(5000)
  })

  it('offline without a local copy: OfflineUnavailableError', async () => {
    const { ctx, server } = setup()
    server.online = false
    await expect(openScene(ctx)).rejects.toBeInstanceOf(OfflineUnavailableError)
  })

  it('a non-network error is rethrown', async () => {
    const { ctx, server } = setup()
    server.fetch = async () => { throw Object.assign(new Error('forbidden'), { response: { status: 403 } }) }
    await expect(openScene(ctx)).rejects.toMatchObject({ response: { status: 403 } })
  })

  it('pending local edits and an unchanged server: the local edition, still pending', async () => {
    const { ctx, server } = setup()
    server.saveElsewhere(() => {})
    const opened = await openScene(ctx)
    await saveLocal(ctx, withDuration(opened.document, 9000), opened.version)
    const again = await openScene(ctx)
    expect(again).toMatchObject({ pending: true, version: 1, offline: false })
    expect(again.document.durationMs).toBe(9000)
  })

  it('pending local edits and a server that moved on: merged automatically', async () => {
    const { ctx, server, kv } = setup()
    server.saveElsewhere(() => {})
    const opened = await openScene(ctx)
    await saveLocal(ctx, withDuration(opened.document, 9000), opened.version)
    server.saveElsewhere(d => { d.board.width = 3333 })
    const again = await openScene(ctx)
    expect(again).toMatchObject({ merged: true, pending: true, version: 2 })
    expect(again.document.durationMs).toBe(9000)
    expect(again.document.board.width).toBe(3333)
    expect(await readRecord(kv, 'org', 7)).toMatchObject({ baseVersion: 2, pending: true })
  })

  it('pending local edits clashing with the server: the conflicts are returned', async () => {
    const { ctx, server } = setup()
    server.saveElsewhere(() => {})
    const opened = await openScene(ctx)
    await saveLocal(ctx, withDuration(opened.document, 9000), opened.version)
    server.saveElsewhere(d => { d.durationMs = 1234 })
    const again = await openScene(ctx)
    expect(again.merge?.conflicts.map(c => c.id)).toEqual(['durationMs'])
    expect(again.remoteVersion).toBe(2)
    expect(again.document.durationMs).toBe(9000)
  })
})

describe('saveScene', () => {
  it('online: saved on the server and the local record is synced', async () => {
    const { ctx, server, kv } = setup()
    const opened = await openScene(ctx)
    const outcome = await saveScene(ctx, withDuration(opened.document, 4000), opened.version)
    expect(outcome).toEqual({ status: 'saved', version: 1 })
    expect(server.document?.durationMs).toBe(4000)
    expect(await readRecord(kv, 'org', 7)).toMatchObject({ pending: false, baseVersion: 1 })
  })

  it('offline: kept locally as pending, uploaded later', async () => {
    const { ctx, server, kv } = setup()
    const opened = await openScene(ctx)
    server.online = false
    expect(await saveScene(ctx, withDuration(opened.document, 4000), opened.version)).toEqual({ status: 'offline' })
    expect(await readRecord(kv, 'org', 7)).toMatchObject({ pending: true })
    server.online = true
    const record = await readRecord(kv, 'org', 7)
    expect(await saveScene(ctx, record!.document, record!.baseVersion)).toEqual({ status: 'saved', version: 1 })
    expect(server.document?.durationMs).toBe(4000)
  })

  it('stale version without clashes: merged with the other session and saved', async () => {
    const { ctx, server } = setup()
    server.saveElsewhere(() => {})
    const opened = await openScene(ctx)
    server.saveElsewhere(d => { d.board.width = 2222 })
    const outcome = await saveScene(ctx, withDuration(opened.document, 4000), opened.version)
    expect(outcome.status).toBe('merged')
    if (outcome.status !== 'merged') return
    expect(outcome.version).toBe(3)
    expect(outcome.document.board.width).toBe(2222)
    expect(server.document).toMatchObject({ durationMs: 4000, board: { width: 2222 } })
  })

  it('stale version with clashes: conflict reported, nothing overwritten', async () => {
    const { ctx, server } = setup()
    server.saveElsewhere(() => {})
    const opened = await openScene(ctx)
    server.saveElsewhere(d => { d.durationMs = 1111 })
    const outcome = await saveScene(ctx, withDuration(opened.document, 4000), opened.version)
    expect(outcome.status).toBe('conflict')
    expect(server.document?.durationMs).toBe(1111)
  })

  it('a conflict while offline again stays pending', async () => {
    const { ctx, server } = setup()
    server.saveElsewhere(() => {})
    const opened = await openScene(ctx)
    server.saveElsewhere(d => { d.board.width = 5 })
    const realFetch = server.fetch.bind(server)
    let calls = 0
    server.fetch = async () => {
      calls++
      throw offline()
    }
    expect(await saveScene(ctx, withDuration(opened.document, 4000), opened.version)).toEqual({ status: 'offline' })
    expect(calls).toBe(1)
    server.fetch = realFetch
  })

  it('the server moving on again during the merged save is merged once more', async () => {
    const { ctx, server } = setup()
    server.saveElsewhere(() => {})
    const opened = await openScene(ctx)
    server.saveElsewhere(d => { d.board.width = 2222 })
    let intruded = false
    const realPut = server.put.bind(server)
    server.put = async (doc, version) => {
      // Right before the merged save lands, a third session saves.
      if (!intruded && version === 2) {
        intruded = true
        server.saveElsewhere(d => { d.fps = 50 })
      }
      return realPut(doc, version)
    }
    const outcome = await saveScene(ctx, withDuration(opened.document, 4000), opened.version)
    expect(outcome.status).toBe('merged')
    expect(server.document).toMatchObject({ durationMs: 4000, fps: 50, board: { width: 2222 } })
  })

  it('a non-network, non-conflict error is rethrown', async () => {
    const { ctx, server } = setup()
    const opened = await openScene(ctx)
    server.put = async () => { throw Object.assign(new Error('bad'), { response: { status: 400 } }) }
    await expect(saveScene(ctx, opened.document, opened.version)).rejects.toMatchObject({ response: { status: 400 } })
  })
})

describe('resolveSceneConflict', () => {
  it('saves the user’s choices on top of the server edition', async () => {
    const { ctx, server, kv } = setup()
    server.saveElsewhere(() => {})
    const opened = await openScene(ctx)
    server.saveElsewhere(d => { d.durationMs = 1111; d.board.width = 999 })
    const outcome = await saveScene(ctx, withDuration(opened.document, 4000), opened.version)
    if (outcome.status !== 'conflict') throw new Error('expected a conflict')
    const resolved = await resolveSceneConflict(ctx, outcome.merge, outcome.remoteVersion, { durationMs: 'local' })
    expect(resolved.outcome.status).toBe('merged')
    expect(resolved.document).toMatchObject({ durationMs: 4000, board: { width: 999 } })
    expect(server.document).toMatchObject({ durationMs: 4000, board: { width: 999 } })
    expect(await readRecord(kv, 'org', 7)).toMatchObject({ pending: false, baseVersion: 3 })
  })

  it('offline while resolving: the resolution is kept locally', async () => {
    const { ctx, server, kv } = setup()
    server.saveElsewhere(() => {})
    const opened = await openScene(ctx)
    server.saveElsewhere(d => { d.durationMs = 1111 })
    const outcome = await saveScene(ctx, withDuration(opened.document, 4000), opened.version)
    if (outcome.status !== 'conflict') throw new Error('expected a conflict')
    server.online = false
    const resolved = await resolveSceneConflict(ctx, outcome.merge, outcome.remoteVersion, { durationMs: 'local' })
    expect(resolved.outcome).toEqual({ status: 'offline' })
    expect(await readRecord(kv, 'org', 7)).toMatchObject({ pending: true, baseVersion: 2, document: { durationMs: 4000 } })
  })
})

describe('saveLocal and listRecords', () => {
  it('creates a pending record for a timeline never opened online', async () => {
    const { ctx, kv } = setup()
    await saveLocal(ctx, withDuration(emptyDocument(), 3000), null)
    expect(await readRecord(kv, 'org', 7)).toMatchObject({ pending: true, base: null, baseVersion: null })
  })

  it('lists local copies most recently edited first', async () => {
    const { kv } = setup()
    let t = 0
    const a: SceneContext = { kv, server: new FakeServer(), orgSlug: 'org', timelineId: 1, timelineName: 'A', now: () => ++t }
    const b: SceneContext = { ...a, timelineId: 2, timelineName: 'B' }
    await saveLocal(a, emptyDocument(), null)
    await saveLocal(b, emptyDocument(), null)
    expect((await listRecords(kv)).map(r => r.timelineName)).toEqual(['B', 'A'])
  })
})

describe('rebaseEdits', () => {
  it('re-applies edits made during a save on top of the merged result', () => {
    const sent = withDuration(emptyDocument(), 1000)
    const current = withDuration(sent, 2000)
    const saved = { ...structuredClone(sent), board: { ...sent.board, width: 4444 } }
    expect(rebaseEdits(sent, current, saved)).toMatchObject({ durationMs: 2000, board: { width: 4444 } })
  })

  it('in a clash the in-flight edit wins', () => {
    const sent = withDuration(emptyDocument(), 1000)
    expect(rebaseEdits(sent, withDuration(sent, 2000), withDuration(sent, 3000)).durationMs).toBe(2000)
  })
})
