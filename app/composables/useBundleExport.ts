import type { ShowIssue } from '~/types/show'
import { buildBundle, DEFAULT_CREATED_BY, planBundleFiles, type BundleProgress } from '~/utils/bundle/buildBundle'
import { bundleFileName } from '~/utils/bundle/fileName'
import type { BundleFileKind } from '~/utils/bundle/manifest'

export type BundleExportPhase = 'idle' | 'building' | 'downloading' | 'zipping' | 'done' | 'error'

export interface BundleExportFile {
  /** Path inside the zip. */
  path: string
  kind: BundleFileKind
  size: number
  loaded: number
  done: boolean
}

/**
 * «Exportar paquet»: builds the show package (errors block, exactly like «Exportar show»), downloads
 * every asset it references through the BFF, zips it all as a `stocka-bundle` and hands the
 * `.belen.zip` to the browser. The state is reactive so a dialog can follow it file by file.
 */
export function useBundleExport() {
  const { buildPackage, fetchAsset } = useShowPackageBuilder()

  const phase = ref<BundleExportPhase>('idle')
  const files = ref<BundleExportFile[]>([])
  const errors = ref<ShowIssue[]>([])
  const warnings = ref<ShowIssue[]>([])
  /** What stopped the export, for the user; null while it runs or when it succeeded. */
  const error = ref<string | null>(null)
  const fileName = ref<string | null>(null)

  const busy = computed(() => phase.value === 'building' || phase.value === 'downloading' || phase.value === 'zipping')
  const totalSize = computed(() => files.value.reduce((sum, f) => sum + f.size, 0))
  const loadedSize = computed(() => files.value.reduce((sum, f) => sum + Math.min(f.loaded, f.size), 0))

  function onProgress(progress: BundleProgress) {
    const file = files.value[progress.index]
    if (file && file.path === progress.file) {
      file.loaded = progress.loaded
      file.done = progress.loaded >= progress.size
    }
    // The zip is written right after the last file arrives.
    if (files.value.length > 0 && files.value.every(f => f.done)) phase.value = 'zipping'
  }

  function reset() {
    phase.value = 'idle'
    files.value = []
    errors.value = []
    warnings.value = []
    error.value = null
    fileName.value = null
  }

  async function start(): Promise<void> {
    if (busy.value) return
    reset()
    phase.value = 'building'
    try {
      const result = await buildPackage()
      errors.value = result.errors
      warnings.value = result.warnings
      if (!result.pkg) {
        const n = result.errors.length
        error.value = `El show té ${n} ${n === 1 ? 'error' : 'errors'}: corregeix-${n === 1 ? 'lo' : 'los'} i torna a exportar.`
        phase.value = 'error'
        return
      }
      const pkg = result.pkg
      fileName.value = bundleFileName(pkg)
      files.value = planBundleFiles(pkg).map(f => ({ path: f.path, kind: f.kind, size: f.size, loaded: 0, done: false }))
      phase.value = 'downloading'
      const built = await buildBundle({ pkg, fetchAsset, createdBy: DEFAULT_CREATED_BY, onProgress })
      download(built.blob, built.fileName)
      phase.value = 'done'
    } catch (e) {
      error.value = e instanceof Error && e.message ? e.message : "No s'ha pogut exportar el paquet."
      phase.value = 'error'
    }
  }

  return { phase, files, errors, warnings, error, fileName, busy, totalSize, loadedSize, start, reset }
}

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  // Give the browser a moment to pick the URL up before it is released.
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
