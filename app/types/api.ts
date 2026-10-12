import type { OutputKind } from '~/types/catalog'

// Subset of the main Stocka frontend's app/types/api.ts — only what the editor needs.
// Keep in sync with the backend DTOs. (Future: extract to a shared package.)

export type OrganizationRole = 'OWNER' | 'MANAGER' | 'USER' | 'SPECTATOR'

export interface User {
  id: number
  email: string
  name: string
  lastName: string
}

export interface OrganizationResponseDto {
  id: number
  name: string
  slug: string
  currentUserRole: OrganizationRole
}

export type PieceStatus = 'ACTIVE' | 'PENDING'
export type PieceAttachmentKind = 'IMAGE' | 'DOCUMENT' | 'AUDIO'

export interface PieceTypeRefDto {
  id: number
  name: string
  /** Output kind the type drives (catalog id), or null for inventory-only types. */
  kind?: OutputKind | null
}

export interface PieceListItemDto {
  id: number
  name: string
  serialNumber?: string | null
  pieceTypes: PieceTypeRefDto[]
  coverAttachmentId?: number | null
  status: PieceStatus
  createdAt: string
  updatedAt: string
}

export interface PieceAttachmentResponseDto {
  id: number
  kind: PieceAttachmentKind
  originalFilename: string
  mimeType: string
  sizeBytes: number
  /** Audio length measured when uploading (AUDIO only; null when unknown). */
  durationMs?: number | null
  createdAt: string
}

export type AttributeScope = 'TYPE' | 'ORG'

/** A single attribute value of a piece (from the piece detail response). */
export interface PieceAttributeValueResponseDto {
  attributeId: number
  scope: AttributeScope
  attributeName: string
  displayName: string
  type: AttributeType
  value: string | null
}

/** Full piece detail (subset) — carries the attribute values the editor can bind to. */
export interface PieceResponseDto {
  id: number
  name: string
  pieceTypes: PieceTypeRefDto[]
  coverAttachmentId?: number | null
  attributeValues: PieceAttributeValueResponseDto[]
}

export type AttributeType =
  | 'TEXT' | 'LONGTEXT' | 'INTEGER' | 'DECIMAL' | 'PRICE'
  | 'DATE' | 'DATETIME' | 'BOOLEAN' | 'SELECT' | 'MULTI_SELECT'
  | 'URL' | 'EMAIL' | 'MEMBER'

export interface AttributeValidatorsDto {
  minLength?: number
  maxLength?: number
  regex?: string
  min?: number
  max?: number
  decimals?: number
  currency?: string
  minDate?: string
  maxDate?: string
  allowFuture?: boolean
  allowPast?: boolean
  options?: string[]
  minItems?: number
  maxItems?: number
  eligibleRoles?: OrganizationRole[]
}

export interface ActionParameterDto {
  name: string
  displayName: string
  type: AttributeType
  required: boolean
  position?: number
  validators?: AttributeValidatorsDto
  // Binding mode: static params carry a fixed `staticValue` shared by every piece of the type;
  // dynamic params (`dynamic === true`) are filled here in the timeline, per clip.
  dynamic?: boolean
  staticValue?: string | null
  // When true, this numeric parameter's value (seconds) is the clip length on the timeline, so the
  // clip has no separate duration field.
  isDuration?: boolean
}

export interface PieceTypeActionResponseDto {
  id: number
  name: string
  displayName: string
  description?: string | null
  position: number
  parameters: ActionParameterDto[]
}

export interface PieceTypeResponseDto {
  id: number
  name: string
  /** Output kind the type drives (catalog id), or null for inventory-only types. */
  kind?: OutputKind | null
  actions?: PieceTypeActionResponseDto[]
}

/**
 * A hardware port of the organization's belén controller, typed by the output catalog (`kind`)
 * and carrying a kind-specific `config` (strip DMA/channel/length, segment strip/first/last, the
 * three motor pins...). Piece-bound ports reference a piece type of the same kind and are
 * assignable to a board item whose piece is of that type; infrastructure ports (strips, button)
 * have no piece type. Gated feature: organizations without it expose no ports.
 */
export interface PortResponseDto {
  id: number
  name: string
  kind: OutputKind
  pieceTypeId: number | null
  pieceTypeName: string | null
  /** GPIO pin for kinds that have one (relay, led_strip, button); null otherwise. */
  pin: number | null
  config: Record<string, unknown>
  position: number
  parameters: ActionParameterDto[]
}

export interface TimelineResponseDto {
  id: number
  organizationId: number
  name: string
  createdAt: string
  updatedAt: string
}

/** Paginated wrapper used by the pieces list endpoint. */
export interface Page<T> {
  content: T[]
  totalElements: number
  totalPages: number
  number: number
  size: number
}

// ----- Timeline scene (editor document) persistence -----

export interface TimelineSceneResponseDto {
  id: number
  timelineId: number
  schemaVersion: number
  document: unknown | null
  version: number
  createdAt: string
  updatedAt: string
}

export interface UpsertTimelineSceneDto {
  schemaVersion: number
  document: unknown
  version: number | null
}
