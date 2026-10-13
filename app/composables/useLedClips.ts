import type { SceneClip } from '~/types/editor'
import { catalog as outputCatalog, actionParams } from '~/types/catalog'
import type { LedClipSpec } from '~/utils/ledTarget'
import { coerceParam } from '~/utils/showCoerce'

/** A clip that drives LEDs (`animate`, `fill` or `clear` on a LED piece), resolved against the catalog. */
export interface LedClipInfo extends LedClipSpec {
  clip: SceneClip
  itemId: string
  pieceId: number
}

const LED_KINDS = new Set(['led_strip', 'led_segment'])
const LED_ACTIONS = new Set(['animate', 'fill', 'clear'])

/**
 * Resolves which clips light LEDs and with which parameters. Actions must be loaded for the piece
 * (the timeline does it); until then the clip is not a LED clip.
 */
export function useLedClips() {
  const scene = useSceneStore()
  const catalog = useCatalogStore()

  function ledClipOf(clip: SceneClip): LedClipInfo | null {
    if (clip.pieceTypeActionId == null) return null
    const track = scene.trackById(clip.trackId)
    const item = track ? scene.itemById(track.itemId) : undefined
    const piece = catalog.pieceById(item?.pieceId ?? -1)
    if (!item || !piece) return null
    const action = catalog.actionsForPiece(piece).find(a => a.id === clip.pieceTypeActionId)
    const kind = action ? catalog.kindOfAction(piece, action.id) : null
    if (!action || !kind || !LED_KINDS.has(kind) || !LED_ACTIONS.has(action.name)) return null
    const spec = outputCatalog.kinds[kind].actions[action.name]
    if (!spec) return null
    // A parameter is the clip's value when dynamic, the type's fixed value otherwise; coerced like
    // the export does, with the catalog default when blank or invalid.
    const rawOf = (name: string) => {
      const p = action.parameters.find(x => x.name === name)
      return p ? (p.dynamic ? clip.paramValues[name] : p.staticValue) : undefined
    }
    const rawAnimation = rawOf('animation_type')
    const animation = typeof rawAnimation === 'string' && rawAnimation ? rawAnimation : null
    const params: Record<string, unknown> = {}
    for (const [name, pspec] of Object.entries(actionParams(spec, animation))) {
      const coerced = coerceParam(rawOf(name), pspec)
      params[name] = coerced.ok && !coerced.omitted ? coerced.value : pspec.default
    }
    return {
      clip,
      itemId: item.id,
      pieceId: piece.id,
      id: clip.id,
      startMs: clip.startMs,
      durationMs: clip.durationMs,
      action: action.name as LedClipSpec['action'],
      animation,
      params,
      first: typeof params.first === 'number' ? params.first : null,
      last: typeof params.last === 'number' ? params.last : null,
      durationSec: action.parameters.some(p => p.isDuration) ? clip.durationMs / 1000 : null
    }
  }

  const ledClips = computed(() => scene.clips.map(ledClipOf).filter((x): x is LedClipInfo => x !== null))

  return { ledClipOf, ledClips }
}
