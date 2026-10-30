import type {
  ActionParameterDto,
  PieceListItemDto,
  PieceTypeActionResponseDto,
  PortResponseDto
} from '~/types/api'
import type { OutputKind } from '~/types/catalog'
import type { SceneDocument } from '~/types/editor'
import { issue, type ShowIssue } from '~/types/show'
import { portRole } from '~/utils/portRoles'

// Export bundle: the editor document verbatim (so it can be re-imported into another timeline)
// plus a resolved execution plan: every clip becomes a step with its action and parameter values
// materialized, and every board item carries its assigned ports with the piece type each one plays
// for it (see `portRoles.ts`). `showPackage.ts` turns this plan
// into the `stocka-show` package the Raspberry Pi executes.

export const TIMELINE_EXPORT_FORMAT = 'stocka-timeline'
export const TIMELINE_EXPORT_VERSION = 1

/** A hardware port resolved for execution. */
export interface ExecutionPort {
  id: number
  name: string
  kind: OutputKind
  /**
   * Piece type the port plays for the item (`portTypes` of the item, else the port's own type);
   * null for infrastructure ports (strips, expanders, sensors). The actions of that type drive it.
   */
  pieceTypeId: number | null
  /** GPIO pin for kinds that have one; null otherwise. */
  pin: number | null
  config: Record<string, unknown>
  position: number
  parameters: ActionParameterDto[]
}

/** A board item resolved for execution: the piece it represents and its assigned ports. */
export interface ExecutionItem {
  itemId: string
  pieceId: number
  pieceName: string | null
  ports: ExecutionPort[]
}

/** One scheduled action occurrence (a clip), with its parameter values fully resolved. */
export interface ExecutionStep {
  clipId: string
  /** The board item (piece) this step drives; its ports are in {@link ExecutionPlan.items}. */
  itemId: string
  startMs: number
  durationMs: number
  /** `pieceTypeId` is the piece type that owns the action; it selects the item's target ports. */
  action: { id: number, name: string, displayName: string, pieceTypeId: number | null } | null
  /**
   * Final parameter values by parameter name: static values parsed from the action definition,
   * dynamic values taken from the clip, and the duration parameter (if any) expressed in seconds
   * from the clip length. Dynamic values the clip does not provide are `null`.
   */
  params: Record<string, unknown>
  label?: string
}

export interface ExecutionPlan {
  durationMs: number
  fps: number
  items: ExecutionItem[]
  /** Steps sorted by start time (stable: ties keep document order). */
  schedule: ExecutionStep[]
  /** Structured issues found while resolving. */
  issues: ShowIssue[]
  /** The same issues as plain text, for the backup bundle. */
  warnings: string[]
}

export interface TimelineExportBundle {
  format: typeof TIMELINE_EXPORT_FORMAT
  formatVersion: number
  exportedAt: string
  timeline: { id: number | null, name: string }
  /** The editor document verbatim — this is what "Importar" reads back. */
  document: SceneDocument
  execution: ExecutionPlan
}

/** Catalog lookups needed to resolve ids into execution data. */
export interface CatalogLookups {
  pieceById: (id: number) => PieceListItemDto | undefined
  portById: (id: number) => PortResponseDto | undefined
  actionsForPiece: (piece: PieceListItemDto | undefined) => PieceTypeActionResponseDto[]
  /** Piece type that owns an action, when known. */
  typeIdOfAction: (actionId: number) => number | undefined
  /** LEDs of a piece (its length attribute), for pieces laid out along a strip; null when unknown. */
  ledLengthOf?: (pieceId: number) => number | null
}

/** Parses a static parameter value (string-encoded on the action definition) into a JSON value. */
function parseStaticValue(param: ActionParameterDto): unknown {
  const raw = param.staticValue
  if (raw == null || raw === '') return null
  switch (param.type) {
    case 'BOOLEAN':
      return raw === 'true'
    case 'INTEGER':
    case 'DECIMAL':
    case 'PRICE': {
      const n = Number(raw)
      return Number.isFinite(n) ? n : raw
    }
    case 'MULTI_SELECT': {
      const trimmed = raw.trim()
      if (trimmed.startsWith('[')) {
        try {
          const parsed = JSON.parse(trimmed) as unknown
          if (Array.isArray(parsed)) return parsed
        } catch { /* fall through to raw */ }
      }
      return raw
    }
    default:
      return raw
  }
}

/** Resolves a clip's final parameter values from the action definition + the clip's own values. */
function resolveParams(
  action: PieceTypeActionResponseDto,
  paramValues: Record<string, unknown>,
  clipDurationMs: number
): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const param of action.parameters) {
    if (param.isDuration) {
      // The duration parameter (seconds) IS the clip length on the timeline.
      out[param.name] = clipDurationMs / 1000
    } else if (param.dynamic) {
      out[param.name] = paramValues[param.name] ?? null
    } else {
      out[param.name] = parseStaticValue(param)
    }
  }
  return out
}

/**
 * Resolves the editor document into a self-contained execution plan. Actions for every piece on
 * the board must be loaded in the catalog beforehand (see `catalog.ensureActionsForPiece`).
 */
export function buildExecutionPlan(doc: SceneDocument, catalog: CatalogLookups): ExecutionPlan {
  const issues: ShowIssue[] = []

  const items: ExecutionItem[] = doc.items.map((item) => {
    const piece = catalog.pieceById(item.pieceId)
    if (!piece) issues.push(issue('warning', 'W_PIECE_MISSING', `L'article ${item.pieceId} (element ${item.id}) no existeix al catàleg.`))
    const ports: ExecutionPort[] = []
    for (const portId of item.ports ?? []) {
      const port = catalog.portById(portId)
      if (!port) {
        issues.push(issue('error', 'E_PORT_STALE', `El port ${portId} assignat a «${piece?.name ?? item.id}» ja no existeix.`))
        continue
      }
      // The role must be a type of the piece and of the port's kind; checked like the backend does.
      const role = portRole(item, port)
      if (piece && role != null) {
        const type = piece.pieceTypes.find(t => t.id === role)
        if (!type) {
          issues.push(issue('error', 'E_PORT_TYPE_MISMATCH', `El port «${port.name}» fa d'un tipus que «${piece.name}» no té.`, { port: port.name }))
        } else if (type.kind != null && type.kind !== port.kind) {
          issues.push(issue('error', 'E_PORT_KIND_MISMATCH', `El port «${port.name}» (${port.kind}) no pot fer de «${type.name}» (${type.kind}).`, { port: port.name }))
        }
      }
      ports.push({
        id: port.id,
        name: port.name,
        kind: port.kind,
        pieceTypeId: role,
        pin: port.pin,
        config: port.config ?? {},
        position: port.position,
        parameters: port.parameters
      })
    }
    return { itemId: item.id, pieceId: item.pieceId, pieceName: piece?.name ?? null, ports }
  })

  const itemIdByTrack = new Map(doc.tracks.map(t => [t.id, t.itemId]))
  const schedule: ExecutionStep[] = []
  for (const clip of [...doc.clips].sort((a, b) => a.startMs - b.startMs)) {
    const itemId = itemIdByTrack.get(clip.trackId)
    if (!itemId) {
      issues.push(issue('warning', 'W_TRACK_MISSING', `El clip ${clip.label ?? clip.id} apunta a una pista inexistent i s'ha omès.`, { clipId: clip.id }))
      continue
    }
    const item = doc.items.find(i => i.id === itemId)
    const piece = catalog.pieceById(item?.pieceId ?? -1)
    let action: ExecutionStep['action'] = null
    let params: Record<string, unknown> = {}
    if (clip.pieceTypeActionId == null) {
      issues.push(issue('warning', 'W_CLIP_NO_ACTION', `El clip ${clip.label ?? clip.id} no té cap acció assignada.`, { clipId: clip.id }))
    } else {
      const def = catalog.actionsForPiece(piece).find(a => a.id === clip.pieceTypeActionId)
      if (!def) {
        issues.push(issue('warning', 'W_ACTION_UNRESOLVED', `No s'ha pogut resoldre l'acció ${clip.pieceTypeActionId} del clip ${clip.label ?? clip.id}.`, { clipId: clip.id }))
      } else {
        action = { id: def.id, name: def.name, displayName: def.displayName, pieceTypeId: catalog.typeIdOfAction(def.id) ?? null }
        params = resolveParams(def, clip.paramValues, clip.durationMs)
      }
    }
    schedule.push({
      clipId: clip.id,
      itemId,
      startMs: clip.startMs,
      durationMs: clip.durationMs,
      action,
      params,
      ...(clip.label ? { label: clip.label } : {})
    })
  }

  return { durationMs: doc.durationMs, fps: doc.fps ?? 30, items, schedule, issues, warnings: issues.map(i => i.message) }
}

export function buildExportBundle(input: {
  timelineId: number | null
  timelineName: string
  document: SceneDocument
  catalog: CatalogLookups
}): TimelineExportBundle {
  return {
    format: TIMELINE_EXPORT_FORMAT,
    formatVersion: TIMELINE_EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    timeline: { id: input.timelineId, name: input.timelineName },
    document: input.document,
    execution: buildExecutionPlan(input.document, input.catalog)
  }
}

/** Serializes an export bundle for download (pretty-printed for readability/diffing). */
export function serializeExportBundle(bundle: TimelineExportBundle): string {
  return JSON.stringify(bundle, null, 2)
}
