<script setup lang="ts">
import { OfflineUnavailableError } from '~/utils/offline/cachedRequest'

definePageMeta({ layout: 'editor' })

const route = useRoute()
const orgSlug = computed(() => String(route.params.orgSlug))
const timelineId = computed(() => Number(route.params.timelineId))

const scene = useSceneStore()
const catalog = useCatalogStore()
const selection = useSelectionStore()
const playback = usePlaybackStore()

// Resizable side sections (left panel, right panel, bottom timeline, layers next to the timeline).
// The piece palette grew (filters, compact rows with the types): new key so everyone gets the wider default.
const left = usePaneSize('catalog', 340, { min: 240, max: 600, axis: 'x', dir: 1 })
const right = usePaneSize('right', 300, { min: 220, max: 520, axis: 'x', dir: -1 })
const bottom = usePaneSize('bottom', 320, { min: 160, max: 620, axis: 'y', dir: -1 })
const layersW = usePaneSize('layers', 260, { min: 200, max: 460, axis: 'x', dir: -1 })

const loadError = ref<string | null>(null)

useHead({
  title: () => (scene.timelineName ? `${scene.timelineName} · Timeline Editor` : 'Timeline Editor')
})

onMounted(async () => {
  try {
    await Promise.all([
      catalog.load(orgSlug.value),
      scene.load(orgSlug.value, timelineId.value)
    ])
    selection.setActiveLayer(scene.layersByZ[scene.layersByZ.length - 1]?.id ?? null)
    // Preload the actions of every placed piece so the inspector is ready.
    await Promise.all(
      scene.items.map(i => catalog.ensureActionsForPiece(catalog.pieceById(i.pieceId)))
    )
    // With a connection, keep on the laptop everything needed to work and to build the bundle
    // without one (piece details, audio files). In the background: the editor is usable already.
    if (!scene.openedOffline) void catalog.prepareOffline(scene.items.map(i => i.pieceId))
  } catch (e) {
    loadError.value = e instanceof OfflineUnavailableError
      ? 'Aquesta timeline no és al portàtil: obre-la una vegada amb connexió per poder-la editar després sense.'
      : 'No se ha podido cargar el editor. Comprueba tu acceso e inténtalo de nuevo.'
  }
})

// Autosave once mounted.
useAutosave()
useAudioPreview()

// Undo/redo keyboard shortcuts (Ctrl/Cmd+Z, Ctrl/Cmd+Shift+Z or Ctrl+Y), ignored while typing.
function onKeydown(e: KeyboardEvent) {
  if (!(e.ctrlKey || e.metaKey)) return
  const key = e.key.toLowerCase()
  if (key !== 'z' && key !== 'y') return
  const el = e.target as HTMLElement | null
  if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
  e.preventDefault()
  if (key === 'y' || (key === 'z' && e.shiftKey)) scene.redo()
  else scene.undo()
}
onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKeydown)
  playback.pause()
})
</script>

<template>
  <EditorToolbar />

  <div v-if="loadError" class="flex flex-1 items-center justify-center p-6 text-center text-[13.5px] text-danger">
    {{ loadError }}
  </div>

  <div v-else-if="scene.loading" class="flex flex-1 items-center justify-center text-[13px] text-ink-muted">
    Cargando…
  </div>

  <div v-else class="flex min-h-0 flex-1 flex-col overflow-hidden">
    <!-- Top: left panel | board | right panel (each side resizable) -->
    <div class="flex min-h-0 flex-1 overflow-hidden">
      <aside
        class="flex flex-shrink-0 flex-col gap-2 overflow-y-auto bg-bg p-2"
        :style="{ width: left.size.value + 'px' }">
        <EditorPieceCatalog />
      </aside>

      <div class="splitter-x" title="Arrastra para redimensionar" @pointerdown="left.startDrag" />

      <main class="flex min-w-0 flex-1 flex-col bg-bg-alt">
        <ClientOnly>
          <EditorBoardStage />
          <template #fallback>
            <div class="flex flex-1 items-center justify-center text-[13px] text-ink-muted">
              Preparando el tablero…
            </div>
          </template>
        </ClientOnly>
      </main>

      <div class="splitter-x" title="Arrastra para redimensionar" @pointerdown="right.startDrag" />

      <aside
        class="flex-shrink-0 overflow-y-auto bg-bg p-2"
        :style="{ width: right.size.value + 'px' }">
        <EditorClipInspector />
      </aside>
    </div>

    <!-- Resizable bottom section: timeline | layers panel (to the right of the timeline) -->
    <div class="splitter-y" title="Arrastra para redimensionar" @pointerdown="bottom.startDrag" />
    <div class="flex min-h-0 flex-shrink-0" :style="{ height: bottom.size.value + 'px' }">
      <div class="flex min-w-0 flex-1 flex-col">
        <EditorTimelinePanel />
      </div>

      <div class="splitter-x" title="Arrastra para redimensionar" @pointerdown="layersW.startDrag" />

      <aside
        class="flex flex-shrink-0 flex-col overflow-y-auto bg-bg p-2"
        :style="{ width: layersW.size.value + 'px' }">
        <EditorLayersPanel />
      </aside>
    </div>
  </div>
</template>

<style scoped>
.splitter-x {
  width: 6px;
  flex-shrink: 0;
  cursor: col-resize;
  background: var(--c-line);
  transition: background .12s;
  touch-action: none;
}
.splitter-y {
  height: 6px;
  flex-shrink: 0;
  cursor: row-resize;
  background: var(--c-line);
  transition: background .12s;
  touch-action: none;
}
.splitter-x:hover,
.splitter-y:hover {
  background: var(--c-accent);
}
</style>
