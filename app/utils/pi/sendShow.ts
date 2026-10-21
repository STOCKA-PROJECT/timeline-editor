import type { ShowAssetRef, ShowPackage } from '~/types/show'
import { buildBundle, type BundleProgress } from '~/utils/bundle/buildBundle'
import { PiApiError, type PiClient, type PiImportReport, type UploadProgress } from '~/utils/pi/piClient'

// «Envia a la Raspberry»: takes the show package the editor just built straight to the Pi over the
// local network. Only what the Pi lacks travels: a show it already stores is just activated, and
// audio files it already has are left out of the zip.

export type SendPhase = 'checking' | 'building' | 'uploading' | 'importing'

export type SendShowResult =
  | { status: 'already', hash: string, activated: boolean }
  | { status: 'sent', report: PiImportReport, bytes: number, skippedAssets: string[] }
  | { status: 'rejected', report: PiImportReport }

export interface SendShowInput {
  client: PiClient
  pkg: ShowPackage
  fetchAsset: (ref: ShowAssetRef) => Promise<ArrayBuffer>
  /** Make it the active show (only when the Pi is not playing). */
  activate: boolean
  onPhase?: (phase: SendPhase) => void
  onBuildProgress?: (progress: BundleProgress) => void
  onUploadProgress?: (progress: UploadProgress) => void
  now?: Date
}

export async function sendShowToPi(input: SendShowInput): Promise<SendShowResult> {
  const { client, pkg } = input
  const hash = pkg.meta.hash
  input.onPhase?.('checking')
  const [bundles, assets] = await Promise.all([client.bundles(), client.assets()])

  if (bundles.shows.some(s => s.hash === hash)) {
    let activated = bundles.active === hash
    if (input.activate && !activated) {
      await client.activate(hash)
      activated = true
    }
    return { status: 'already', hash, activated }
  }

  const onPi = new Set(assets.audio ?? [])
  const skippedAssets = pkg.assets.audio.filter(name => onPi.has(name))
  input.onPhase?.('building')
  const built = await buildBundle({
    pkg,
    fetchAsset: input.fetchAsset,
    skipAssets: new Set(skippedAssets),
    activate: input.activate,
    onProgress: input.onBuildProgress,
    now: input.now
  })

  input.onPhase?.('uploading')
  try {
    const report = await client.uploadBundle(built.bytes, built.fileName, {
      activate: input.activate,
      onProgress: (p) => {
        input.onUploadProgress?.(p)
        if (p.sent >= p.total) input.onPhase?.('importing')
      }
    })
    return { status: 'sent', report, bytes: built.bytes.length, skippedAssets }
  } catch (error) {
    // 422: the Pi read the package and refused it (its validator found errors).
    if (error instanceof PiApiError && error.status === 422 && error.body) {
      return { status: 'rejected', report: error.body as unknown as PiImportReport }
    }
    throw error
  }
}
