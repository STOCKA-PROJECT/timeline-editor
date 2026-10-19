import { strToU8, zipSync, type Zippable } from 'fflate'
import type { ShowAssetRef, ShowPackage } from '~/types/show'
import { bundleFileName } from '~/utils/bundle/fileName'
import { buildManifest, serializeManifest, type BundleFileEntry, type BundleFileKind, type BundleManifest } from '~/utils/bundle/manifest'
import { serializeShowPackage } from '~/utils/showPackage'

// Builds a `.belen.zip` in the browser: `manifest.json` first, `show.json` deflated, audio and
// video stored as they are (already compressed). Mirrors `rpi4-system/tools/bundle_tool.py`; the
// Pi's importer (`rpi4-system/app/bundle.py`) accepts both outputs the same way.

export const MANIFEST_FILE = 'manifest.json'
export const SHOW_FILE = 'show.json'
export const DEFAULT_CREATED_BY = 'timeline-editor'

const ASSET_KINDS = ['audio', 'video'] as const
const DEFLATE_LEVEL = 6
const STORED = 0

type AssetKind = (typeof ASSET_KINDS)[number]

/** One file the zip will hold, before its bytes are known. */
export interface PlannedBundleFile {
  path: string
  kind: BundleFileKind
  /** Expected size: the serialized show, or the attachment's `sizeBytes`. */
  size: number
  /** Where the bytes come from; absent for `show.json`. */
  ref?: ShowAssetRef
}

export interface BundleProgress {
  /** Path inside the zip. */
  file: string
  /** 0-based position in the plan (`show.json` is 0). */
  index: number
  total: number
  loaded: number
  size: number
}

export interface BuildBundleInput {
  pkg: ShowPackage
  /** Bytes of an asset, in the editor downloaded through the BFF. */
  fetchAsset: (ref: ShowAssetRef) => Promise<ArrayBuffer>
  createdBy?: string
  activate?: boolean
  /** Clock for `createdAt` and the zip entries' mtime; injectable for deterministic tests. */
  now?: Date
  /** Called before and after each file (`loaded` 0, then the size). */
  onProgress?: (progress: BundleProgress) => void
}

export interface BuiltBundle {
  blob: Blob
  bytes: Uint8Array
  manifest: BundleManifest
  fileName: string
}

/** The package cannot become a complete bundle. The message is for the user (Catalan). */
export class BundleBuildError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BundleBuildError'
  }
}

export function assetPath(kind: AssetKind, name: string): string {
  return `assets/${kind}/${name}`
}

/** UTF-8 bytes of `show.json`: the pretty-printed package plus a trailing newline. */
export function showJsonBytes(pkg: ShowPackage): Uint8Array {
  return strToU8(serializeShowPackage(pkg) + '\n')
}

/**
 * Every file the zip must contain, in zip order: `show.json`, then the audio assets, then the
 * video assets, each as `show.assets` lists them. An asset whose origin the package does not know
 * (no `meta.assets` entry) is an error: without its attachment there is nothing to download.
 */
export function planBundleFiles(pkg: ShowPackage): PlannedBundleFile[] {
  const files: PlannedBundleFile[] = [{ path: SHOW_FILE, kind: 'show', size: showJsonBytes(pkg).length }]
  const refs = pkg.meta.assets ?? []
  for (const kind of ASSET_KINDS) {
    for (const name of pkg.assets[kind]) {
      const ref = refs.find(r => r.kind === kind && r.name === name)
      if (!ref) {
        const what = kind === 'audio' ? "d'àudio" : 'de vídeo'
        throw new BundleBuildError(
          `No se sap d'on ve el fitxer ${what} «${name}»: torna a carregar els fitxers de la peça i exporta de nou.`)
      }
      files.push({ path: assetPath(kind, name), kind, size: ref.sizeBytes, ref })
    }
  }
  return files
}

export async function buildBundle(input: BuildBundleInput): Promise<BuiltBundle> {
  const now = input.now ?? new Date()
  const plan = planBundleFiles(input.pkg)
  const entries: BundleFileEntry[] = []
  const contents: Zippable = {}

  for (const [index, file] of plan.entries()) {
    const report = (loaded: number) => input.onProgress?.({ file: file.path, index, total: plan.length, loaded, size: file.size })
    report(0)
    const bytes = file.ref ? await downloadAsset(file.ref, input.fetchAsset) : showJsonBytes(input.pkg)
    entries.push({ path: file.path, sha256: await sha256HexOf(bytes), size: bytes.length, kind: file.kind })
    contents[file.path] = [bytes, { level: file.kind === 'show' ? DEFLATE_LEVEL : STORED, mtime: now }]
    report(bytes.length)
  }

  const manifest = buildManifest(input.pkg, entries, { createdBy: input.createdBy ?? DEFAULT_CREATED_BY, now, activate: input.activate })
  // The importer reads the manifest before anything else: it goes first in the zip.
  const bytes = zipSync({ [MANIFEST_FILE]: [strToU8(serializeManifest(manifest)), { level: DEFLATE_LEVEL, mtime: now }], ...contents })
  return { blob: new Blob([asBuffer(bytes)], { type: 'application/zip' }), bytes, manifest, fileName: bundleFileName(input.pkg) }
}

/** Downloads one asset and refuses a body shorter or longer than the attachment says it is. */
async function downloadAsset(ref: ShowAssetRef, fetchAsset: BuildBundleInput['fetchAsset']): Promise<Uint8Array> {
  const bytes = new Uint8Array(await fetchAsset(ref))
  if (ref.sizeBytes > 0 && bytes.length !== ref.sizeBytes) {
    throw new BundleBuildError(
      `El fitxer «${ref.name}» s'ha descarregat incomplet (${bytes.length} de ${ref.sizeBytes} bytes): torna-ho a provar.`)
  }
  return bytes
}

/** Lowercase hex SHA-256 of raw bytes, via Web Crypto (browser and Node ≥ 20). */
export async function sha256HexOf(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', asBuffer(bytes))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}

/** fflate types its arrays over `ArrayBufferLike`; they are never shared memory, which `BufferSource` demands. */
function asBuffer(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return bytes as Uint8Array<ArrayBuffer>
}
