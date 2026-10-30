import type { PieceListItemDto, PieceStatus } from '~/types/api'

// Filtering of the piece palette (PieceCatalog). Pure functions: what can be answered from the
// list already on the laptop is answered here; the rest (text search, location) goes to the server
// through the query params `toServerParams` builds.

/**
 * Which pieces the palette shows regarding the Raspberry Pi: those whose types drive a hardware
 * output (`rpi`, the default: they are the ones a show animates), those without any (`none`:
 * scenery, figures) or every piece (`all`).
 */
export type HardwareFilter = 'rpi' | 'none' | 'all'

export const HARDWARE_FILTERS: readonly HardwareFilter[] = ['rpi', 'none', 'all'] as const

/** Everything the palette filters by. */
export interface PieceQuery {
  /** Free text: the server ranks it (semantic index or name/description match). */
  q: string
  hardware: HardwareFilter
  /** Piece types (OR); empty = any type. */
  typeIds: number[]
  locationId: number | null
  status: PieceStatus | null
}

export const EMPTY_PIECE_QUERY: Readonly<PieceQuery> = Object.freeze({
  q: '',
  hardware: 'rpi',
  typeIds: [],
  locationId: null,
  status: null
})

/** Largest page the backend serves (`PieceService.MAX_PAGE_SIZE`). */
export const PIECES_PAGE_SIZE = 100

type TypedPiece = Pick<PieceListItemDto, 'pieceTypes'>

/** A piece "uses the Raspberry Pi" when one of its types drives a hardware output (has a catalog kind). */
export function usesHardware(piece: TypedPiece): boolean {
  return piece.pieceTypes.some(t => t.kind != null)
}

export function matchesHardware(piece: TypedPiece, filter: HardwareFilter): boolean {
  if (filter === 'all') return true
  return usesHardware(piece) === (filter === 'rpi')
}

export function isHardwareFilter(value: unknown): value is HardwareFilter {
  return typeof value === 'string' && (HARDWARE_FILTERS as readonly string[]).includes(value)
}

/** Lower-case without accents, so "Belén" matches "belen". */
export function foldText(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
}

/** Every whitespace-separated word of `q` appears in the piece's name or serial number. */
export function matchesText(piece: Pick<PieceListItemDto, 'name' | 'serialNumber'>, q: string): boolean {
  const words = foldText(q).split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const haystack = foldText(`${piece.name} ${piece.serialNumber ?? ''}`)
  return words.every(w => haystack.includes(w))
}

/** The structural filters (hardware, types, status) a piece of the list satisfies. */
export function matchesStructure(piece: PieceListItemDto, query: PieceQuery): boolean {
  if (!matchesHardware(piece, query.hardware)) return false
  if (query.typeIds.length > 0 && !piece.pieceTypes.some(t => query.typeIds.includes(t.id))) return false
  if (query.status != null && piece.status !== query.status) return false
  return true
}

/**
 * Resolves the query against the list on the laptop: name/serial match, hardware, types and
 * status. The location is not in the list items, so it is ignored here (see {@link needsServer}).
 */
export function filterLocally(pieces: PieceListItemDto[], query: PieceQuery): PieceListItemDto[] {
  return pieces.filter(p => matchesStructure(p, query) && matchesText(p, query.q))
}

/**
 * Keeps, of what the server answered, what the server could not filter itself: the hardware
 * side of the query (there is no "types without kind" parameter). Types and status were already
 * applied server-side; applying them again is harmless and protects against a stale answer.
 */
export function filterServerResults(pieces: PieceListItemDto[], query: PieceQuery): PieceListItemDto[] {
  return pieces.filter(p => matchesStructure(p, query))
}

/** True when the list on the laptop cannot answer the query: text (ranked by the server) or location. */
export function needsServer(query: PieceQuery): boolean {
  return query.q.trim() !== '' || query.locationId != null
}

/** How many of the advanced filters (types, location, status) are set; shown on the toggle button. */
export function advancedFilterCount(query: PieceQuery): number {
  return (query.typeIds.length > 0 ? 1 : 0) + (query.locationId != null ? 1 : 0) + (query.status != null ? 1 : 0)
}

/** True when anything narrows the list beyond the hardware choice. */
export function hasActiveFilters(query: PieceQuery): boolean {
  return query.q.trim() !== '' || advancedFilterCount(query) > 0
}

export type ServerQueryParams = {
  q?: string
  typeIds?: number[]
  locationId?: number
  status?: PieceStatus
  size: number
  sort?: string
}

/**
 * Query params of `GET /organizations/{slug}/pieces` for the query. `hardwareTypeIds` are the
 * types that drive an output: with the `rpi` filter and no explicit types they become the
 * `typeIds` filter, so the server already returns only animatable pieces. With a semantic text
 * search no sort is sent (the server answers in ranking order); otherwise by name.
 */
export function toServerParams(query: PieceQuery, hardwareTypeIds: number[], semantic: boolean): ServerQueryParams {
  const q = query.q.trim()
  const params: ServerQueryParams = { size: PIECES_PAGE_SIZE }
  if (q) params.q = q
  if (query.typeIds.length > 0) params.typeIds = [...query.typeIds]
  else if (query.hardware === 'rpi' && hardwareTypeIds.length > 0) params.typeIds = [...hardwareTypeIds]
  if (query.locationId != null) params.locationId = query.locationId
  if (query.status != null) params.status = query.status
  if (!(q && semantic)) params.sort = 'name,asc'
  return params
}

/** Stable text of a query, to tell a stale server answer from the current one. */
export function queryKey(query: PieceQuery): string {
  return JSON.stringify([query.q.trim(), query.hardware, [...query.typeIds].sort((a, b) => a - b), query.locationId, query.status])
}

export interface LocationOption {
  id: number
  /** Own name of the location. */
  name: string
  /** Root → self, joined with " / ". */
  path: string
  depth: number
}

type FlatLocation = { id: number, name: string, parentId?: number | null }

/**
 * The locations as a `<select>` wants them: depth-first from the roots, siblings by name, each
 * with its full path. A location whose parent is missing (or part of a cycle) is listed as a root.
 */
export function locationOptions(locations: FlatLocation[]): LocationOption[] {
  const byId = new Map(locations.map(l => [l.id, l]))
  const children = new Map<number | null, FlatLocation[]>()
  for (const l of locations) {
    const parent = l.parentId != null && byId.has(l.parentId) && l.parentId !== l.id ? l.parentId : null
    const list = children.get(parent) ?? []
    list.push(l)
    children.set(parent, list)
  }
  const byName = (a: FlatLocation, b: FlatLocation) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  const out: LocationOption[] = []
  const seen = new Set<number>()
  const walk = (parent: number | null, prefix: string, depth: number) => {
    for (const l of [...(children.get(parent) ?? [])].sort(byName)) {
      if (seen.has(l.id)) continue
      seen.add(l.id)
      const path = prefix ? `${prefix} / ${l.name}` : l.name
      out.push({ id: l.id, name: l.name, path, depth })
      walk(l.id, path, depth + 1)
    }
  }
  walk(null, '', 0)
  // Members of a cycle never hang from a root: list them flat so nothing disappears.
  for (const l of [...locations].sort(byName)) {
    if (!seen.has(l.id)) {
      seen.add(l.id)
      out.push({ id: l.id, name: l.name, path: l.name, depth: 0 })
    }
  }
  return out
}

/** Short label of a piece's types ("Relé · Figura"), for the compact rows. */
export function typesLabel(piece: TypedPiece): string {
  return piece.pieceTypes.map(t => t.name).join(' · ')
}
