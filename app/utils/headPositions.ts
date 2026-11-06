import type { PortResponseDto } from '~/types/api'

/**
 * Named positions of a `moving_head` port (`config.positions`): `{ name, pan?, tilt?, zoom?,
 * intensity?, color?, white? }` in the units of the `set` action. A clip of `set` names one through
 * its `position` parameter; the values of the position fill the parameters the clip does not give
 * and the explicit ones win. Names match trimmed and case-insensitively. Mirrors
 * `HeadPositions` in the backend.
 */

/** Config key holding the positions. */
export const POSITIONS_KEY = 'positions'
/** Parameter of `set` naming a position. */
export const POSITION_PARAM = 'position'
/**
 * Parameter of `set` naming the position the head starts from: the export writes an immediate `set`
 * to it right before the cue, so one clip moves the head from one position to another.
 */
export const FROM_POSITION_PARAM = 'from_position'
/** Keys of a position besides `name`, in the order they are written. */
export const POSITION_VALUE_KEYS = ['pan', 'tilt', 'zoom', 'intensity', 'color', 'white'] as const

export interface HeadPosition {
  name: string
  pan?: number
  tilt?: number
  zoom?: number
  intensity?: number
  color?: [number, number, number]
  white?: number
}

/** The positions declared in a port config, skipping anything that is not an object with a name. */
export function positionsOf(port: Pick<PortResponseDto, 'config'> | null | undefined): HeadPosition[] {
  const raw = port?.config?.[POSITIONS_KEY]
  if (!Array.isArray(raw)) return []
  return raw.filter((p): p is HeadPosition => !!p && typeof p === 'object' && typeof (p as HeadPosition).name === 'string' && (p as HeadPosition).name.trim() !== '')
}

/** Names of the positions of a port, trimmed, in declaration order. */
export function positionNames(port: Pick<PortResponseDto, 'config'> | null | undefined): string[] {
  return positionsOf(port).map(p => p.name.trim())
}

/** The canonical form of a name for matching: trimmed and lower-cased. */
export function normalizePositionName(name: string): string {
  return name.trim().toLowerCase()
}

/** Finds a position by name (trimmed, case-insensitive). */
export function findPosition(port: Pick<PortResponseDto, 'config'> | null | undefined, name: unknown): HeadPosition | undefined {
  if (typeof name !== 'string') return undefined
  const wanted = normalizePositionName(name)
  return positionsOf(port).find(p => normalizePositionName(p.name) === wanted)
}

/** Whether `names` contains `name` under the matching rule of the positions. */
export function hasPosition(names: readonly string[], name: unknown): boolean {
  if (typeof name !== 'string') return false
  const wanted = normalizePositionName(name)
  return names.some(n => normalizePositionName(n) === wanted)
}

/**
 * Position names available to a clip that drives several heads: the ones every head has (a clip
 * on a track without port reaches all of them, and each must know the position).
 */
export function commonPositionNames(ports: Array<Pick<PortResponseDto, 'config'>>): string[] {
  if (ports.length === 0) return []
  const [first, ...rest] = ports
  return positionNames(first).filter(name => rest.every(p => hasPosition(positionNames(p), name)))
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === 'string' && value.trim() === '')
}

/**
 * The step parameters with a saved position applied: its values first, then the clip's own
 * non-blank parameters on top; `position` itself disappears.
 */
export function resolvePosition(stepParams: Record<string, unknown>, saved: HeadPosition): Record<string, unknown> {
  const merged: Record<string, unknown> = {}
  for (const key of POSITION_VALUE_KEYS) {
    if (saved[key] !== undefined && saved[key] !== null) merged[key] = saved[key]
  }
  for (const [key, value] of Object.entries(stepParams)) {
    if (key === POSITION_PARAM) continue
    if (!isBlank(value) || !(key in merged)) merged[key] = value
  }
  return merged
}
