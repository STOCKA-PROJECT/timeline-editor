import { describe, expect, it } from 'vitest'
import type { PieceListItemDto, PieceTypeRefDto } from '~/types/api'
import {
  EMPTY_PIECE_QUERY,
  advancedFilterCount,
  filterLocally,
  filterServerResults,
  foldText,
  hasActiveFilters,
  isHardwareFilter,
  locationOptions,
  matchesHardware,
  matchesText,
  needsServer,
  queryKey,
  toServerParams,
  typesLabel,
  usesHardware,
  type PieceQuery
} from '~/utils/pieceFilters'

const relay: PieceTypeRefDto = { id: 1, name: 'Relé', kind: 'relay' }
const strip: PieceTypeRefDto = { id: 2, name: 'Tira LED', kind: 'led_strip' }
const figure: PieceTypeRefDto = { id: 3, name: 'Figura', kind: null }
const building: PieceTypeRefDto = { id: 4, name: 'Edificio' }

function piece(id: number, name: string, types: PieceTypeRefDto[], extra: Partial<PieceListItemDto> = {}): PieceListItemDto {
  return { id, name, pieceTypes: types, status: 'ACTIVE', createdAt: '', updatedAt: '', ...extra }
}

const foco = piece(10, 'Foco del portal', [relay])
const estrella = piece(11, 'Estrella de Belén', [strip, figure], { serialNumber: 'EST-01' })
const pastor = piece(12, 'Pastor dormido', [figure], { status: 'PENDING' })
const casa = piece(13, 'Casa del herrero', [building])
const all = [foco, estrella, pastor, casa]

function query(patch: Partial<PieceQuery> = {}): PieceQuery {
  return { ...EMPTY_PIECE_QUERY, typeIds: [], ...patch }
}

describe('usesHardware / matchesHardware', () => {
  it('a piece uses the Pi when any of its types has a kind', () => {
    expect(usesHardware(foco)).toBe(true)
    expect(usesHardware(estrella)).toBe(true)
    expect(usesHardware(pastor)).toBe(false)
    expect(usesHardware(casa)).toBe(false)
    expect(usesHardware({ pieceTypes: [] })).toBe(false)
  })

  it('rpi keeps hardware pieces, none keeps the rest, all keeps everything', () => {
    expect(all.filter(p => matchesHardware(p, 'rpi')).map(p => p.id)).toEqual([10, 11])
    expect(all.filter(p => matchesHardware(p, 'none')).map(p => p.id)).toEqual([12, 13])
    expect(all.filter(p => matchesHardware(p, 'all')).map(p => p.id)).toEqual([10, 11, 12, 13])
  })

  it('isHardwareFilter accepts only the three values', () => {
    expect(isHardwareFilter('rpi')).toBe(true)
    expect(isHardwareFilter('none')).toBe(true)
    expect(isHardwareFilter('all')).toBe(true)
    expect(isHardwareFilter('RPI')).toBe(false)
    expect(isHardwareFilter(null)).toBe(false)
    expect(isHardwareFilter(1)).toBe(false)
  })
})

describe('matchesText', () => {
  it('ignores case and accents', () => {
    expect(foldText('Belén ÀÉÎ')).toBe('belen aei')
    expect(matchesText(estrella, 'belen')).toBe(true)
    expect(matchesText(estrella, 'BELÉN')).toBe(true)
  })

  it('requires every word, in any order, and also looks at the serial number', () => {
    expect(matchesText(estrella, 'belen estrella')).toBe(true)
    expect(matchesText(estrella, 'estrella portal')).toBe(false)
    expect(matchesText(estrella, 'est-01')).toBe(true)
    expect(matchesText(foco, 'est-01')).toBe(false)
  })

  it('matches everything with an empty or blank text', () => {
    expect(matchesText(pastor, '')).toBe(true)
    expect(matchesText(pastor, '   ')).toBe(true)
  })
})

describe('filterLocally', () => {
  it('defaults to the hardware pieces', () => {
    expect(filterLocally(all, query()).map(p => p.id)).toEqual([10, 11])
  })

  it('combines text, hardware, types and status', () => {
    expect(filterLocally(all, query({ hardware: 'all', q: 'del' })).map(p => p.id)).toEqual([10, 13])
    expect(filterLocally(all, query({ hardware: 'all', typeIds: [3] })).map(p => p.id)).toEqual([11, 12])
    expect(filterLocally(all, query({ hardware: 'all', typeIds: [3, 4] })).map(p => p.id)).toEqual([11, 12, 13])
    expect(filterLocally(all, query({ hardware: 'all', status: 'PENDING' })).map(p => p.id)).toEqual([12])
    expect(filterLocally(all, query({ hardware: 'none', status: 'ACTIVE' })).map(p => p.id)).toEqual([13])
    expect(filterLocally(all, query({ typeIds: [3] })).map(p => p.id)).toEqual([11])
  })

  it('ignores the location, which the list items do not carry', () => {
    expect(filterLocally(all, query({ hardware: 'all', locationId: 99 })).length).toBe(4)
  })

  it('filterServerResults applies the hardware side the server cannot express', () => {
    expect(filterServerResults(all, query({ hardware: 'none', q: 'x' })).map(p => p.id)).toEqual([12, 13])
    expect(filterServerResults(all, query({ hardware: 'rpi', q: 'x', typeIds: [4] }))).toEqual([])
    // The text is the server's business: it is not re-applied.
    expect(filterServerResults(all, query({ hardware: 'all', q: 'zzz' })).length).toBe(4)
  })
})

describe('needsServer / counts', () => {
  it('needs the server for a text or a location, not for the structural filters', () => {
    expect(needsServer(query())).toBe(false)
    expect(needsServer(query({ hardware: 'none', typeIds: [1], status: 'ACTIVE' }))).toBe(false)
    expect(needsServer(query({ q: '  ' }))).toBe(false)
    expect(needsServer(query({ q: 'foco' }))).toBe(true)
    expect(needsServer(query({ locationId: 5 }))).toBe(true)
  })

  it('counts the advanced filters that are set', () => {
    expect(advancedFilterCount(query())).toBe(0)
    expect(advancedFilterCount(query({ typeIds: [1, 2] }))).toBe(1)
    expect(advancedFilterCount(query({ typeIds: [1], locationId: 2, status: 'ACTIVE' }))).toBe(3)
    expect(advancedFilterCount(query({ q: 'foco', hardware: 'none' }))).toBe(0)
  })

  it('hasActiveFilters ignores the hardware choice', () => {
    expect(hasActiveFilters(query({ hardware: 'none' }))).toBe(false)
    expect(hasActiveFilters(query({ q: 'a' }))).toBe(true)
    expect(hasActiveFilters(query({ status: 'PENDING' }))).toBe(true)
  })
})

describe('toServerParams', () => {
  const hw = [1, 2]

  it('turns the rpi filter into the hardware types when no type is chosen', () => {
    expect(toServerParams(query(), hw, false)).toEqual({ size: 100, typeIds: [1, 2], sort: 'name,asc' })
    expect(toServerParams(query({ hardware: 'none' }), hw, false)).toEqual({ size: 100, sort: 'name,asc' })
    expect(toServerParams(query({ hardware: 'all' }), hw, false)).toEqual({ size: 100, sort: 'name,asc' })
    expect(toServerParams(query(), [], false)).toEqual({ size: 100, sort: 'name,asc' })
  })

  it('explicit types win over the hardware types', () => {
    expect(toServerParams(query({ typeIds: [4] }), hw, false).typeIds).toEqual([4])
  })

  it('sends the trimmed text, location and status', () => {
    const params = toServerParams(query({ q: '  pastor ', hardware: 'all', locationId: 7, status: 'PENDING' }), hw, false)
    expect(params).toEqual({ size: 100, q: 'pastor', locationId: 7, status: 'PENDING', sort: 'name,asc' })
  })

  it('drops the sort only for a semantic text search (the server answers by relevance)', () => {
    expect(toServerParams(query({ q: 'pastor', hardware: 'all' }), hw, true).sort).toBeUndefined()
    expect(toServerParams(query({ q: 'pastor', hardware: 'all' }), hw, false).sort).toBe('name,asc')
    expect(toServerParams(query({ hardware: 'all', locationId: 1 }), hw, true).sort).toBe('name,asc')
  })

  it('copies the arrays instead of sharing them with the query', () => {
    const q = query({ typeIds: [4] })
    const params = toServerParams(q, hw, false)
    params.typeIds!.push(5)
    expect(q.typeIds).toEqual([4])
  })
})

describe('queryKey', () => {
  it('is the same for equivalent queries and different for different ones', () => {
    expect(queryKey(query({ q: 'a ', typeIds: [2, 1] }))).toBe(queryKey(query({ q: 'a', typeIds: [1, 2] })))
    expect(queryKey(query({ q: 'a' }))).not.toBe(queryKey(query({ q: 'b' })))
    expect(queryKey(query({ hardware: 'all' }))).not.toBe(queryKey(query({ hardware: 'rpi' })))
    expect(queryKey(query({ locationId: 1 }))).not.toBe(queryKey(query({ locationId: 2 })))
  })
})

describe('locationOptions', () => {
  it('walks the tree depth-first with siblings by name and builds the paths', () => {
    const options = locationOptions([
      { id: 3, name: 'Estante B', parentId: 1 },
      { id: 1, name: 'Almacén', parentId: null },
      { id: 2, name: 'Estante A', parentId: 1 },
      { id: 4, name: 'Caja 1', parentId: 2 },
      { id: 5, name: 'Taller' }
    ])
    expect(options.map(o => [o.id, o.path, o.depth])).toEqual([
      [1, 'Almacén', 0],
      [2, 'Almacén / Estante A', 1],
      [4, 'Almacén / Estante A / Caja 1', 2],
      [3, 'Almacén / Estante B', 1],
      [5, 'Taller', 0]
    ])
    expect(options[1]!.name).toBe('Estante A')
  })

  it('sorts names ignoring case and accents', () => {
    const names = locationOptions([
      { id: 1, name: 'ático' },
      { id: 2, name: 'Bodega' },
      { id: 3, name: 'Ábside' }
    ]).map(o => o.name)
    expect(names).toEqual(['Ábside', 'ático', 'Bodega'])
  })

  it('lists as roots the locations whose parent is unknown and never loses a cycle', () => {
    const options = locationOptions([
      { id: 1, name: 'Huérfana', parentId: 99 },
      { id: 2, name: 'A', parentId: 3 },
      { id: 3, name: 'B', parentId: 2 },
      { id: 4, name: 'Propia', parentId: 4 }
    ])
    expect(options.map(o => o.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4])
    expect(options.find(o => o.id === 1)!.depth).toBe(0)
    expect(options.find(o => o.id === 4)!.path).toBe('Propia')
  })

  it('is empty without locations', () => {
    expect(locationOptions([])).toEqual([])
  })
})

describe('typesLabel', () => {
  it('joins the type names with a middle dot', () => {
    expect(typesLabel(estrella)).toBe('Tira LED · Figura')
    expect(typesLabel({ pieceTypes: [] })).toBe('')
  })
})
