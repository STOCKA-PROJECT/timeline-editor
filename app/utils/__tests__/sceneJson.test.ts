import { describe, expect, it } from 'vitest'
import { parseSceneDocument } from '~/utils/sceneJson'
import sample from './fixtures/belen-2026.show.json'
import { document } from './fixtures/belen2026'

describe('parseSceneDocument', () => {
  it('accepts a bare document and a backup bundle', () => {
    const doc = document()
    expect(parseSceneDocument(JSON.stringify(doc)).durationMs).toBe(122000)
    const bundle = { format: 'stocka-timeline', formatVersion: 1, exportedAt: '', timeline: { id: null, name: 'x' }, document: doc, execution: {} }
    expect(parseSceneDocument(JSON.stringify(bundle)).clips).toHaveLength(22)
  })

  it('rejects a show package with a clear message', () => {
    expect(() => parseSceneDocument(JSON.stringify(sample))).toThrow(/paquet de show/)
  })

  it('rejects invalid JSON, other formats and a newer schema', () => {
    expect(() => parseSceneDocument('{')).toThrow(/JSON vàlid/)
    expect(() => parseSceneDocument(JSON.stringify({ format: 'other' }))).toThrow(/còpia de seguretat/)
    expect(() => parseSceneDocument(JSON.stringify({ ...document(), schemaVersion: 99 }))).toThrow(/versió d'esquema/)
    expect(() => parseSceneDocument(JSON.stringify({ ...document(), board: { width: 0, height: 1 } }))).toThrow(/tauler/)
  })
})
