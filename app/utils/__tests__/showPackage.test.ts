import { describe, expect, it } from 'vitest'
import type { ShowPackage } from '~/types/show'
import { assembleShowPackage, buildShowPackage, serializeShowPackage, showHash, showHashInput } from '~/utils/showPackage'
import sample from './fixtures/belen-2026.show.json'
import * as fx from './fixtures/belen2026'

const expected = sample as ShowPackage

function input(overrides: Partial<Parameters<typeof buildShowPackage>[0]> = {}) {
  return { doc: fx.document(), catalog: fx.catalogLookups, orgPorts: fx.ports, ...fx.META, ...overrides }
}

function codes(issues: { code: string }[]) {
  return issues.map(i => i.code)
}

describe('buildShowPackage', () => {
  it('exports the 2026 slice exactly as the shared sample, hash included', async () => {
    const { pkg, errors, warnings } = await buildShowPackage(input())
    expect(errors).toEqual([])
    expect(codes(warnings)).toEqual([])
    expect(pkg).toEqual(expected)
  })

  it('computes the same hash as rpi4-system/tools/show_hash.py', async () => {
    const { meta, ...body } = expected
    expect(await showHash(body)).toBe(meta.hash)
  })

  it('the hash ignores meta and changes with content', async () => {
    const { pkg } = await buildShowPackage(input())
    const { pkg: renamed } = await buildShowPackage(input({ timelineName: 'Altre nom', now: () => '2030-01-01T00:00:00.000Z' }))
    expect(renamed!.meta.hash).toBe(pkg!.meta.hash)
    const doc = fx.document()
    doc.clips[6]!.startMs = 7500
    const { pkg: changed } = await buildShowPackage(input({ doc }))
    expect(changed!.meta.hash).not.toBe(pkg!.meta.hash)
  })

  it('hash input is canonical: sorted keys, no whitespace, integral numbers without decimals', () => {
    const { meta, ...body } = expected
    const text = showHashInput(body)
    expect(text.startsWith('{"assets":{"audio":["nature.mp3"],"video":[]},"board":"rpi4b"')).toBe(true)
    // No whitespace outside string values ("Pulsador Belen" keeps its space).
    expect(text.replace(/"[^"]*"/g, '')).not.toMatch(/\s/)
    expect(text).toContain('"duration":10,')
  })

  it('emits one event per port of the item that belongs to the action\'s piece type, in port order', () => {
    const doc = fx.document()
    const casa = doc.items.find(i => i.id === 'i-casasimple')!
    casa.ports = [8, 9] // CasaSimple i CasaDoble, both segments of SEGMENT_TYPE
    const { body, issues } = assembleShowPackage(input({ doc }))
    expect(issues.filter(i => i.level === 'error')).toEqual([])
    // CasaSimple's clip drives both of its ports; CasaDoble's own clip still drives CasaDoble.
    const fills = body.timeline.filter(e => e.t === 0 && e.action === 'fill' && (e.target === 'CasaSimple' || e.target === 'CasaDoble'))
    expect(fills.map(e => e.target)).toEqual(['CasaSimple', 'CasaDoble', 'CasaDoble'])
    expect(fills[0]!.params).toEqual(fills[1]!.params)
  })

  it('ignores ports of another piece type on the same item and fails when none matches', () => {
    const doc = fx.document()
    const focos = doc.items.find(i => i.id === 'i-focos')!
    focos.ports = [1, 6] // a relay of RELAY_TYPE and a segment of SEGMENT_TYPE
    const ok = assembleShowPackage(input({ doc }))
    expect(ok.body.timeline.filter(e => e.target === 'Fondo1' && e.action === 'focoOn')).toEqual([])
    expect(ok.issues.filter(i => i.level === 'error')).toEqual([])

    focos.ports = [6]
    const { issues } = assembleShowPackage(input({ doc }))
    expect(codes(issues.filter(i => i.level === 'error'))).toContain('E_NO_PORT')
  })

  it('returns no package while there are errors', async () => {
    const doc = fx.document()
    doc.items.find(i => i.id === 'i-focos')!.ports = []
    const { pkg, errors } = await buildShowPackage(input({ doc }))
    expect(pkg).toBeNull()
    // Focos has three clips: one error per clip, each naming the piece.
    expect(codes(errors)).toEqual(['E_NO_PORT', 'E_NO_PORT', 'E_NO_PORT'])
    expect(errors.every(e => e.message.includes('Focos'))).toBe(true)
  })

  it('sorts by t and keeps clip order on ties', () => {
    const doc = fx.document()
    doc.clips.reverse()
    const { body } = assembleShowPackage(input({ doc }))
    expect(body.timeline.map(e => e.t)).toEqual([...body.timeline.map(e => e.t)].sort((a, b) => a - b))
    const atEnd = body.timeline.filter(e => e.t === 118000).map(e => `${e.target}.${e.action}`)
    expect(atEnd[0]).toBe('Fondo2.animate')
    expect(atEnd.at(-1)).toBe('Sembra.turn_off')
  })

  it('maps the clip length to the catalog duration parameter in seconds', () => {
    const { body } = assembleShowPackage(input())
    expect(body.timeline.find(e => e.target === 'LlumsE')!.params).toEqual({ time: 21 })
    expect(body.timeline.find(e => e.target === 'Fondo1' && e.t === 25000)!.params.duration).toBe(10)
    expect(body.timeline.find(e => e.target === 'Sembra' && e.t === 7000)!.params).toEqual({})
  })

  it('coerces colours from every notation and omits blank optionals', () => {
    const doc = fx.document()
    const c12 = doc.clips.find(c => c.id === 'c12')!
    c12.paramValues = { color: '#0a003c', from_color: '' }
    const { body, issues } = assembleShowPackage(input({ doc }))
    const ev = body.timeline.find(e => e.target === 'Fondo1' && e.t === 25000)!
    expect(ev.params).toEqual({ animation_type: 'fade', color: [10, 0, 60], duration: 10 })
    expect(codes(issues)).toContain('W_FADE_FROM_BLACK')
  })

  it('reports a missing required parameter and a wrong type with the clip name', () => {
    const doc = fx.document()
    doc.clips.find(c => c.id === 'c02')!.paramValues = {}
    doc.clips.find(c => c.id === 'c03')!.paramValues = { color: 'vermell' }
    const { issues } = assembleShowPackage(input({ doc }))
    const errors = issues.filter(i => i.level === 'error')
    expect(codes(errors)).toEqual(['E_PARAM_REQUIRED', 'E_PARAM_TYPE'])
    expect(errors[1]!.message).toContain('color')
    expect(errors[1]!.clipId).toBe('c03')
  })

  it('rejects a parameter of another animation and an unknown parameter', () => {
    const doc = fx.document()
    const withIntensity = { ...fx.actionsByType[fx.SEGMENT_TYPE]![1]!, parameters: [...fx.actionsByType[fx.SEGMENT_TYPE]![1]!.parameters, { name: 'intensity', displayName: 'I', type: 'DECIMAL' as const, required: false, dynamic: true }] }
    const lookups = { ...fx.catalogLookups, actionsForPiece: (p: any) => fx.catalogLookups.actionsForPiece(p).map(a => (a.id === 22 ? withIntensity : a)) }
    doc.clips.find(c => c.id === 'c12')!.paramValues = { color: '[1,2,3]', from_color: '[0,0,0]', intensity: 0.5 }
    const { issues } = assembleShowPackage(input({ doc, catalog: lookups }))
    expect(codes(issues.filter(i => i.level === 'error'))).toContain('E_ANIMATION_PARAM')

    const withVolume = { ...fx.actionsByType[fx.AUDIO_TYPE]![0]!, parameters: [...fx.actionsByType[fx.AUDIO_TYPE]![0]!.parameters, { name: 'volume', displayName: 'V', type: 'INTEGER' as const, required: false, dynamic: true }] }
    const lookups2 = { ...fx.catalogLookups, actionsForPiece: (p: any) => fx.catalogLookups.actionsForPiece(p).map(a => (a.id === 31 ? withVolume : a)) }
    const doc2 = fx.document()
    doc2.clips.find(c => c.id === 'c06')!.paramValues = { audio_name: 'nature.mp3', volume: 3 }
    const { issues: issues2 } = assembleShowPackage(input({ doc: doc2, catalog: lookups2 }))
    expect(codes(issues2.filter(i => i.level === 'error'))).toContain('E_PARAM_UNKNOWN')
  })

  it('collects audio assets without duplicates', () => {
    const doc = fx.document()
    doc.clips.push({ id: 'c99', trackId: 't-i-audio', pieceTypeActionId: 31, startMs: 60000, durationMs: 1000, paramValues: { audio_name: 'nature.mp3' } })
    doc.clips.push({ id: 'c98', trackId: 't-i-audio', pieceTypeActionId: 31, startMs: 61000, durationMs: 1000, paramValues: { audio_name: 'night.mp3' } })
    const { body } = assembleShowPackage(input({ doc }))
    expect(body.assets).toEqual({ audio: ['nature.mp3', 'night.mp3'], video: [] })
  })

  it('fails on a stale port and a clip after the end, warns on unused piece ports', () => {
    const doc = fx.document()
    doc.items.find(i => i.id === 'i-sembra')!.ports = [2, 999]
    doc.clips.find(c => c.id === 'c07')!.startMs = 130000
    const { issues } = assembleShowPackage(input({ doc, orgPorts: [...fx.ports, { ...fx.ports[0]!, id: 50, name: 'Pastoret', pin: 22 }] }))
    const errorCodes = codes(issues.filter(i => i.level === 'error'))
    expect(errorCodes).toContain('E_PORT_STALE')
    expect(errorCodes).toContain('E_T_AFTER_END')
    expect(codes(issues.filter(i => i.level === 'warning'))).toContain('W_PORT_UNUSED')
  })

  it('warns when continuous animations overlap on the same target', () => {
    const doc = fx.document()
    doc.clips.find(c => c.id === 'c12')!.durationMs = 100000
    const { issues } = assembleShowPackage(input({ doc }))
    expect(issues.filter(i => i.code === 'W_OVERLAP_CONTINUOUS').map(i => i.port)).toEqual(['Fondo1'])
  })

  it('uses the default mode and board and serializes to re-parseable JSON', async () => {
    const { pkg } = await buildShowPackage(input())
    expect(pkg!.mode).toEqual({ on: 'once', cycles: 1 })
    expect(pkg!.board).toBe('rpi4b')
    expect(JSON.parse(serializeShowPackage(pkg!))).toEqual(pkg)
    const { pkg: pulse } = await buildShowPackage(input({ mode: { on: 'pulse', cycles: 3 } }))
    expect(pulse!.mode).toEqual({ on: 'pulse', cycles: 3 })
    expect(pulse!.meta.hash).not.toBe(pkg!.meta.hash)
  })

  it('keeps a clip without action or with an unresolved action as warnings only', () => {
    const doc = fx.document()
    doc.clips.find(c => c.id === 'c08')!.pieceTypeActionId = null
    doc.clips.find(c => c.id === 'c09')!.pieceTypeActionId = 777
    const { issues } = assembleShowPackage(input({ doc }))
    expect(issues.filter(i => i.level === 'error')).toEqual([])
    expect(codes(issues)).toEqual(expect.arrayContaining(['W_CLIP_NO_ACTION', 'W_ACTION_UNRESOLVED']))
  })

  it('deduplicates repeated issues', async () => {
    const doc = fx.document()
    doc.items.find(i => i.id === 'i-fondo1')!.ports = []
    const { errors } = await buildShowPackage(input({ doc }))
    // Fondo1 has three clips; the same message is reported once per clip id, not per port.
    expect(errors.filter(e => e.code === 'E_NO_PORT')).toHaveLength(3)
  })
})

describe('audio assets', () => {
  const AUDIO_PLAY = fx.actionsByType[fx.AUDIO_TYPE]![0]!
  const withTrim = {
    ...AUDIO_PLAY,
    parameters: [
      ...AUDIO_PLAY.parameters,
      { name: 'start', displayName: 'Inici', type: 'DECIMAL' as const, required: false, dynamic: true },
      { name: 'time', displayName: 'Temps', type: 'DECIMAL' as const, required: false, dynamic: true, isDuration: true }
    ]
  }
  const trimLookups = { ...fx.catalogLookups, actionsForPiece: (p: any) => fx.catalogLookups.actionsForPiece(p).map(a => (a.id === 31 ? withTrim : a)) }
  const nature = { id: 12, kind: 'AUDIO' as const, originalFilename: 'nature.mp3', mimeType: 'audio/mpeg', sizeBytes: 2048, durationMs: 61000, createdAt: '' }

  it('exports start and the clip length as time, in seconds', () => {
    const doc = fx.document()
    const c06 = doc.clips.find(c => c.id === 'c06')!
    c06.paramValues = { audio_name: '12-nature.mp3', start: 2.5 }
    c06.durationMs = 12500
    const { body, issues } = assembleShowPackage(input({ doc, catalog: trimLookups }))
    expect(issues.filter(i => i.level === 'error')).toEqual([])
    const ev = body.timeline.find(e => e.target === 'Audio' && e.action === 'play')!
    expect(ev.params).toEqual({ audio_name: '12-nature.mp3', start: 2.5, time: 12.5 })
    expect(body.assets.audio).toEqual(['12-nature.mp3'])
  })

  it('lists where each file comes from in meta.assets when the files are known', async () => {
    const doc = fx.document()
    doc.clips.find(c => c.id === 'c06')!.paramValues = { audio_name: '12-nature.mp3' }
    const { pkg, errors } = await buildShowPackage(input({ doc, audioByPiece: { 8: [nature] } }))
    expect(errors).toEqual([])
    expect(pkg!.meta.assets).toEqual([
      { name: '12-nature.mp3', kind: 'audio', pieceId: 8, attachmentId: 12, mimeType: 'audio/mpeg', sizeBytes: 2048, durationMs: 61000 }
    ])
    // Same show, same hash: meta is outside it.
    const { pkg: plain } = await buildShowPackage(input({ doc }))
    expect(plain!.meta.assets).toBeUndefined()
    expect(plain!.meta.hash).toBe(pkg!.meta.hash)
  })

  it('refuses a file that is not among the piece\'s audios once they are loaded, and ignores unloaded pieces', () => {
    const doc = fx.document()
    doc.clips.find(c => c.id === 'c06')!.paramValues = { audio_name: '99-gone.mp3' }
    const loaded = assembleShowPackage(input({ doc, audioByPiece: { 8: [nature] } }))
    expect(codes(loaded.issues.filter(i => i.level === 'error'))).toContain('E_ASSET_MISSING')
    expect(loaded.body.timeline.some(e => e.action === 'play')).toBe(false)
    const notLoaded = assembleShowPackage(input({ doc, audioByPiece: {} }))
    expect(codes(notLoaded.issues.filter(i => i.level === 'error'))).not.toContain('E_ASSET_MISSING')
    expect(notLoaded.assetRefs).toEqual([])
  })

  it('warns when the clip runs past the end of the file', () => {
    const doc = fx.document()
    const c06 = doc.clips.find(c => c.id === 'c06')!
    c06.paramValues = { audio_name: '12-nature.mp3', start: 50 }
    c06.durationMs = 20000
    const { issues } = assembleShowPackage(input({ doc, catalog: trimLookups, audioByPiece: { 8: [nature] } }))
    const w = issues.find(i => i.code === 'W_AUDIO_BEYOND_END')
    expect(w?.level).toBe('warning')
    expect(w?.message).toContain('9.0 s')
    c06.durationMs = 11000
    expect(codes(assembleShowPackage(input({ doc, catalog: trimLookups, audioByPiece: { 8: [nature] } })).issues)).not.toContain('W_AUDIO_BEYOND_END')
  })

  it('a negative start is rejected by the catalog minimum', () => {
    const doc = fx.document()
    doc.clips.find(c => c.id === 'c06')!.paramValues = { audio_name: '12-nature.mp3', start: -1 }
    const { issues } = assembleShowPackage(input({ doc, catalog: trimLookups }))
    expect(codes(issues.filter(i => i.level === 'error'))).toContain('E_PARAM_RANGE')
  })
})
