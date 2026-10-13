<script setup lang="ts">
import type { ShowIssue } from '~/types/show'

const scene = useSceneStore()
const config = useRuntimeConfig()
const stockaUrl = config.public.stockaUrl as string

/** Returns to the organization's timelines section in the main app, keeping the session open. */
const exitUrl = computed(() => {
  const base = stockaUrl.replace(/\/+$/, '')
  return scene.orgSlug ? `${base}/dashboard/${scene.orgSlug}/timelines` : base
})

function saveNow() {
  if (scene.dirty && !scene.saving) scene.save().catch(() => { /* surfaced via scene.error */ })
}

const saveLabel = computed(() => {
  if (scene.saving) return 'Desant…'
  if (scene.conflict) return 'Conflicte'
  if (scene.dirty) return 'Sense desar'
  if (scene.lastSavedAt) return 'Desat'
  return ''
})

// ----- export / import -----
// "Exportar show" builds the stocka-show package the Raspberry Pi executes (ports → hardware,
// clips → events with coerced parameters); it is refused while there are errors. "Còpia de
// seguretat" downloads the editor document plus the execution plan, which "Importar" reads back.
const selection = useSelectionStore()
const catalog = useCatalogStore()
const { ensureAudioLoaded } = useAudioClips()
const importInput = ref<HTMLInputElement | null>(null)
const importError = ref<string | null>(null)
const exportError = ref<string | null>(null)
const issues = ref<{ errors: ShowIssue[], warnings: ShowIssue[], fileName?: string } | null>(null)
const issuesOpen = ref(false)
const exporting = ref(false)

function fileBaseName(): string {
  return (scene.timelineName || 'show').trim().replace(/[^\w.-]+/g, '_')
}

function download(text: string, fileName: string) {
  const blob = new Blob([text], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  a.click()
  URL.revokeObjectURL(url)
}

async function ensureActionsLoaded() {
  const pieceIds = [...new Set(scene.items.map(i => i.pieceId))]
  await Promise.all(pieceIds.map(id => catalog.ensureActionsForPiece(catalog.pieceById(id))))
  // Piece details carry the LED length used to lay pieces out along a strip.
  await Promise.all(pieceIds.map(id => catalog.ensurePieceDetail(id)))
}

async function exportShow() {
  if (exporting.value) return
  exporting.value = true
  importError.value = null
  exportError.value = null
  try {
    await ensureActionsLoaded()
    // Audio files of the audio pieces: the package lists where every asset comes from.
    await ensureAudioLoaded()
    const fileName = `${fileBaseName()}.show.json`
    const result = await buildShowPackage({
      doc: scene.buildDocument(),
      catalog,
      orgPorts: catalog.ports,
      audioByPiece: catalog.audioByPiece,
      timelineName: scene.timelineName,
      timelineId: scene.timelineId
    })
    issues.value = { errors: result.errors, warnings: result.warnings, fileName }
    issuesOpen.value = result.errors.length > 0 || result.warnings.length > 0
    if (result.pkg) download(serializeShowPackage(result.pkg), fileName)
  } catch (e) {
    exportError.value = e instanceof Error ? e.message : "No s'ha pogut exportar el show."
  } finally {
    exporting.value = false
  }
}

async function exportBackup() {
  if (exporting.value) return
  exporting.value = true
  importError.value = null
  exportError.value = null
  try {
    await ensureActionsLoaded()
    const bundle = buildExportBundle({
      timelineId: scene.timelineId,
      timelineName: scene.timelineName,
      document: scene.buildDocument(),
      catalog
    })
    issues.value = { errors: [], warnings: bundle.execution.issues, fileName: `${fileBaseName()}.json` }
    issuesOpen.value = bundle.execution.issues.length > 0
    download(serializeExportBundle(bundle), `${fileBaseName()}.json`)
  } catch (e) {
    exportError.value = e instanceof Error ? e.message : "No s'ha pogut crear la còpia de seguretat."
  } finally {
    exporting.value = false
  }
}

async function onImportFile(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) return
  importError.value = null
  exportError.value = null
  issues.value = null
  issuesOpen.value = false
  try {
    const doc = parseSceneDocument(await file.text())
    scene.importDocument(doc)
    // The previous selection points at entities that no longer exist.
    selection.reset()
  } catch (e) {
    importError.value = e instanceof Error ? e.message : "No s'ha pogut importar el fitxer."
  }
}

const statusText = computed(() => {
  if (importError.value) return importError.value
  if (exportError.value) return exportError.value
  if (!issues.value) return ''
  const { errors, warnings } = issues.value
  if (errors.length) return `${errors.length} ${errors.length === 1 ? 'error' : 'errors'}`
  if (warnings.length) return `${warnings.length} ${warnings.length === 1 ? 'avís' : 'avisos'}`
  return ''
})
const statusTone = computed(() => {
  if (importError.value || exportError.value || issues.value?.errors.length) return 'text-danger'
  return 'text-warn'
})
</script>

<template>
  <header
    class="relative flex h-[var(--topbar-h)] flex-shrink-0 items-center gap-3 border-b border-line-strong bg-bg-card px-3">
    <span class="truncate font-display text-[15px] font-semibold leading-5 text-ink" :title="scene.timelineName">
      {{ scene.timelineName || 'Timeline' }}
    </span>

    <div class="mx-1 h-5 w-px bg-line-strong" />

    <!-- Board dimensions (in centimetres) -->
    <span class="label">Tauler</span>
    <label class="flex items-center gap-1 text-[12px] leading-4 text-ink-soft">
      Amplada (cm)
      <input
        type="number" min="1" step="0.1" class="field field-sm field-code !w-20"
        :value="scene.pxToCm(scene.board.width)"
        @change="scene.setBoard({ width: scene.cmToPx(Math.max(1, Number(($event.target as HTMLInputElement).value))) })">
    </label>
    <label class="flex items-center gap-1 text-[12px] leading-4 text-ink-soft">
      Alçada (cm)
      <input
        type="number" min="1" step="0.1" class="field field-sm field-code !w-20"
        :value="scene.pxToCm(scene.board.height)"
        @change="scene.setBoard({ height: scene.cmToPx(Math.max(1, Number(($event.target as HTMLInputElement).value))) })">
    </label>

    <div class="ml-auto flex items-center gap-2">
      <div class="flex items-center gap-1">
        <button
          class="btn btn-sm !px-2 !text-[15px] leading-none"
          :disabled="!scene.canUndo"
          title="Desfer (Ctrl+Z)" aria-label="Desfer"
          @click="scene.undo()">↶</button>
        <button
          class="btn btn-sm !px-2 !text-[15px] leading-none"
          :disabled="!scene.canRedo"
          title="Refer (Ctrl+Maj+Z)" aria-label="Refer"
          @click="scene.redo()">↷</button>
      </div>
      <div class="h-5 w-px bg-line-strong" />
      <div class="flex items-center gap-1">
        <button
          class="btn btn-sm" :disabled="exporting"
          title="Genera el paquet de show (.show.json) per al reproductor del pessebre"
          @click="exportShow()">{{ exporting ? 'Exportant…' : 'Exportar show' }}</button>
        <button
          class="btn btn-sm btn-quiet" :disabled="exporting"
          title="Descarrega el document de l'editor per poder-lo importar més tard"
          @click="exportBackup()">Còpia de seguretat</button>
        <button class="btn btn-sm btn-quiet" title="Importa una còpia de seguretat (.json)" @click="importInput?.click()">Importar</button>
        <input
          ref="importInput" type="file" accept="application/json,.json" class="hidden"
          @change="onImportFile">
      </div>
      <button
        v-if="statusText"
        class="max-w-64 truncate text-[12px] leading-4 underline-offset-2 hover:underline"
        :class="statusTone"
        :title="statusText"
        @click="issuesOpen = !issuesOpen">{{ statusText }}</button>
      <div class="h-5 w-px bg-line-strong" />
      <span class="text-[12px] leading-4" :class="scene.conflict ? 'text-danger' : 'text-ink-muted'">{{ saveLabel }}</span>
      <button class="btn btn-sm btn-primary" :disabled="scene.saving || !scene.dirty" @click="saveNow()">Desar</button>
      <a :href="exitUrl" class="btn btn-sm">Sortir</a>
    </div>

    <EditorExportIssues
      v-if="issuesOpen && issues"
      :errors="issues.errors"
      :warnings="issues.warnings"
      :file-name="issues.fileName"
      @close="issuesOpen = false" />
  </header>
</template>
