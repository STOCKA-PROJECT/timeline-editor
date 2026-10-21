import type { ShowAssetRef } from '~/types/show'
import { BundleBuildError } from '~/utils/bundle/buildBundle'
import { buildShowPackage } from '~/utils/showPackage'

type FetchFailure = { response?: { status?: number } }

/**
 * Builds the `stocka-show` package of the open timeline and fetches its assets. Shared by
 * «Exportar paquet» and «Envia a la Raspberry»; works offline from the laptop's copy of the catalog
 * and of the audio files.
 */
export function useShowPackageBuilder() {
  const scene = useSceneStore()
  const catalog = useCatalogStore()
  const cached = useCachedApi()
  const { ensureAudioLoaded } = useAudioClips()

  /** Actions and details of every piece on the board: the package needs them to resolve the clips. */
  async function ensureCatalogLoaded(): Promise<void> {
    const pieceIds = [...new Set(scene.items.map(i => i.pieceId))]
    await Promise.all(pieceIds.map(id => catalog.ensureActionsForPiece(catalog.pieceById(id))))
    await Promise.all(pieceIds.map(id => catalog.ensurePieceDetail(id)))
  }

  /** The package (or its blocking errors) of the scene as it is now. */
  async function buildPackage() {
    await ensureCatalogLoaded()
    // Audio files of the audio pieces: the package needs to know where every asset comes from.
    await ensureAudioLoaded()
    return await buildShowPackage({
      doc: scene.buildDocument(),
      catalog,
      orgPorts: catalog.ports,
      audioByPiece: catalog.audioByPiece,
      timelineName: scene.timelineName,
      timelineId: scene.timelineId
    })
  }

  /** Raw bytes of an attachment: the laptop's copy, or through the BFF (and then kept). */
  async function fetchAsset(ref: ShowAssetRef): Promise<ArrayBuffer> {
    const url = catalog.attachmentContentUrl(ref.pieceId, ref.attachmentId)
    if (!url) throw new BundleBuildError(`No es pot localitzar el fitxer «${ref.name}» sense organització oberta.`)
    try {
      return await cached.bytes(url)
    } catch (e) {
      const status = (e as FetchFailure).response?.status
      throw new BundleBuildError(
        `No s'ha pogut descarregar «${ref.name}»${status ? ` (HTTP ${status})` : ''}: comprova la connexió i torna-ho a provar.`)
    }
  }

  return { buildPackage, fetchAsset }
}
