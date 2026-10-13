import type { SceneItem } from '~/types/editor'
import type { Rgb } from '~/utils/ledPreview'
import { createLedTarget, type LedTarget } from '~/utils/ledTarget'

/**
 * Colours of the LEDs of every piece on the board at the playhead, for the board to draw. Each
 * piece with a LED length is simulated from its clips (see `createLedTarget`) whenever the playhead
 * moves or the scene changes; `revision` then tells the board to redraw. The frames stay out of
 * Vue's reactivity: the board reads them while drawing.
 */
export function useLedBoardPreview() {
  const scene = useSceneStore()
  const playback = usePlaybackStore()
  const catalog = useCatalogStore()
  const { ledClips } = useLedClips()

  const frames = new Map<string, Rgb[]>()
  const targets = new Map<string, { ledCount: number, target: LedTarget }>()
  const revision = ref(0)

  /** LEDs of the piece of an item, when it drives LEDs and its length is known. */
  function ledCountOf(item: SceneItem): number | null {
    const piece = catalog.pieceById(item.pieceId)
    return catalog.isLedPiece(piece) ? catalog.ledLengthOf(item.pieceId) : null
  }

  function targetFor(itemId: string, ledCount: number): LedTarget {
    let t = targets.get(itemId)
    if (!t || t.ledCount !== ledCount) {
      t = { ledCount, target: createLedTarget(ledCount) }
      targets.set(itemId, t)
    }
    return t.target
  }

  function render() {
    frames.clear()
    if (playback.ledEnabled) {
      for (const item of scene.items) {
        const ledCount = ledCountOf(item)
        if (ledCount == null) continue
        const clips = ledClips.value.filter(c => c.itemId === item.id)
        frames.set(item.id, targetFor(item.id, ledCount).frameAt(clips, playback.currentMs))
      }
    }
    for (const id of targets.keys()) if (!frames.has(id)) targets.delete(id)
    revision.value++
  }
  // Re-runs whenever anything it read changed: the playhead, the clips, the items or the piece lengths.
  watchEffect(render)

  // The LED counts come from the piece details: load them for every LED piece on the board.
  watch(() => [scene.items.map(i => i.pieceId).join(','), catalog.pieces.length], () => {
    for (const id of new Set(scene.items.map(i => i.pieceId))) {
      if (catalog.isLedPiece(catalog.pieceById(id))) void catalog.ensurePieceDetail(id)
    }
  }, { immediate: true })

  /** Colours of an item's LEDs, LED 0 first; null when the piece has none or the preview is off. */
  const frameOf = (itemId: string): Rgb[] | null => frames.get(itemId) ?? null

  return { frameOf, ledCountOf, revision }
}
