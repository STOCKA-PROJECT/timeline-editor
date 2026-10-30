import { describe, expect, it } from 'vitest'
import type { PieceListItemDto, PortResponseDto } from '~/types/api'
import type { SceneItem } from '~/types/editor'
import {
  compatiblePorts,
  hardwareTypes,
  invalidBindings,
  kindLabel,
  portFitsType,
  portRole,
  roleGroups,
  typesWithoutPort,
  withPortRole,
  withoutPort
} from '~/utils/portRoles'

const LLUM = 152
const MOVIMENT = 2
const TIRA = 4
const EDIFICI = 7 // inventory-only type

function port(id: number, name: string, kind: PortResponseDto['kind'], pieceTypeId: number | null): PortResponseDto {
  return { id, name, kind, pieceTypeId, pieceTypeName: null, pin: null, config: {}, position: id, parameters: [] }
}

const onOff1 = port(2, 'Sortida On/Off 1', 'relay', MOVIMENT)
const onOff2 = port(3, 'Sortida On/Off 2', 'relay', MOVIMENT)
const tira1 = port(102, 'Sortida Tira Led 1', 'led_strip', TIRA)
const expansor = port(152, 'Expansor 1', 'gpio_expander', null)
const sensor = port(202, 'Pulsador', 'sensor', null)
const ports = [onOff1, onOff2, tira1, expansor, sensor]
const portById = (id: number) => ports.find(p => p.id === id)

const dona: PieceListItemDto = {
  id: 152,
  name: 'Dona rentant + Font Moviment',
  pieceTypes: [{ id: EDIFICI, name: 'Edifici', kind: null }, { id: LLUM, name: 'Llum', kind: 'relay' }, { id: MOVIMENT, name: 'Peça Moviment', kind: 'relay' }],
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: ''
}
const casa: PieceListItemDto = { ...dona, id: 107, name: 'Casa Simple', pieceTypes: [{ id: EDIFICI, name: 'Edifici', kind: null }, { id: TIRA, name: 'Tira Led', kind: 'led_strip' }] }
const figura: PieceListItemDto = { ...dona, id: 1, name: 'Pastor', pieceTypes: [{ id: EDIFICI, name: 'Edifici' }] }

function item(ports: number[], portTypes?: Record<string, number>): SceneItem {
  return { id: 'i1', pieceId: 152, layerId: 'l', x: 0, y: 0, width: 10, height: 10, rotation: 0, ports, ...(portTypes ? { portTypes } : {}) }
}

describe('hardwareTypes / portFitsType / compatiblePorts', () => {
  it('keeps the types with an output kind, in order', () => {
    expect(hardwareTypes(dona).map(t => t.name)).toEqual(['Llum', 'Peça Moviment'])
    expect(hardwareTypes(figura)).toEqual([])
    expect(hardwareTypes(undefined)).toEqual([])
  })

  it('a port fits a type of the same kind only', () => {
    expect(portFitsType(onOff1, { kind: 'relay' })).toBe(true)
    expect(portFitsType(onOff1, { kind: 'led_strip' })).toBe(false)
    expect(portFitsType(onOff1, { kind: null })).toBe(false)
    expect(portFitsType(onOff1, {})).toBe(false)
  })

  it('offers every port of the kind of a hardware type, whatever type the port belongs to', () => {
    expect(compatiblePorts(ports, dona)).toEqual([onOff1, onOff2])
    expect(compatiblePorts(ports, casa)).toEqual([tira1])
    expect(compatiblePorts(ports, figura)).toEqual([])
    expect(compatiblePorts(ports, undefined)).toEqual([])
  })
})

describe('portRole', () => {
  it('is the explicit role, else the port\'s own type', () => {
    expect(portRole(item([2], { 2: LLUM }), onOff1)).toBe(LLUM)
    expect(portRole(item([2]), onOff1)).toBe(MOVIMENT)
    expect(portRole(item([2], { 3: LLUM }), onOff1)).toBe(MOVIMENT)
    expect(portRole(undefined, onOff1)).toBe(MOVIMENT)
    expect(portRole(item([152]), expansor)).toBeNull()
  })
})

describe('withPortRole / withoutPort', () => {
  it('adds the port once and records its role', () => {
    const once = withPortRole(item([2]), 3, LLUM)
    expect(once).toEqual({ ports: [2, 3], portTypes: { 3: LLUM } })
    const again = withPortRole(once, 3, MOVIMENT)
    expect(again).toEqual({ ports: [2, 3], portTypes: { 3: MOVIMENT } })
  })

  it('does not mutate the item', () => {
    const base = item([2], { 2: LLUM })
    withPortRole(base, 3, MOVIMENT)
    withoutPort(base, 2)
    expect(base).toEqual(item([2], { 2: LLUM }))
  })

  it('removes the port and its role, dropping portTypes when empty', () => {
    expect(withoutPort(item([2, 3], { 2: LLUM, 3: MOVIMENT }), 2)).toEqual({ ports: [3], portTypes: { 3: MOVIMENT } })
    expect(withoutPort(item([2], { 2: LLUM }), 2)).toEqual({ ports: [], portTypes: undefined })
    expect(withoutPort(item([2]), 99)).toEqual({ ports: [2], portTypes: undefined })
  })
})

describe('roleGroups', () => {
  it('one group per hardware type with the ports of its kind', () => {
    const groups = roleGroups(item([]), dona, ports)
    expect(groups.map(g => g.type.name)).toEqual(['Llum', 'Peça Moviment'])
    expect(groups[0]!.ports.map(r => r.port.id)).toEqual([2, 3])
    expect(groups[1]!.ports.map(r => r.port.id)).toEqual([2, 3])
    expect(groups.flatMap(g => g.ports).every(r => !r.selected && r.heldBy === null)).toBe(true)
  })

  it('marks the port selected under the type it plays and held under the other', () => {
    const groups = roleGroups(item([2, 3], { 2: LLUM }), dona, ports)
    const [llum, moviment] = groups
    expect(llum!.ports.map(r => [r.selected, r.heldBy?.name ?? null])).toEqual([[true, null], [false, 'Peça Moviment']])
    expect(moviment!.ports.map(r => [r.selected, r.heldBy?.name ?? null])).toEqual([[false, 'Llum'], [true, null]])
  })

  it('a role the piece does not have holds nothing (the invalid list reports it)', () => {
    const groups = roleGroups(item([2], { 2: 999 }), dona, ports)
    expect(groups.flatMap(g => g.ports.filter(r => r.port.id === 2)).map(r => [r.selected, r.heldBy])).toEqual([[false, null], [false, null]])
  })

  it('is empty without hardware types or piece', () => {
    expect(roleGroups(item([]), figura, ports)).toEqual([])
    expect(roleGroups(item([]), undefined, ports)).toEqual([])
    expect(roleGroups(item([]), casa, [])).toEqual([{ type: casa.pieceTypes[1], ports: [] }])
  })
})

describe('typesWithoutPort', () => {
  it('lists the hardware types no bound port plays', () => {
    expect(typesWithoutPort(item([]), dona, portById).map(t => t.name)).toEqual(['Llum', 'Peça Moviment'])
    expect(typesWithoutPort(item([2]), dona, portById).map(t => t.name)).toEqual(['Llum'])
    expect(typesWithoutPort(item([2], { 2: LLUM }), dona, portById).map(t => t.name)).toEqual(['Peça Moviment'])
    expect(typesWithoutPort(item([2, 3], { 2: LLUM }), dona, portById)).toEqual([])
  })

  it('ignores stale ports and inventory types', () => {
    expect(typesWithoutPort(item([999]), dona, portById).map(t => t.name)).toEqual(['Llum', 'Peça Moviment'])
    expect(typesWithoutPort(item([]), figura, portById)).toEqual([])
    expect(typesWithoutPort(undefined, undefined, portById)).toEqual([])
  })
})

describe('invalidBindings', () => {
  it('reports a role the piece lacks and a role of another kind', () => {
    expect(invalidBindings(item([2]), casa, portById)).toEqual([{ port: onOff1, reason: 'type', role: MOVIMENT }])
    expect(invalidBindings(item([102], { 102: LLUM }), dona, portById)).toEqual([{ port: tira1, reason: 'kind', role: LLUM }])
  })

  it('accepts valid roles, infrastructure ports, stale ports, kind-less types and an unknown piece', () => {
    expect(invalidBindings(item([2, 3, 152, 999], { 2: LLUM }), dona, portById)).toEqual([])
    expect(invalidBindings(item([2], { 2: EDIFICI }), dona, portById)).toEqual([])
    expect(invalidBindings(item([2]), undefined, portById)).toEqual([])
  })
})

describe('kindLabel', () => {
  it('labels every kind in Catalan and passes unknown values through', () => {
    expect(kindLabel('relay')).toBe('relé')
    expect(kindLabel('led_strip')).toBe('tira LED')
    expect(kindLabel('laser')).toBe('laser')
    expect(kindLabel(null)).toBe('')
  })
})
