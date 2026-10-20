import type { PieceAttachmentResponseDto, PortResponseDto } from '~/types/api'
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
  type ShowAssetRef,
  type ShowEvent,
  type ShowIssue,
  type ShowMode,
  type ShowPackage
} from '~/types/show'
import { audioFileWindow, findAudioByAssetName, formatClock } from '~/utils/audioAssets'
import { canonicalJson, sha256Hex } from '~/utils/canonicalJson'
import { buildExecutionPlan, type CatalogLookups } from '~/utils/exportBundle'
import { coerceParam } from '~/utils/showCoerce'
import { buildHardware } from '~/utils/showHardware'
import { validateShowPackage } from '~/utils/showValidate'
import { layoutStrip, orderItems, uniqueName } from '~/utils/stripLayout'

// Builds the `stocka-show` v3 package from the editor document. The execution plan resolves
// clips into steps per board item; here each step becomes one event per port of the item that
// belongs to the piece type owning the action, with parameters coerced to the catalog types.

export const DEFAULT_MODE: ShowMode = { on: 'once', cycles: 1 }

export interface BuildShowInput {
  doc: SceneDocument
  catalog: CatalogLookups
  /** Every port of the organization: all of them go to `hardware`, assigned or not. */
  orgPorts: PortResponseDto[]
  /**
   * AUDIO attachments per piece id, for the pieces whose files have been loaded. When given, every
   * audio asset must be one of its piece's files (an error otherwise) and `meta.assets` lists where
   * each file comes from. Pieces absent from the map are not checked.
   */
  audioByPiece?: Record<number, PieceAttachmentResponseDto[]>
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
export function assembleShowPackage(input: BuildShowInput): { body: Omit<ShowPackage, 'meta'>, issues: ShowIssue[], assetRefs: ShowAssetRef[] } {
  const outputCatalog = input.outputCatalog ?? defaultCatalog
  const kinds = outputCatalog.kinds
  const issues: ShowIssue[] = []

  const plan = buildExecutionPlan(input.doc, input.catalog)
  issues.push(...plan.issues)

  const built = buildHardware(input.orgPorts, outputCatalog)
  issues.push(...built.issues)
  const hardware = built.hardware

  // Pieces on a LED strip become segments of it: laid out in the scene's strip order, each as
  // long as its length attribute (the last one may take the rest). Their clips then target the
  // segment with first/last relative to the piece, exactly like a segment port would.
  const segmentOf = new Map<string, Map<number, string>>()
  const taken = new Set(Object.keys(hardware))
  for (const port of input.orgPorts) {
    if (port.kind !== 'led_strip') continue
    const onPort = plan.items.filter(i => i.ports.some(p => p.id === port.id))
    if (onPort.length === 0) continue
    const ordered = orderItems(onPort.map(i => i.itemId), input.doc.stripOrder?.[String(port.id)])
    const stripLength = typeof port.config?.length === 'number' ? port.config.length : null
    const layout = layoutStrip(ordered, id => input.catalog.ledLengthOf?.(onPort.find(i => i.itemId === id)!.pieceId) ?? null, stripLength)
    ordered.forEach((itemId, index) => {
      const item = onPort.find(i => i.itemId === itemId)!
      const slot = layout.get(itemId)!
      const pieceName = item.pieceName ?? itemId
      if (!slot.explicit && index < ordered.length - 1) {
        issues.push(issue('error', 'E_LED_LENGTH',
          `«${pieceName}» no té atribut de longitud (LED) i no és l'última peça de «${port.name}»: posa-li la longitud o mou-la al final.`))
        return
      }
      if (slot.length <= 0) {
        issues.push(issue('error', 'E_LED_LENGTH',
          `«${pieceName}» no té cap LED a «${port.name}»: les peces anteriors ja omplen la tira${slot.explicit ? '' : ' i no té atribut de longitud'}.`))
        return
      }
      const name = uniqueName(pieceName, taken)
      hardware[name] = { kind: 'led_segment', strip: port.name, first: slot.offset, last: slot.offset + slot.length - 1 }
      if (!segmentOf.has(itemId)) segmentOf.set(itemId, new Map())
      segmentOf.get(itemId)!.set(port.id, name)
    })
  }

  const assets = { audio: new Set<string>() }
  const assetRefs = new Map<string, ShowAssetRef>()
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
      // A piece on a strip drives its own segment, unless the action is strip-wide (setBrightness).
      const segment = segmentOf.get(item.itemId)?.get(port.id)
      const useSegment = segment != null && step.action.name in kinds.led_segment.actions
      const targetName = useSegment ? segment : port.name
      const spec = kinds[useSegment ? 'led_segment' : port.kind]
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
          // A type may declare the parameters of every animation at once: the ones the clip does
          // not fill never reach the package, and a value left over from another animation is
          // dropped with a warning. Only a name no animation knows is an error.
          if (raw === null || raw === undefined || raw === '') continue
          const ofOtherAnimation = !!action.animations && Object.values(action.animations).some(a => name in a.params)
          if (animation && ofOtherAnimation) {
            issues.push(issue('warning', 'W_ANIMATION_PARAM_IGNORED',
              `El paràmetre «${name}» no s'aplica a l'animació «${animation}» i no s'exporta (clip «${label}», ${step.startMs} ms).`,
              { clipId: step.clipId, port: port.name }))
            continue
          }
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
        if (pspec.asset && typeof res.value === 'string') {
          assets.audio.add(res.value)
          if (pspec.asset === 'audio' && input.audioByPiece && item.pieceId in input.audioByPiece) {
            const files = input.audioByPiece[item.pieceId] ?? []
            const att = findAudioByAssetName(files, res.value)
            if (!att) {
              valid = false
              issues.push(issue('error', 'E_ASSET_MISSING',
                `El fitxer «${res.value}» del clip «${label}» no és entre els àudios de «${item.pieceName ?? item.itemId}»: tria'n un altre.`,
                { clipId: step.clipId, port: port.name }))
            } else {
              assetRefs.set(res.value, { name: res.value, kind: 'audio', pieceId: item.pieceId, attachmentId: att.id, mimeType: att.mimeType, sizeBytes: att.sizeBytes, durationMs: att.durationMs ?? null })
              const start = typeof step.params.start === 'number' ? step.params.start : 0
              const time = typeof step.params.time === 'number' ? step.params.time : null
              const window = audioFileWindow({ startSec: start, durationSec: time }, att.durationMs)
              if (window.beyondEndSec > 0.05) {
                issues.push(issue('warning', 'W_AUDIO_BEYOND_END',
                  `El clip «${label}» (${step.startMs} ms) s'allarga ${window.beyondEndSec.toFixed(1)} s més enllà del final de «${att.originalFilename}» (${formatClock(att.durationMs)}): aquesta part no sonarà.`,
                  { clipId: step.clipId, port: port.name }))
              }
            }
          }
        }
      }
      for (const name of requiredParams(action, animation)) {
        if (!(name in params) && !(name in step.params)) {
          valid = false
          issues.push(issue('error', 'E_PARAM_REQUIRED', `Falta el paràmetre obligatori «${name}» al clip «${label}» (${step.startMs} ms).`, { clipId: step.clipId, port: port.name }))
        }
      }
      if (!valid) continue
      events.push({ t: step.startMs, target: targetName, action: step.action.name, params })
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
    assets: { audio: [...assets.audio] }
  }
  issues.push(...validateShowPackage({ ...body, meta: { name: '', timelineId: null, exportedAt: '', hash: '' } }, outputCatalog))
  return { body, issues, assetRefs: [...assetRefs.values()] }
}

export async function buildShowPackage(input: BuildShowInput): Promise<BuildShowResult> {
  const { body, issues, assetRefs } = assembleShowPackage(input)
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
      hash,
      // Where each file comes from, when the editor knows (outside the hash: the show is the same).
      ...(input.audioByPiece ? { assets: assetRefs } : {})
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
