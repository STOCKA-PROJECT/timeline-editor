import type { PieceAttachmentResponseDto, PieceTypeActionResponseDto } from '~/types/api'
import type { SceneClip } from '~/types/editor'
import { audioClipRange, findAudioByAssetName, isAudioPlay, type AudioClipRange } from '~/utils/audioAssets'

/** An `audio.play` clip resolved against the catalog: its action, file and the window it plays. */
export interface AudioClipInfo {
  clip: SceneClip
  pieceId: number
  action: PieceTypeActionResponseDto
  /** The file the clip names, when it is among the piece's loaded audio files. */
  attachment: PieceAttachmentResponseDto | null
  assetName: string | null
  range: AudioClipRange
  fileDurationMs: number | null
  /** Same-origin URL of the bytes, or null while the file is unknown. */
  url: string | null
  /** `start` is a dynamic parameter: the left edge of the clip can trim the file. */
  startEditable: boolean
  /** The clip length is the play time (`time` is the dynamic duration parameter). */
  durationEditable: boolean
}

/**
 * Resolves which clips play audio. Actions must be loaded for the piece (the timeline does it) and
 * the piece's audio files too ({@link ensureAudioLoaded}); until then the clip resolves without
 * attachment and the UI shows it as "file unknown".
 */
export function useAudioClips() {
  const scene = useSceneStore()
  const catalog = useCatalogStore()

  function audioClipOf(clip: SceneClip): AudioClipInfo | null {
    if (clip.pieceTypeActionId == null) return null
    const track = scene.trackById(clip.trackId)
    const item = track ? scene.itemById(track.itemId) : undefined
    const piece = catalog.pieceById(item?.pieceId ?? -1)
    if (!piece) return null
    const action = catalog.actionsForPiece(piece).find(a => a.id === clip.pieceTypeActionId)
    if (!action || !isAudioPlay(catalog.kindOfAction(piece, action.id), action.name)) return null
    const raw = clip.paramValues.audio_name
    const assetName = typeof raw === 'string' && raw ? raw : null
    const attachment = assetName ? (findAudioByAssetName(catalog.audioForPiece(piece.id), assetName) ?? null) : null
    return {
      clip,
      pieceId: piece.id,
      action,
      attachment,
      assetName,
      range: audioClipRange(clip, action),
      fileDurationMs: attachment?.durationMs ?? null,
      url: attachment ? catalog.attachmentContentUrl(piece.id, attachment.id) : null,
      startEditable: !!action.parameters.find(p => p.name === 'start')?.dynamic,
      durationEditable: !!action.parameters.find(p => p.name === 'time')?.isDuration
    }
  }

  const audioClips = computed(() => scene.clips.map(audioClipOf).filter((x): x is AudioClipInfo => x !== null))

  /** Loads the audio files of every audio piece on the board, so its clips can resolve their file. */
  async function ensureAudioLoaded(): Promise<void> {
    const ids = [...new Set(scene.items.map(i => i.pieceId))].filter(id => catalog.isAudioPiece(catalog.pieceById(id)))
    await Promise.all(ids.map(id => catalog.ensureAudioForPiece(id)))
  }

  return { audioClipOf, audioClips, ensureAudioLoaded }
}
