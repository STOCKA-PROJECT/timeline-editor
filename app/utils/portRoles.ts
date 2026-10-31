import type { PieceListItemDto, PieceTypeRefDto, PortResponseDto } from '~/types/api'
import { isOutputKind, type OutputKind } from '~/types/catalog'
import type { SceneItem } from '~/types/editor'

// Which piece type each port of a board item plays ("role"). A hardware type of a piece drives one
// port («Llum» is one relay), chosen in the inspector among every port of the type's kind. A piece
// with two types of the same kind (a figure with «Llum» and «Moviment», both relays) gets one
// dropdown per type, each driven by the actions of its type; both may pick the same port, which
// then plays both types. The item stores the roles in `portTypes` (port id → type id, or a list of
// type ids when the port plays several); a port without an entry plays its own type, so older
// scenes keep working.

/** What the role functions need from a port. */
export type PortLike = Pick<PortResponseDto, 'id' | 'kind' | 'pieceTypeId'>

/** What the role functions need from an item. */
export type ItemPorts = Pick<SceneItem, 'ports' | 'portTypes'>

/** Catalan label of each output kind, for the inspector. */
export const KIND_LABELS: Record<OutputKind, string> = {
  relay: 'relé',
  gpio_expander: 'expansor',
  led_strip: 'tira LED',
  led_segment: 'segment LED',
  motor: 'motor',
  audio: 'àudio',
  moving_head: 'cap mòbil',
  sensor: 'sensor'
}

/** Catalan label of a kind; the raw id for kinds the editor does not know. */
export function kindLabel(kind: string | null | undefined): string {
  return isOutputKind(kind) ? KIND_LABELS[kind] : (kind ?? '')
}

/** Types of the piece that drive hardware (they have an output kind), in the piece's order. */
export function hardwareTypes(piece: PieceListItemDto | undefined): PieceTypeRefDto[] {
  return (piece?.pieceTypes ?? []).filter(t => isOutputKind(t.kind))
}

/**
 * Piece types a port plays for an item: the explicit roles, else the port's own type (none for an
 * infrastructure port). Only meaningful for a port bound to the item.
 */
export function portRoles(item: ItemPorts | undefined, port: PortLike): number[] {
  const explicit = item?.portTypes?.[String(port.id)]
  if (Array.isArray(explicit)) return explicit.filter((t): t is number => typeof t === 'number')
  if (typeof explicit === 'number') return [explicit]
  return port.pieceTypeId == null ? [] : [port.pieceTypeId]
}

/** Whether a port bound to the item plays the given type for it. */
export function portPlays(item: ItemPorts | undefined, port: PortLike, typeId: number): boolean {
  return (item?.ports ?? []).includes(port.id) && portRoles(item, port).includes(typeId)
}

/** Whether a port can play a type: same output kind. */
export function portFitsType(port: PortLike, type: Pick<PieceTypeRefDto, 'kind'>): boolean {
  return isOutputKind(type.kind) && port.kind === type.kind
}

/** Ports that can play at least one hardware type of the piece (any port of the same kind). */
export function compatiblePorts<P extends PortLike>(ports: P[], piece: PieceListItemDto | undefined): P[] {
  const types = hardwareTypes(piece)
  return ports.filter(p => types.some(t => portFitsType(p, t)))
}

/**
 * Roles of every bound port, in binding order. A port the organization no longer has (deleted
 * after the scene was saved) maps to `null`: its binding is kept as it is until it is removed.
 */
function rolesByPort(item: ItemPorts, portById: (id: number) => PortLike | undefined): Map<number, number[] | null> {
  const out = new Map<number, number[] | null>()
  for (const id of item.ports ?? []) {
    const port = portById(id)
    out.set(id, port ? portRoles(item, port) : null)
  }
  return out
}

/**
 * Item fields from the roles of each bound port: a port without roles is unbound, one role is
 * written as a number, several as a list, and an unknown port keeps the entry it had; `portTypes`
 * comes back `undefined` when empty, so the store drops the field instead of keeping an empty object.
 */
function fromRoles(item: ItemPorts, roles: Map<number, number[] | null>): ItemPorts {
  const ports: number[] = []
  const portTypes: Record<string, number | number[]> = {}
  for (const [id, types] of roles) {
    if (types === null) {
      ports.push(id)
      const kept = item.portTypes?.[String(id)]
      if (kept !== undefined) portTypes[String(id)] = kept
      continue
    }
    if (types.length === 0) continue
    ports.push(id)
    portTypes[String(id)] = types.length === 1 ? types[0]! : [...types]
  }
  return { ports, portTypes: Object.keys(portTypes).length ? portTypes : undefined }
}

/**
 * Item fields after choosing the port a type drives: the type leaves every other port (a port
 * left without a role is unbound) and joins the roles of the chosen one, which is bound if it was
 * not. `null` leaves the type without a port.
 */
export function withTypePort(item: ItemPorts, portById: (id: number) => PortLike | undefined, typeId: number, portId: number | null): ItemPorts {
  const roles = rolesByPort(item, portById)
  for (const [id, types] of roles) {
    if (id !== portId && types) roles.set(id, types.filter(t => t !== typeId))
  }
  if (portId != null) {
    // A port bound so far keeps its other roles; a newly bound one plays the chosen type only.
    const current = roles.get(portId) ?? []
    roles.set(portId, current.includes(typeId) ? current : [...current, typeId])
  }
  return fromRoles(item, roles)
}

/** Item fields after a port stops playing a type; the port is unbound when no role is left. */
export function withoutRole(item: ItemPorts, portById: (id: number) => PortLike | undefined, portId: number, typeId: number): ItemPorts {
  const roles = rolesByPort(item, portById)
  const types = roles.get(portId)
  if (types) roles.set(portId, types.filter(t => t !== typeId))
  return fromRoles(item, roles)
}

/**
 * Item fields after unbinding a port. `portTypes` comes back `undefined` when nothing is left in
 * it, so the store drops the field instead of keeping an empty object.
 */
export function withoutPort(item: ItemPorts, portId: number): ItemPorts {
  const ports = (item.ports ?? []).filter(id => id !== portId)
  const portTypes = { ...(item.portTypes ?? {}) }
  delete portTypes[String(portId)]
  return { ports, portTypes: Object.keys(portTypes).length ? portTypes : undefined }
}

/** One port as the inspector offers it in the dropdown of a type of the piece. */
export interface RoleOption<P extends PortLike = PortResponseDto> {
  port: P
  /** Names of the other board items bound to the port (pieces sharing it). */
  usedBy: string[]
  /** Other hardware types of this piece the port already plays for the item. */
  alsoPlays: PieceTypeRefDto[]
}

/** The ports a hardware type of the piece can use, with the one it drives for the item. */
export interface RoleGroup<P extends PortLike = PortResponseDto> {
  type: PieceTypeRefDto
  /** The port playing the type for the item (the first one when an older scene bound several). */
  selected: P | null
  /** Further ports playing the type (older scenes): a type drives one port, so they are to remove. */
  extras: P[]
  /** Every port of the type's kind, in catalog order. */
  options: RoleOption<P>[]
}

/**
 * Ports grouped by hardware type of the piece: every port of the type's kind as an option, with
 * the port playing that type for the item. `usedBy` names the other items bound to a port.
 */
export function roleGroups<P extends PortLike>(
  item: ItemPorts | undefined,
  piece: PieceListItemDto | undefined,
  ports: P[],
  usedBy: (portId: number) => string[] = () => []
): RoleGroup<P>[] {
  const types = hardwareTypes(piece)
  const bound = new Set(item?.ports ?? [])
  return types.map((type) => {
    const fitting = ports.filter(p => portFitsType(p, type))
    const playing = (item?.ports ?? [])
      .map(id => fitting.find(p => p.id === id))
      .filter((p): p is P => !!p && portRoles(item, p).includes(type.id))
    return {
      type,
      selected: playing[0] ?? null,
      extras: playing.slice(1),
      options: fitting.map(port => ({
        port,
        usedBy: usedBy(port.id),
        alsoPlays: bound.has(port.id) ? types.filter(t => t.id !== type.id && portRoles(item, port).includes(t.id)) : []
      }))
    }
  })
}

/** Hardware types of the piece with no port playing them for the item (their actions reach nothing). */
export function typesWithoutPort(item: ItemPorts | undefined, piece: PieceListItemDto | undefined, portById: (id: number) => PortLike | undefined): PieceTypeRefDto[] {
  const roles = new Set<number>()
  for (const id of item?.ports ?? []) {
    const port = portById(id)
    if (port) for (const role of portRoles(item, port)) roles.add(role)
  }
  return hardwareTypes(piece).filter(t => !roles.has(t.id))
}

/** A bound port playing several hardware types of the piece: the tracks of all of them drive it. */
export interface SharedRoles<P extends PortLike = PortResponseDto> {
  port: P
  types: PieceTypeRefDto[]
}

/** Bound ports (that still exist) playing two or more hardware types of the piece, to warn about. */
export function sharedRoles<P extends PortLike>(item: ItemPorts | undefined, piece: PieceListItemDto | undefined, portById: (id: number) => P | undefined): SharedRoles<P>[] {
  const types = hardwareTypes(piece)
  const out: SharedRoles<P>[] = []
  for (const id of item?.ports ?? []) {
    const port = portById(id)
    if (!port) continue
    const roles = portRoles(item, port)
    const played = types.filter(t => roles.includes(t.id))
    if (played.length > 1) out.push({ port, types: played })
  }
  return out
}

/** A bound port the piece cannot use: its role is not a type of the piece, or not of the port's kind. */
export interface InvalidBinding<P extends PortLike = PortResponseDto> {
  port: P
  /** Why: the role type is missing from the piece, or its kind differs from the port's. */
  reason: 'type' | 'kind'
  role: number
}

/**
 * Bound ports (that still exist) with a role that does not fit the piece: the same checks the
 * export and the backend make, one entry per offending role. Nothing is reported while the piece
 * is unknown, because the types cannot be checked, nor for a role type without a kind (inventory
 * types are not checked against the port).
 */
export function invalidBindings<P extends PortLike>(item: ItemPorts | undefined, piece: PieceListItemDto | undefined, portById: (id: number) => P | undefined): InvalidBinding<P>[] {
  if (!piece) return []
  const out: InvalidBinding<P>[] = []
  for (const id of item?.ports ?? []) {
    const port = portById(id)
    if (!port) continue
    for (const role of portRoles(item, port)) {
      const type = piece.pieceTypes.find(t => t.id === role)
      if (!type) out.push({ port, reason: 'type', role })
      else if (type.kind != null && type.kind !== port.kind) out.push({ port, reason: 'kind', role })
    }
  }
  return out
}
