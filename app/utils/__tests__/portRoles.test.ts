import { describe, expect, it } from 'vitest'
import type { PieceListItemDto, PortResponseDto } from '~/types/api'
import type { SceneItem } from '~/types/editor'
import {
  compatiblePorts,
  hardwareTypes,
  invalidBindings,
  kindLabel,
  portFitsType,
  portPlays,
  portRoles,
  roleGroups,
  sharedRoles,
  typesWithoutPort,
  withTypePort,
  withoutPort,
  withoutRole
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
const onOff3 = port(5, 'Sortida On/Off 3', 'relay', LLUM)
const tira1 = port(102, 'Sortida Tira Led 1', 'led_strip', TIRA)
const expansor = port(152, 'Expansor 1', 'gpio_expander', null)
const sensor = port(202, 'Pulsador', 'sensor', null)
const ports = [onOff1, onOff2, onOff3, tira1, expansor, sensor]
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

function item(ports: number[], portTypes?: Record<string, number | number[]>): SceneItem {
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
    expect(compatiblePorts(ports, dona)).toEqual([onOff1, onOff2, onOff3])
    expect(compatiblePorts(ports, casa)).toEqual([tira1])
    expect(compatiblePorts(ports, figura)).toEqual([])
    expect(compatiblePorts(ports, undefined)).toEqual([])
  })
})

describe('portRoles / portPlays', () => {
  it('is the explicit role, a list of roles, else the port\'s own type', () => {
    expect(portRoles(item([2], { 2: LLUM }), onOff1)).toEqual([LLUM])
    expect(portRoles(item([2], { 2: [LLUM, MOVIMENT] }), onOff1)).toEqual([LLUM, MOVIMENT])
    expect(portRoles(item([2]), onOff1)).toEqual([MOVIMENT])
    expect(portRoles(item([2], { 3: LLUM }), onOff1)).toEqual([MOVIMENT])
    expect(portRoles(undefined, onOff1)).toEqual([MOVIMENT])
    expect(portRoles(item([152]), expansor)).toEqual([])
  })

  it('ignores junk inside a list', () => {
    expect(portRoles(item([2], { 2: [LLUM, 'x' as never, null as never] }), onOff1)).toEqual([LLUM])
  })

  it('a port plays a type only while bound to the item', () => {
    expect(portPlays(item([2], { 2: [LLUM, MOVIMENT] }), onOff1, LLUM)).toBe(true)
    expect(portPlays(item([2], { 2: [LLUM, MOVIMENT] }), onOff1, MOVIMENT)).toBe(true)
    expect(portPlays(item([2]), onOff1, LLUM)).toBe(false)
    expect(portPlays(item([], { 2: LLUM }), onOff1, LLUM)).toBe(false)
    expect(portPlays(undefined, onOff1, MOVIMENT)).toBe(false)
  })
})

describe('withTypePort', () => {
  it('binds the chosen port as the type, keeping the roles of the others', () => {
    expect(withTypePort(item([]), portById, LLUM, 2)).toEqual({ ports: [2], portTypes: { 2: LLUM } })
    expect(withTypePort(item([2], { 2: LLUM }), portById, MOVIMENT, 3)).toEqual({ ports: [2, 3], portTypes: { 2: LLUM, 3: MOVIMENT } })
  })

  it('moves the type from the port it had to the new one, unbinding a port left without roles', () => {
    expect(withTypePort(item([2], { 2: LLUM }), portById, LLUM, 3)).toEqual({ ports: [3], portTypes: { 3: LLUM } })
    // The implicit role (the port's own type) counts as well.
    expect(withTypePort(item([2]), portById, MOVIMENT, 3)).toEqual({ ports: [3], portTypes: { 3: MOVIMENT } })
    // A port that also plays another type keeps that one.
    expect(withTypePort(item([2], { 2: [LLUM, MOVIMENT] }), portById, LLUM, 3)).toEqual({ ports: [2, 3], portTypes: { 2: MOVIMENT, 3: LLUM } })
  })

  it('the same port may play two types of the piece: the roles become a list', () => {
    expect(withTypePort(item([2], { 2: LLUM }), portById, MOVIMENT, 2)).toEqual({ ports: [2], portTypes: { 2: [LLUM, MOVIMENT] } })
    // Also starting from the implicit role, and without duplicating a role it already has.
    expect(withTypePort(item([2]), portById, LLUM, 2)).toEqual({ ports: [2], portTypes: { 2: [MOVIMENT, LLUM] } })
    expect(withTypePort(item([2], { 2: [LLUM, MOVIMENT] }), portById, LLUM, 2)).toEqual({ ports: [2], portTypes: { 2: [LLUM, MOVIMENT] } })
  })

  it('null leaves the type without a port; every port that played it is cleared', () => {
    expect(withTypePort(item([2, 3], { 2: LLUM, 3: LLUM }), portById, LLUM, null)).toEqual({ ports: [], portTypes: undefined })
    expect(withTypePort(item([2], { 2: [LLUM, MOVIMENT] }), portById, LLUM, null)).toEqual({ ports: [2], portTypes: { 2: MOVIMENT } })
    expect(withTypePort(item([2]), portById, LLUM, null)).toEqual({ ports: [2], portTypes: { 2: MOVIMENT } })
  })

  it('clears every older duplicate when a type had several ports', () => {
    expect(withTypePort(item([2, 3], { 2: LLUM, 3: LLUM }), portById, LLUM, 5)).toEqual({ ports: [5], portTypes: { 5: LLUM } })
    expect(withTypePort(item([2, 3], { 2: LLUM, 3: LLUM }), portById, LLUM, 3)).toEqual({ ports: [3], portTypes: { 3: LLUM } })
  })

  it('keeps ports the organization no longer has as they were', () => {
    expect(withTypePort(item([999, 2], { 999: LLUM }), portById, MOVIMENT, 3)).toEqual({ ports: [999, 3], portTypes: { 999: LLUM, 3: MOVIMENT } })
    expect(withTypePort(item([999]), portById, LLUM, 2)).toEqual({ ports: [999, 2], portTypes: { 2: LLUM } })
    // Choosing an unknown port binds it with the explicit role only.
    expect(withTypePort(item([]), portById, LLUM, 999)).toEqual({ ports: [999], portTypes: { 999: LLUM } })
  })

  it('does not mutate the item', () => {
    const base = item([2], { 2: [LLUM, MOVIMENT] })
    withTypePort(base, portById, LLUM, 3)
    withoutRole(base, portById, 2, LLUM)
    withoutPort(base, 2)
    expect(base).toEqual(item([2], { 2: [LLUM, MOVIMENT] }))
  })
})

describe('withoutRole / withoutPort', () => {
  it('removes one role of a port, unbinding it when none is left', () => {
    expect(withoutRole(item([2], { 2: [LLUM, MOVIMENT] }), portById, 2, LLUM)).toEqual({ ports: [2], portTypes: { 2: MOVIMENT } })
    expect(withoutRole(item([2, 3], { 2: LLUM, 3: MOVIMENT }), portById, 2, LLUM)).toEqual({ ports: [3], portTypes: { 3: MOVIMENT } })
    expect(withoutRole(item([2]), portById, 2, MOVIMENT)).toEqual({ ports: [], portTypes: undefined })
    expect(withoutRole(item([2]), portById, 2, LLUM)).toEqual({ ports: [2], portTypes: { 2: MOVIMENT } })
    expect(withoutRole(item([2]), portById, 99, LLUM)).toEqual({ ports: [2], portTypes: { 2: MOVIMENT } })
  })

  it('removes the port and its roles, dropping portTypes when empty', () => {
    expect(withoutPort(item([2, 3], { 2: LLUM, 3: MOVIMENT }), 2)).toEqual({ ports: [3], portTypes: { 3: MOVIMENT } })
    expect(withoutPort(item([2], { 2: [LLUM, MOVIMENT] }), 2)).toEqual({ ports: [], portTypes: undefined })
    expect(withoutPort(item([2]), 99)).toEqual({ ports: [2], portTypes: undefined })
  })
})

describe('roleGroups', () => {
  it('one group per hardware type with the ports of its kind as options, none selected', () => {
    const groups = roleGroups(item([]), dona, ports)
    expect(groups.map(g => g.type.name)).toEqual(['Llum', 'Peça Moviment'])
    expect(groups[0]!.options.map(o => o.port.id)).toEqual([2, 3, 5])
    expect(groups[1]!.options.map(o => o.port.id)).toEqual([2, 3, 5])
    expect(groups.every(g => g.selected === null && g.extras.length === 0)).toBe(true)
    expect(groups.flatMap(g => g.options).every(o => o.usedBy.length === 0 && o.alsoPlays.length === 0)).toBe(true)
  })

  it('selects the port playing each type and says when the option already plays the other type', () => {
    const [llum, moviment] = roleGroups(item([2, 3], { 2: LLUM }), dona, ports)
    expect(llum!.selected).toBe(onOff1)
    expect(moviment!.selected).toBe(onOff2)
    expect(llum!.options.map(o => o.alsoPlays.map(t => t.name))).toEqual([[], ['Peça Moviment'], []])
    expect(moviment!.options.map(o => o.alsoPlays.map(t => t.name))).toEqual([['Llum'], [], []])
  })

  it('a port playing both types is selected in both groups and offered without an alsoPlays note for itself', () => {
    const [llum, moviment] = roleGroups(item([2], { 2: [LLUM, MOVIMENT] }), dona, ports)
    expect(llum!.selected).toBe(onOff1)
    expect(moviment!.selected).toBe(onOff1)
    expect(llum!.options[0]!.alsoPlays.map(t => t.name)).toEqual(['Peça Moviment'])
    expect(moviment!.options[0]!.alsoPlays.map(t => t.name)).toEqual(['Llum'])
  })

  it('lists further ports of a type (older scenes) as extras, in binding order', () => {
    const [llum] = roleGroups(item([3, 2, 5], { 3: LLUM, 2: LLUM }), dona, ports)
    expect(llum!.selected).toBe(onOff2)
    expect(llum!.extras).toEqual([onOff1, onOff3])
  })

  it('names the other items using each port', () => {
    const usedBy = (id: number) => (id === 3 ? ['Pastor', 'Ovella'] : [])
    const [llum] = roleGroups(item([]), dona, ports, usedBy)
    expect(llum!.options.map(o => o.usedBy)).toEqual([[], ['Pastor', 'Ovella'], []])
  })

  it('a role the piece does not have or of another kind selects nothing (the invalid list reports it)', () => {
    expect(roleGroups(item([2], { 2: 999 }), dona, ports).map(g => g.selected)).toEqual([null, null])
    expect(roleGroups(item([102], { 102: LLUM }), dona, ports).map(g => g.selected)).toEqual([null, null])
    // An unbound port's own type is not a selection either.
    expect(roleGroups(item([]), dona, ports).map(g => g.selected)).toEqual([null, null])
  })

  it('is empty without hardware types or piece', () => {
    expect(roleGroups(item([]), figura, ports)).toEqual([])
    expect(roleGroups(item([]), undefined, ports)).toEqual([])
    expect(roleGroups(item([]), casa, [])).toEqual([{ type: casa.pieceTypes[1], selected: null, extras: [], options: [] }])
  })
})

describe('typesWithoutPort', () => {
  it('lists the hardware types no bound port plays', () => {
    expect(typesWithoutPort(item([]), dona, portById).map(t => t.name)).toEqual(['Llum', 'Peça Moviment'])
    expect(typesWithoutPort(item([2]), dona, portById).map(t => t.name)).toEqual(['Llum'])
    expect(typesWithoutPort(item([2], { 2: LLUM }), dona, portById).map(t => t.name)).toEqual(['Peça Moviment'])
    expect(typesWithoutPort(item([2, 3], { 2: LLUM }), dona, portById)).toEqual([])
    expect(typesWithoutPort(item([2], { 2: [LLUM, MOVIMENT] }), dona, portById)).toEqual([])
  })

  it('ignores stale ports and inventory types', () => {
    expect(typesWithoutPort(item([999]), dona, portById).map(t => t.name)).toEqual(['Llum', 'Peça Moviment'])
    expect(typesWithoutPort(item([]), figura, portById)).toEqual([])
    expect(typesWithoutPort(undefined, undefined, portById)).toEqual([])
  })
})

describe('sharedRoles', () => {
  it('reports the ports playing two or more hardware types of the piece', () => {
    expect(sharedRoles(item([2], { 2: [LLUM, MOVIMENT] }), dona, portById)).toEqual([{ port: onOff1, types: [dona.pieceTypes[1], dona.pieceTypes[2]] }])
    expect(sharedRoles(item([2, 3], { 2: LLUM }), dona, portById)).toEqual([])
    // A role the piece lacks does not count, nor does a stale port or an unknown piece.
    expect(sharedRoles(item([2], { 2: [LLUM, 999] }), dona, portById)).toEqual([])
    expect(sharedRoles(item([999], { 999: [LLUM, MOVIMENT] }), dona, portById)).toEqual([])
    expect(sharedRoles(item([2], { 2: [LLUM, MOVIMENT] }), undefined, portById)).toEqual([])
    expect(sharedRoles(undefined, dona, portById)).toEqual([])
  })
})

describe('invalidBindings', () => {
  it('reports a role the piece lacks and a role of another kind, once per role', () => {
    expect(invalidBindings(item([2]), casa, portById)).toEqual([{ port: onOff1, reason: 'type', role: MOVIMENT }])
    expect(invalidBindings(item([102], { 102: LLUM }), dona, portById)).toEqual([{ port: tira1, reason: 'kind', role: LLUM }])
    expect(invalidBindings(item([2], { 2: [LLUM, 999] }), dona, portById)).toEqual([{ port: onOff1, reason: 'type', role: 999 }])
  })

  it('accepts valid roles, infrastructure ports, stale ports, kind-less types and an unknown piece', () => {
    expect(invalidBindings(item([2, 3, 152, 999], { 2: LLUM, 3: [LLUM, MOVIMENT] }), dona, portById)).toEqual([])
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
