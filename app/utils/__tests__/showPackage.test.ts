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
    expect(text.startsWith('{"assets":{"audio":["nature.mp3"]},"board":"rpi4b"')).toBe(true)
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
    expect(ok.body.timeline.filter(e => e.target === 'Fondo1' && e.action === 'turn_on')).toEqual([])
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

  it('ignores unset or leftover parameters of other animations and rejects an unknown parameter', () => {
    const doc = fx.document()
    // A type that declares the parameters of several animations on one `animate` action.
    const withIntensity = { ...fx.actionsByType[fx.SEGMENT_TYPE]![1]!, parameters: [...fx.actionsByType[fx.SEGMENT_TYPE]![1]!.parameters, { name: 'intensity', displayName: 'I', type: 'DECIMAL' as const, required: false, dynamic: true }] }
    const lookups = { ...fx.catalogLookups, actionsForPiece: (p: any) => fx.catalogLookups.actionsForPiece(p).map(a => (a.id === 22 ? withIntensity : a)) }
    // A fade clip that never filled `intensity` (fire's) exports clean.
    doc.clips.find(c => c.id === 'c12')!.paramValues = { color: '[1,2,3]', from_color: '[0,0,0]' }
    const clean = assembleShowPackage(input({ doc, catalog: lookups }))
    expect(clean.issues.filter(i => i.level === 'error')).toEqual([])
    expect(clean.body.timeline.find(e => e.t === 25000 && e.target === 'Fondo1')!.params).not.toHaveProperty('intensity')
    // A leftover value for another animation is dropped with a warning, not an error.
    doc.clips.find(c => c.id === 'c12')!.paramValues = { color: '[1,2,3]', from_color: '[0,0,0]', intensity: 0.5 }
    const leftover = assembleShowPackage(input({ doc, catalog: lookups }))
    expect(leftover.issues.filter(i => i.level === 'error')).toEqual([])
    expect(codes(leftover.issues.filter(i => i.level === 'warning'))).toContain('W_ANIMATION_PARAM_IGNORED')
    expect(leftover.body.timeline.find(e => e.t === 25000 && e.target === 'Fondo1')!.params).not.toHaveProperty('intensity')

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
    expect(body.assets).toEqual({ audio: ['nature.mp3', 'night.mp3'] })
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

describe('relay double pulse', () => {
  const doublePulse = (gap: string) => ({ id: 13, name: 'double_pulse', displayName: 'Doble pulsació', position: 0, parameters: [
    { name: 'first_press', displayName: '1a pulsació (s)', type: 'DECIMAL' as const, required: true, dynamic: false, staticValue: '0.3' },
    { name: 'gap', displayName: 'Pausa (s)', type: 'DECIMAL' as const, required: true, dynamic: false, staticValue: gap },
    { name: 'second_press', displayName: '2a pulsació (s)', type: 'DECIMAL' as const, required: true, dynamic: false, staticValue: '5' }
  ] })
  function lookups(gap: string) {
    return {
      ...fx.catalogLookups,
      actionsForPiece: (p: any) => fx.catalogLookups.actionsForPiece(p).map(a => (a.id === 13 ? doublePulse(gap) : a))
    }
  }

  it('exports the three static durations as numbers, ignoring the clip length', () => {
    const { body, issues } = assembleShowPackage(input({ catalog: lookups('0.2') }))
    expect(issues.filter(i => i.level === 'error')).toEqual([])
    const event = body.timeline.find(e => e.target === 'Sembra' && e.t === 7000)!
    expect(event.action).toBe('double_pulse')
    expect(event.params).toEqual({ first_press: 0.3, gap: 0.2, second_press: 5 })
    expect(Object.keys(event.params)).toEqual(['first_press', 'gap', 'second_press'])
  })

  it('a missing static value is E_PARAM_REQUIRED', () => {
    const { issues } = assembleShowPackage(input({ catalog: lookups('') }))
    const errors = issues.filter(i => i.level === 'error')
    expect(codes(errors)).toContain('E_PARAM_REQUIRED')
    expect(errors.some(i => i.message.includes('«gap»'))).toBe(true)
  })
})

describe('pieces sharing a LED strip', () => {
  const STRIP_TYPE = 5
  const stripActions = [
    { id: 51, name: 'fill', displayName: 'Omplir', position: 1, parameters: [
      { name: 'color', displayName: 'Color', type: 'TEXT' as const, required: true, dynamic: true },
      { name: 'first', displayName: 'Primer', type: 'INTEGER' as const, required: false, dynamic: true },
      { name: 'last', displayName: 'Últim', type: 'INTEGER' as const, required: false, dynamic: true }
    ] },
    { id: 52, name: 'animate', displayName: 'Animació', position: 2, parameters: [
      { name: 'animation_type', displayName: 'Animació', type: 'SELECT' as const, required: true, dynamic: true, validators: { options: ['fire', 'stars'] } },
      { name: 'duration', displayName: 'Durada', type: 'DECIMAL' as const, required: false, dynamic: true, isDuration: true }
    ] },
    { id: 53, name: 'clear', displayName: 'Apagar', position: 3, parameters: [] },
    { id: 54, name: 'setBrightness', displayName: 'Brillantor', position: 4, parameters: [
      { name: 'brightness', displayName: 'Brillantor', type: 'INTEGER' as const, required: true, dynamic: false, staticValue: '120' }
    ] }
  ]
  const strip = { id: 12, name: 'Tira 1', kind: 'led_strip' as const, pieceTypeId: STRIP_TYPE, pieceTypeName: 'Tira Led', pin: 12, config: { dma: 5, channel: 0, length: 44 }, position: 12, parameters: [] }
  const houses = [
    { id: 9, name: 'Casa simple', pieceTypes: [{ id: STRIP_TYPE, name: 'Tira Led', kind: 'led_strip' as const }], status: 'ACTIVE' as const, createdAt: '', updatedAt: '' },
    { id: 10, name: 'Casa doble', pieceTypes: [{ id: STRIP_TYPE, name: 'Tira Led', kind: 'led_strip' as const }], status: 'ACTIVE' as const, createdAt: '', updatedAt: '' }
  ]
  const lengths: Record<number, number | null> = { 9: 16, 10: 28 }
  const lookups = {
    pieceById: (id: number) => houses.find(p => p.id === id) ?? fx.catalogLookups.pieceById(id),
    portById: (id: number) => (id === 12 ? strip : fx.catalogLookups.portById(id)),
    actionsForPiece: (p: any) => (p && p.pieceTypes.some((t: any) => t.id === STRIP_TYPE) ? stripActions : fx.catalogLookups.actionsForPiece(p)),
    typeIdOfAction: (id: number) => (stripActions.some(a => a.id === id) ? STRIP_TYPE : fx.catalogLookups.typeIdOfAction(id)),
    ledLengthOf: (id: number) => lengths[id] ?? null
  }
  function stripDoc(clips: Array<{ id: string, item: string, action: number, t: number, params?: Record<string, unknown> }>, stripOrder?: Record<string, string[]>) {
    const doc = fx.document({ clips: [], tracks: [], items: [] })
    doc.items = [
      { id: 'i-casa1', pieceId: 9, layerId: 'layer-1', x: 0, y: 0, width: 10, height: 10, rotation: 0, ports: [12] },
      { id: 'i-casa2', pieceId: 10, layerId: 'layer-1', x: 0, y: 0, width: 10, height: 10, rotation: 0, ports: [12] }
    ]
    doc.tracks = doc.items.map(i => ({ id: `t-${i.id}`, itemId: i.id, name: i.id }))
    doc.clips = clips.map(c => ({ id: c.id, trackId: `t-${c.item}`, pieceTypeActionId: c.action, startMs: c.t, durationMs: 1000, paramValues: c.params ?? {} }))
    if (stripOrder) doc.stripOrder = stripOrder
    return doc
  }
  const ports = [...fx.ports, strip]

  it('turns every piece on the strip into a segment, in order, and targets it with piece-relative LEDs', () => {
    const doc = stripDoc([
      { id: 'k1', item: 'i-casa1', action: 51, t: 0, params: { color: '#ff0000', first: 0, last: 3 } },
      { id: 'k2', item: 'i-casa2', action: 52, t: 0, params: { animation_type: 'fire' } },
      { id: 'k3', item: 'i-casa1', action: 53, t: 5000 },
      { id: 'k4', item: 'i-casa2', action: 54, t: 6000 }
    ])
    const { body, issues } = assembleShowPackage(input({ doc, catalog: lookups, orgPorts: ports }))
    expect(issues.filter(i => i.level === 'error')).toEqual([])
    expect(body.hardware['Casa simple']).toEqual({ kind: 'led_segment', strip: 'Tira 1', first: 0, last: 15 })
    expect(body.hardware['Casa doble']).toEqual({ kind: 'led_segment', strip: 'Tira 1', first: 16, last: 43 })
    expect(body.timeline.map(e => [e.target, e.action])).toEqual([
      ['Casa simple', 'fill'], ['Casa doble', 'animate'], ['Casa simple', 'clear'], ['Tira 1', 'setBrightness']
    ])
    expect(body.timeline[0]!.params).toEqual({ color: [255, 0, 0], first: 0, last: 3 })
    // Both pieces animate at once on the same strip without an overlap warning: different targets.
    expect(codes(issues)).not.toContain('W_OVERLAP_CONTINUOUS')
  })

  it('follows the saved strip order and the sample still exports unchanged', async () => {
    const doc = stripDoc([{ id: 'k1', item: 'i-casa1', action: 53, t: 0 }], { 12: ['i-casa2', 'i-casa1'] })
    const { body } = assembleShowPackage(input({ doc, catalog: lookups, orgPorts: ports }))
    expect(body.hardware['Casa doble']).toMatchObject({ first: 0, last: 27 })
    expect(body.hardware['Casa simple']).toMatchObject({ first: 28, last: 43 })
    const { pkg } = await buildShowPackage(input())
    expect(pkg).toEqual(expected)
  })

  it('a piece without length takes the rest of the strip only when it is the last one', () => {
    const noLength = { ...lookups, ledLengthOf: (id: number) => (id === 10 ? null : lengths[id] ?? null) }
    const last = assembleShowPackage(input({ doc: stripDoc([{ id: 'k1', item: 'i-casa2', action: 53, t: 0 }]), catalog: noLength, orgPorts: ports }))
    expect(last.issues.filter(i => i.level === 'error')).toEqual([])
    expect(last.body.hardware['Casa doble']).toMatchObject({ first: 16, last: 43 })
    const notLast = assembleShowPackage(input({ doc: stripDoc([{ id: 'k1', item: 'i-casa2', action: 53, t: 0 }], { 12: ['i-casa2', 'i-casa1'] }), catalog: noLength, orgPorts: ports }))
    expect(codes(notLast.issues.filter(i => i.level === 'error'))).toContain('E_LED_LENGTH')
  })

  it('reports LEDs beyond the piece or pieces beyond the strip', () => {
    const outOfPiece = assembleShowPackage(input({ doc: stripDoc([{ id: 'k1', item: 'i-casa1', action: 51, t: 0, params: { color: '#fff', first: 0, last: 20 } }]), catalog: lookups, orgPorts: ports }))
    const range = outOfPiece.issues.find(i => i.code === 'E_SEGMENT_RANGE')
    expect(range?.message).toContain('Casa simple')
    expect(range?.message).toContain('0–15')
    const tooLong = { ...lookups, ledLengthOf: (id: number) => (id === 10 ? 40 : lengths[id] ?? null) }
    const overflow = assembleShowPackage(input({ doc: stripDoc([{ id: 'k1', item: 'i-casa2', action: 53, t: 0 }]), catalog: tooLong, orgPorts: ports }))
    expect(codes(overflow.issues.filter(i => i.level === 'error'))).toContain('E_SEGMENT_RANGE')
  })

  it('keeps segment names unique against ports and other pieces', () => {
    const clash = { ...lookups, pieceById: (id: number) => (id === 9 ? { ...houses[0]!, name: 'Focos' } : lookups.pieceById(id)) }
    const { body } = assembleShowPackage(input({ doc: stripDoc([{ id: 'k1', item: 'i-casa1', action: 53, t: 0 }]), catalog: clash, orgPorts: ports }))
    expect(body.hardware['Focos']).toMatchObject({ kind: 'relay' })
    expect(body.hardware['Focos #2']).toMatchObject({ kind: 'led_segment', first: 0, last: 15 })
    expect(body.timeline[0]!.target).toBe('Focos #2')
  })
})
