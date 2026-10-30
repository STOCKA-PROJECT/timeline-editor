import type { PieceListItemDto, PieceTypeRefDto, PortResponseDto } from '~/types/api'
import { isOutputKind, type OutputKind } from '~/types/catalog'
import type { SceneItem } from '~/types/editor'

// Which piece type each port of a board item plays ("role"). A port belongs to one piece type in
// Stocka, but a piece with two types of the same kind (a figure with «Llum» and «Moviment», both
// relays) needs one port per type, each driven by the actions of its type. The item stores the
// role in `portTypes`; a port without an entry plays its own type, so older scenes keep working.

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

/** Piece type a port plays for an item: the explicit role, else the port's own type. */
export function portRole(item: ItemPorts | undefined, port: PortLike): number | null {
  const explicit = item?.portTypes?.[String(port.id)]
  return typeof explicit === 'number' ? explicit : port.pieceTypeId
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

/** Item fields after binding a port as the given type (replacing the role it had, if any). */
export function withPortRole(item: ItemPorts, portId: number, typeId: number): Required<ItemPorts> {
  const current = item.ports ?? []
  const ports = current.includes(portId) ? [...current] : [...current, portId]
  return { ports, portTypes: { ...(item.portTypes ?? {}), [String(portId)]: typeId } }
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

/** One port as the inspector lists it under a type of the piece. */
export interface RoleRow<P extends PortLike = PortResponseDto> {
  port: P
  /** The port plays this type for the item. */
  selected: boolean
  /** The port plays another type of the same piece (so it cannot be ticked here too), or null. */
  heldBy: PieceTypeRefDto | null
}

/** The ports a hardware type of the piece can use, with their state for the item. */
export interface RoleGroup<P extends PortLike = PortResponseDto> {
  type: PieceTypeRefDto
  ports: RoleRow<P>[]
}

/**
 * Ports grouped by hardware type of the piece: every port of the type's kind, marked selected when
 * it plays that type for the item and held when it plays another type of the piece.
 */
export function roleGroups<P extends PortLike>(item: ItemPorts | undefined, piece: PieceListItemDto | undefined, ports: P[]): RoleGroup<P>[] {
  const types = hardwareTypes(piece)
  const bound = new Set(item?.ports ?? [])
  return types.map(type => ({
    type,
    ports: ports.filter(p => portFitsType(p, type)).map((port) => {
      const role = bound.has(port.id) ? portRole(item, port) : null
      const selected = role === type.id
      const holder = !selected && role != null ? types.find(t => t.id === role) ?? null : null
      return { port, selected, heldBy: holder }
    })
  }))
}

/** Hardware types of the piece with no port playing them for the item (their actions reach nothing). */
export function typesWithoutPort(item: ItemPorts | undefined, piece: PieceListItemDto | undefined, portById: (id: number) => PortLike | undefined): PieceTypeRefDto[] {
  const roles = new Set((item?.ports ?? []).map((id) => {
    const port = portById(id)
    return port ? portRole(item, port) : null
  }))
  return hardwareTypes(piece).filter(t => !roles.has(t.id))
}

/** A bound port the piece cannot use: its role is not a type of the piece, or not of the port's kind. */
export interface InvalidBinding<P extends PortLike = PortResponseDto> {
  port: P
  /** Why: the role type is missing from the piece, or its kind differs from the port's. */
  reason: 'type' | 'kind'
  role: number
}

/**
 * Bound ports (that still exist) whose role does not fit the piece: the same checks the export and
 * the backend make. Nothing is reported while the piece is unknown, because the types cannot be
 * checked, nor for a role type without a kind (inventory types are not checked against the port).
 */
export function invalidBindings<P extends PortLike>(item: ItemPorts | undefined, piece: PieceListItemDto | undefined, portById: (id: number) => P | undefined): InvalidBinding<P>[] {
  if (!piece) return []
  const out: InvalidBinding<P>[] = []
  for (const id of item?.ports ?? []) {
    const port = portById(id)
    if (!port) continue
    const role = portRole(item, port)
    if (role == null) continue
    const type = piece.pieceTypes.find(t => t.id === role)
    if (!type) out.push({ port, reason: 'type', role })
    else if (type.kind != null && type.kind !== port.kind) out.push({ port, reason: 'kind', role })
  }
  return out
}
