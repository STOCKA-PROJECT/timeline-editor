import type { ButtonSchedule } from '~/types/show'

// The editor document schema (front-end owned, versioned). Stored verbatim as the timeline scene
// `document` JSON in the backend.

export const SCENE_SCHEMA_VERSION = 1

/** Fixed relationship between board pixels and physical centimetres (px = cm × PX_PER_CM). */
export const PX_PER_CM = 10

/** Default size of a newly placed item, in centimetres. */
export const DEFAULT_ITEM_SIZE_CM = 10

export interface BoardConfig {
  /** Width in board pixels (cm × {@link PX_PER_CM}). */
  width: number
  /** Height in board pixels (cm × {@link PX_PER_CM}). */
  height: number
  background?: string | null
}

export interface SceneLayer {
  id: string
  name: string
  z: number
  visible: boolean
  locked: boolean
  opacity: number
}

/** A point inside an item, as fractions of its width and height (0,0 top-left, 1,1 bottom-right). */
export interface LedPoint {
  x: number
  y: number
}

export interface SceneItem {
  id: string
  pieceId: number
  layerId: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  /** When set, width/height (cm) are driven by this piece attribute's value (its `attributeName`). */
  widthAttr?: string | null
  heightAttr?: string | null
  /**
   * Ids of the hardware ports assigned to this item (zero, one or many). A port is offered for
   * every type of the piece with the same output kind; the backend rejects cross-organization
   * ids and tolerates stale ones.
   */
  ports?: number[]
  /**
   * Piece type each assigned port plays for this item (port id → piece type id). An action of a
   * type drives the ports playing that type, so a piece with two relay types («Llum» and
   * «Moviment») gets one relay per type. A port without an entry plays its own piece type.
   */
  portTypes?: Record<string, number>
  /**
   * Where the LEDs of the piece sit on the board: a polyline the LEDs are spread along, LED 0 at
   * the first point, in fractions of the item's size so it follows resizes and rotations. Absent:
   * a line across the middle, left to right. Only drawn when the piece has a LED length.
   */
  ledPath?: LedPoint[] | null
}

export interface SceneTrack {
  id: string
  itemId: string
  name: string
}

export type ClipParamValues = Record<string, unknown>

export interface SceneClip {
  id: string
  trackId: string
  pieceTypeActionId: number | null
  startMs: number
  durationMs: number
  paramValues: ClipParamValues
  label?: string
}

export interface SceneDocument {
  schemaVersion: number
  board: BoardConfig
  layers: SceneLayer[]
  items: SceneItem[]
  tracks: SceneTrack[]
  clips: SceneClip[]
  durationMs: number
  fps?: number
  /**
   * Order of the items along each LED strip port (port id → item ids, first LED first). Items
   * assigned to the port but missing here go after the listed ones. The export lays the pieces
   * out one after the other using their length attribute.
   */
  stripOrder?: Record<string, string[]>
  /** When the physical button starts the show; exported as `mode.schedule`. Absent = always. */
  schedule?: ButtonSchedule
}

export function emptyDocument(): SceneDocument {
  return {
    schemaVersion: SCENE_SCHEMA_VERSION,
    board: { width: 1280, height: 720, background: null },
    layers: [{ id: 'layer-1', name: 'Capa 1', z: 0, visible: true, locked: false, opacity: 1 }],
    items: [],
    tracks: [],
    clips: [],
    durationMs: 60000,
    fps: 30,
    stripOrder: {}
  }
}
