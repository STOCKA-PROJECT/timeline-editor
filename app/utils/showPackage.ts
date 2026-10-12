import type { PortResponseDto } from '~/types/api'
import {
  actionParams,
  catalog as defaultCatalog,
  DEFAULT_BOARD,
  requiredParams,
  type OutputCatalog
} from '~/types/catalog'
import type { SceneDocument } from '~/types/editor'
import {
  issue,
  SHOW_FORMAT,
  SHOW_VERSION,
  type ShowEvent,
  type ShowIssue,
  type ShowMode,
  type ShowPackage
} from '~/types/show'
import { canonicalJson, sha256Hex } from '~/utils/canonicalJson'
import { buildExecutionPlan, type CatalogLookups } from '~/utils/exportBundle'
import { coerceParam } from '~/utils/showCoerce'
import { buildHardware } from '~/utils/showHardware'
import { validateShowPackage } from '~/utils/showValidate'

// Builds the `stocka-show` v2 package from the editor document. The execution plan resolves
// clips into steps per board item; here each step becomes one event per port of the item that
// belongs to the piece type owning the action, with parameters coerced to the catalog types.

export const DEFAULT_MODE: ShowMode = { on: 'once', cycles: 1 }

export interface BuildShowInput {
  doc: SceneDocument
  catalog: CatalogLookups
  /** Every port of the organization: all of them go to `hardware`, assigned or not. */
  orgPorts: PortResponseDto[]
  timelineName: string
  timelineId: number | null
  board?: string
  mode?: ShowMode
  /** Clock for `meta.exportedAt`; injectable for deterministic tests. */
  now?: () => string
  outputCatalog?: OutputCatalog
}

export interface BuildShowResult {
  /** The package, or `null` when there is at least one error. */
  pkg: ShowPackage | null
  errors: ShowIssue[]
  warnings: ShowIssue[]
}

/** The part of the package the hash covers: everything but `meta`. */
export function showHashInput(pkg: Omit<ShowPackage, 'meta'>): string {
  const { board, mode, hardware, timeline, durationMs, assets } = pkg
  return canonicalJson({ board, mode, hardware, timeline, durationMs, assets })
}

export async function showHash(pkg: Omit<ShowPackage, 'meta'>): Promise<string> {
  return `sha256:${await sha256Hex(showHashInput(pkg))}`
}

/** Assembles the package without hashing: synchronous, so tests can inspect every step. */
export function assembleShowPackage(input: BuildShowInput): { body: Omit<ShowPackage, 'meta'>, issues: ShowIssue[] } {
  const outputCatalog = input.outputCatalog ?? defaultCatalog
  const kinds = outputCatalog.kinds
  const issues: ShowIssue[] = []

  const plan = buildExecutionPlan(input.doc, input.catalog)
  issues.push(...plan.issues)

  const built = buildHardware(input.orgPorts, outputCatalog)
  issues.push(...built.issues)
  const hardware = built.hardware

  const assets = { audio: new Set<string>(), video: new Set<string>() }
  const events: ShowEvent[] = []
  const itemById = new Map(plan.items.map(i => [i.itemId, i]))

  for (const step of plan.schedule) {
    if (!step.action) continue
    const item = itemById.get(step.itemId)
    if (!item) continue
    const label = step.label ?? step.action.displayName
    const targets = item.ports.filter(p => p.pieceTypeId === step.action!.pieceTypeId)
    if (targets.length === 0) {
      issues.push(issue('error', 'E_NO_PORT',
        `La peça «${item.pieceName ?? item.itemId}» no té cap port del tipus de peça de l'acció «${step.action.displayName}» (clip «${label}», ${step.startMs} ms).`,
        { clipId: step.clipId }))
      continue
    }
    for (const port of targets) {
      const spec = kinds[port.kind]
      const action = spec?.actions[step.action.name]
      if (!spec || !action) {
        issues.push(issue('error', 'E_ACTION_UNKNOWN',
          `L'acció «${step.action.name}» no existeix per a sortides ${port.kind} (port «${port.name}», clip «${label}»).`,
          { clipId: step.clipId, port: port.name }))
        continue
      }
      const rawAnimation = step.params.animation_type
      const animation = action.animations && typeof rawAnimation === 'string' ? rawAnimation : null
      const allowed = actionParams(action, animation)
      const params: Record<string, unknown> = {}
      let valid = true
      for (const [name, raw] of Object.entries(step.params)) {
        const pspec = allowed[name]
        if (!pspec) {
          valid = false
          const code = animation ? 'E_ANIMATION_PARAM' : 'E_PARAM_UNKNOWN'
          issues.push(issue('error', code,
            `El paràmetre «${name}» no existeix a ${port.kind}.${step.action.name}${animation ? ` per a l'animació «${animation}»` : ''} (clip «${label}»).`,
            { clipId: step.clipId, port: port.name }))
          continue
        }
        const res = coerceParam(raw, pspec)
        if (!res.ok) {
          valid = false
          const code = res.reason === 'required' ? 'E_PARAM_REQUIRED' : res.reason === 'range' ? 'E_PARAM_RANGE' : res.reason === 'enum' ? 'E_PARAM_ENUM' : 'E_PARAM_TYPE'
          const text = res.reason === 'required'
            ? `Falta el paràmetre obligatori «${name}» al clip «${label}» (${step.startMs} ms).`
            : `El paràmetre «${name}» del clip «${label}» ha de ser ${res.expected} (valor: ${JSON.stringify(raw)}).`
          issues.push(issue('error', code, text, { clipId: step.clipId, port: port.name }))
          continue
        }
        if (res.omitted) continue
        params[name] = res.value
        if (pspec.asset && typeof res.value === 'string') assets[pspec.asset].add(res.value)
      }
      for (const name of requiredParams(action, animation)) {
        if (!(name in params) && !(name in step.params)) {
          valid = false
          issues.push(issue('error', 'E_PARAM_REQUIRED', `Falta el paràmetre obligatori «${name}» al clip «${label}» (${step.startMs} ms).`, { clipId: step.clipId, port: port.name }))
        }
      }
      if (!valid) continue
      events.push({ t: step.startMs, target: port.name, action: step.action.name, params })
    }
  }

  // Stable sort by time: ties keep clip order, then the item's port order.
  const timeline = events.map((e, i) => [e, i] as const).sort((a, b) => a[0].t - b[0].t || a[1] - b[1]).map(([e]) => e)

  const body: Omit<ShowPackage, 'meta'> = {
    format: SHOW_FORMAT,
    version: SHOW_VERSION,
    board: input.board ?? DEFAULT_BOARD,
    mode: input.mode ?? DEFAULT_MODE,
    hardware,
    timeline,
    durationMs: input.doc.durationMs,
    assets: { audio: [...assets.audio], video: [...assets.video] }
  }
  issues.push(...validateShowPackage({ ...body, meta: { name: '', timelineId: null, exportedAt: '', hash: '' } }, outputCatalog))
  return { body, issues }
}

export async function buildShowPackage(input: BuildShowInput): Promise<BuildShowResult> {
  const { body, issues } = assembleShowPackage(input)
  const errors = dedupe(issues.filter(i => i.level === 'error'))
  const warnings = dedupe(issues.filter(i => i.level === 'warning'))
  if (errors.length > 0) return { pkg: null, errors, warnings }
  const hash = await showHash(body)
  const pkg: ShowPackage = {
    format: body.format,
    version: body.version,
    meta: {
      name: input.timelineName || 'Show',
      timelineId: input.timelineId,
      exportedAt: (input.now ?? (() => new Date().toISOString()))(),
      hash
    },
    board: body.board,
    mode: body.mode,
    hardware: body.hardware,
    timeline: body.timeline,
    durationMs: body.durationMs,
    assets: body.assets
  }
  return { pkg, errors, warnings }
}

/** Serializes a package for download (pretty-printed; the hash does not depend on formatting). */
export function serializeShowPackage(pkg: ShowPackage): string {
  return JSON.stringify(pkg, null, 2)
}

function dedupe(issues: ShowIssue[]): ShowIssue[] {
  const seen = new Set<string>()
  return issues.filter((i) => {
    const key = `${i.code}|${i.message}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
