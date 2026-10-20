import type { PieceListItemDto, PieceTypeActionResponseDto, PortResponseDto } from '~/types/api'
import type { SceneDocument, SceneClip, SceneItem, SceneTrack } from '~/types/editor'
import type { CatalogLookups } from '~/utils/exportBundle'

// The same slice of the 2025-26 show that `rpi4-system/contract/samples/belen-2026.show.json`
// holds, expressed as an editor document plus the organization's catalog. Exporting it must
// produce that file byte-for-byte (meta.exportedAt aside), hash included.

export const RELAY_TYPE = 1
export const SEGMENT_TYPE = 2
export const AUDIO_TYPE = 3
export const TIMED_RELAY_TYPE = 4

export const ports: PortResponseDto[] = [
  port(1, 'Focos', 'relay', RELAY_TYPE, 27, {}),
  port(2, 'Sembra', 'relay', RELAY_TYPE, 26, {}),
  port(3, 'LlumsE', 'relay', TIMED_RELAY_TYPE, 18, {}),
  port(4, 'LedStrip3', 'led_strip', null, 13, { dma: 10, channel: 1, length: 300 }),
  port(5, 'LedStrip4', 'led_strip', null, 10, { dma: 8, channel: 0, length: 44 }),
  port(6, 'Fondo1', 'led_segment', SEGMENT_TYPE, null, { strip: 'LedStrip3', first: 0, last: 148 }),
  port(7, 'Fondo2', 'led_segment', SEGMENT_TYPE, null, { strip: 'LedStrip3', first: 298, last: 149 }),
  port(8, 'CasaSimple', 'led_segment', SEGMENT_TYPE, null, { strip: 'LedStrip4', first: 0, last: 15 }),
  port(9, 'CasaDoble', 'led_segment', SEGMENT_TYPE, null, { strip: 'LedStrip4', first: 16, last: 43 }),
  port(10, 'Audio', 'audio', AUDIO_TYPE, null, {}),
  port(11, 'Pulsador Belen', 'button', null, 20, {})
]

export const pieces: PieceListItemDto[] = [
  piece(1, 'Focos', RELAY_TYPE),
  piece(2, 'Sembra', RELAY_TYPE),
  piece(3, 'LlumsE', TIMED_RELAY_TYPE),
  piece(4, 'Fondo1', SEGMENT_TYPE),
  piece(5, 'Fondo2', SEGMENT_TYPE),
  piece(6, 'CasaSimple', SEGMENT_TYPE),
  piece(7, 'CasaDoble', SEGMENT_TYPE),
  piece(8, 'Audio', AUDIO_TYPE)
]

export const actionsByType: Record<number, PieceTypeActionResponseDto[]> = {
  [RELAY_TYPE]: [
    action(13, 'turn_on', 'Encendre', []),
    action(14, 'turn_off', 'Apagar', [])
  ],
  [TIMED_RELAY_TYPE]: [
    action(41, 'turn_on', 'Encendre un temps', [
      { name: 'time', displayName: 'Temps (s)', type: 'DECIMAL', required: false, dynamic: true, isDuration: true }
    ]),
    action(42, 'turn_off', 'Apagar', [])
  ],
  [SEGMENT_TYPE]: [
    action(21, 'fill', 'Omplir', [
      { name: 'color', displayName: 'Color', type: 'TEXT', required: true, dynamic: true }
    ]),
    action(22, 'animate', 'Fos', [
      { name: 'animation_type', displayName: 'Animació', type: 'SELECT', required: true, dynamic: false, staticValue: 'fade', validators: { options: ['fade'] } },
      { name: 'color', displayName: 'Color', type: 'TEXT', required: true, dynamic: true },
      { name: 'from_color', displayName: 'Color inicial', type: 'TEXT', required: false, dynamic: true },
      { name: 'duration', displayName: 'Durada (s)', type: 'DECIMAL', required: false, dynamic: true, isDuration: true }
    ])
  ],
  [AUDIO_TYPE]: [
    action(31, 'play', 'Reproduir', [
      { name: 'audio_name', displayName: 'Fitxer', type: 'TEXT', required: true, dynamic: true }
    ]),
    action(32, 'stop', 'Aturar', [])
  ]
}

export const catalogLookups: CatalogLookups = {
  pieceById: id => pieces.find(p => p.id === id),
  portById: id => ports.find(p => p.id === id),
  actionsForPiece: (piece) => {
    if (!piece) return []
    return piece.pieceTypes.flatMap(t => actionsByType[t.id] ?? [])
  },
  typeIdOfAction: (actionId) => {
    for (const [typeId, actions] of Object.entries(actionsByType)) {
      if (actions.some(a => a.id === actionId)) return Number(typeId)
    }
    return undefined
  }
}

/** Items: one per piece, with its port(s) assigned. */
export const items: SceneItem[] = [
  item('i-focos', 1, [1]),
  item('i-sembra', 2, [2]),
  item('i-llumse', 3, [3]),
  item('i-fondo1', 4, [6]),
  item('i-fondo2', 5, [7]),
  item('i-casasimple', 6, [8]),
  item('i-casadoble', 7, [9]),
  item('i-audio', 8, [10])
]

export const tracks: SceneTrack[] = items.map(i => ({ id: `t-${i.id}`, itemId: i.id, name: i.id }))

/** Clips in the order the sample lists its events, so stable sorting reproduces that order. */
export const clips: SceneClip[] = [
  clip('c01', 'i-focos', 13, 0, 1000),
  clip('c02', 'i-fondo1', 21, 0, 1000, { color: '[255,50,0]' }),
  clip('c03', 'i-fondo2', 21, 0, 1000, { color: '[255,50,0]' }),
  clip('c04', 'i-casasimple', 21, 0, 1000, { color: '[255,50,0]' }),
  clip('c05', 'i-casadoble', 21, 0, 1000, { color: '[50,16,0]' }),
  clip('c06', 'i-audio', 31, 0, 1000, { audio_name: 'nature.mp3' }),
  clip('c07', 'i-sembra', 13, 7000, 1000),
  clip('c08', 'i-focos', 14, 20000, 1000),
  clip('c09', 'i-sembra', 14, 23000, 1000),
  clip('c10', 'i-casasimple', 22, 24000, 3000, { color: '[0,0,0]', from_color: '[255,50,0]' }),
  clip('c11', 'i-casadoble', 22, 24000, 3000, { color: '[0,0,0]', from_color: '[50,16,0]' }),
  clip('c12', 'i-fondo1', 22, 25000, 10000, { color: '[10,0,60]', from_color: '[255,50,0]' }),
  clip('c13', 'i-fondo2', 22, 25000, 10000, { color: '[10,0,60]', from_color: '[255,50,0]' }),
  clip('c14', 'i-audio', 32, 27000, 1000),
  clip('c15', 'i-llumse', 41, 30000, 21000),
  clip('c16', 'i-sembra', 14, 118000, 1000),
  clip('c17', 'i-audio', 32, 118000, 1000),
  clip('c18', 'i-focos', 14, 118000, 1000),
  clip('c19', 'i-casasimple', 22, 118000, 4000, { color: '[0,0,0]', from_color: '[255,50,0]' }),
  clip('c20', 'i-casadoble', 22, 118000, 4000, { color: '[0,0,0]', from_color: '[50,16,0]' }),
  clip('c21', 'i-fondo1', 22, 118000, 4000, { color: '[0,0,0]', from_color: '[255,50,0]' }),
  clip('c22', 'i-fondo2', 22, 118000, 4000, { color: '[0,0,0]', from_color: '[255,50,0]' })
]

export function document(overrides: Partial<SceneDocument> = {}): SceneDocument {
  return {
    schemaVersion: 1,
    board: { width: 1280, height: 720, background: null },
    layers: [{ id: 'layer-1', name: 'Capa 1', z: 0, visible: true, locked: false, opacity: 1 }],
    items: items.map(i => ({ ...i, ports: [...(i.ports ?? [])] })),
    tracks: [...tracks],
    clips: clips.map(c => ({ ...c, paramValues: { ...c.paramValues } })),
    durationMs: 122000,
    fps: 30,
    ...overrides
  }
}

export const META = { timelineName: 'Pessebre 2026 (mostra)', timelineId: null, now: () => '2026-10-12T00:00:00.000Z' }

// ----- builders -----

function port(id: number, name: string, kind: PortResponseDto['kind'], pieceTypeId: number | null, pin: number | null, config: Record<string, unknown>): PortResponseDto {
  return { id, name, kind, pieceTypeId, pieceTypeName: null, pin, config, position: id, parameters: [] }
}

function piece(id: number, name: string, ...typeIds: number[]): PieceListItemDto {
  return { id, name, pieceTypes: typeIds.map(t => ({ id: t, name: `Tipus ${t}` })), status: 'ACTIVE', createdAt: '', updatedAt: '' }
}

function action(id: number, name: string, displayName: string, parameters: PieceTypeActionResponseDto['parameters']): PieceTypeActionResponseDto {
  return { id, name, displayName, position: id, parameters }
}

function item(id: string, pieceId: number, ports: number[]): SceneItem {
  return { id, pieceId, layerId: 'layer-1', x: 0, y: 0, width: 100, height: 100, rotation: 0, ports }
}

function clip(id: string, itemId: string, pieceTypeActionId: number, startMs: number, durationMs: number, paramValues: Record<string, unknown> = {}): SceneClip {
  return { id, trackId: `t-${itemId}`, pieceTypeActionId, startMs, durationMs, paramValues }
}
