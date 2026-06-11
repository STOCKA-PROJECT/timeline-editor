<script setup lang="ts">
import type { SceneClip, SceneTrack } from '~/types/editor'

const scene = useSceneStore()
const selection = useSelectionStore()
const catalog = useCatalogStore()
const playback = usePlaybackStore()

const pxPerMs = ref(0.04)
const lanesRef = ref<HTMLDivElement | null>(null)

const totalWidth = computed(() => scene.durationMs * pxPerMs.value)
const seconds = computed(() => Math.ceil(scene.durationMs / 1000))

function trackItemName(track: SceneTrack): string {
  const item = scene.itemById(track.itemId)
  return item ? (catalog.pieceById(item.pieceId)?.name ?? `#${item.pieceId}`) : track.name
}

function clipLeft(c: SceneClip) { return c.startMs * pxPerMs.value }
function clipWidth(c: SceneClip) { return Math.max(6, c.durationMs * pxPerMs.value) }

function clipLabel(c: SceneClip): string {
  if (c.pieceTypeActionId == null) return 'Sin acción'
  // Try to resolve a display name from the catalog of the clip's item.
  const track = scene.trackById(c.trackId)
  const item = track ? scene.itemById(track.itemId) : undefined
  const action = catalog.actionsForPiece(catalog.pieceById(item?.pieceId ?? -1))
    .find(a => a.id === c.pieceTypeActionId)
  return action?.displayName ?? c.label ?? 'Acción'
}

// ---- add clip ----
async function addClipAt(track: SceneTrack, ms: number) {
  const item = scene.itemById(track.itemId)
  const piece = catalog.pieceById(item?.pieceId ?? -1)
  await catalog.ensureActionsForPiece(piece)
  const firstAction = catalog.actionsForPiece(piece)[0]?.id ?? null
  const clip = scene.addClip(track.id, firstAction, ms)
  selection.selectClip(clip.id)
}

function onLaneDblClick(track: SceneTrack, e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  addClipAt(track, Math.max(0, (e.clientX - rect.left) / pxPerMs.value))
}

// ---- drag / resize clips ----
function startClipDrag(clip: SceneClip, e: PointerEvent, mode: 'move' | 'resize') {
  e.preventDefault()
  e.stopPropagation()
  selection.selectClip(clip.id)
  const startX = e.clientX
  const origStart = clip.startMs
  const origDur = clip.durationMs

  function onMove(ev: PointerEvent) {
    const deltaMs = (ev.clientX - startX) / pxPerMs.value
    if (mode === 'move') {
      scene.updateClip(clip.id, { startMs: Math.max(0, Math.round((origStart + deltaMs) / 50) * 50) })
    } else {
      scene.updateClip(clip.id, { durationMs: Math.max(100, Math.round((origDur + deltaMs) / 50) * 50) })
    }
  }
  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// ---- scrub the playhead by clicking/dragging the ruler ----
function onRulerPointerDown(e: PointerEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  const seekAt = (clientX: number) => playback.seek((clientX - rect.left) / pxPerMs.value)
  seekAt(e.clientX)
  function onMove(ev: PointerEvent) { seekAt(ev.clientX) }
  function onUp() {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

const LABEL_W = 168
</script>

<template>
  <section class="flex h-full min-h-0 flex-col border-t border-line bg-bg-card">
    <!-- Transport bar: everything related to playback lives here, right above the timeline. -->
    <div class="flex items-center gap-3 border-b border-line px-3 py-1.5">
      <EditorPlaybackControls />
      <div class="ml-auto flex items-center gap-1">
        <span class="text-[11px] text-ink-muted">Zoom</span>
        <button class="btn !h-7 !px-2 !text-[12px]" @click="pxPerMs = Math.max(0.008, pxPerMs / 1.25)">−</button>
        <button class="btn !h-7 !px-2 !text-[12px]" @click="pxPerMs = Math.min(0.4, pxPerMs * 1.25)">+</button>
      </div>
    </div>

    <div class="flex min-h-0 flex-1">
      <!-- Track labels -->
      <div class="flex-shrink-0 overflow-hidden border-r border-line" :style="{ width: LABEL_W + 'px' }">
        <div class="h-6 border-b border-line bg-bg-soft" />
        <div
          v-for="track in scene.tracks"
          :key="track.id"
          class="flex h-10 items-center gap-1 truncate border-b border-line/60 px-2 text-[12px] text-ink">
          <span class="truncate">{{ trackItemName(track) }}</span>
        </div>
        <p v-if="scene.tracks.length === 0" class="p-2 text-[11.5px] text-ink-muted">
          Añade artículos al tablero para ver sus pistas.
        </p>
      </div>

      <!-- Lanes -->
      <div ref="lanesRef" class="relative min-w-0 flex-1 overflow-auto">
        <div :style="{ width: totalWidth + 'px', minWidth: '100%' }">
          <!-- Ruler -->
          <div class="relative h-6 cursor-ew-resize border-b border-line bg-bg-soft" @pointerdown="onRulerPointerDown">
            <div
              v-for="s in seconds"
              :key="s"
              class="absolute top-0 h-full border-l border-line/70 pl-1 text-[10px] text-ink-muted"
              :style="{ left: (s - 1) * 1000 * pxPerMs + 'px' }">
              {{ s - 1 }}s
            </div>
          </div>

          <!-- Track lanes -->
          <div
            v-for="track in scene.tracks"
            :key="track.id"
            class="relative h-10 border-b border-line/60"
            @dblclick="onLaneDblClick(track, $event)">
            <div
              v-for="clip in scene.clipsForTrack(track.id)"
              :key="clip.id"
              class="absolute top-1 flex h-8 cursor-grab items-center overflow-hidden rounded-[6px] border text-[11px] text-accent-ink"
              :class="selection.selectedClipId === clip.id ? 'border-accent bg-accent-soft ring-1 ring-accent' : 'border-accent/50 bg-accent-soft/70'"
              :style="{ left: clipLeft(clip) + 'px', width: clipWidth(clip) + 'px' }"
              @pointerdown="startClipDrag(clip, $event, 'move')">
              <span class="truncate px-1.5">{{ clipLabel(clip) }}</span>
              <span
                class="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize bg-accent/40"
                @pointerdown="startClipDrag(clip, $event, 'resize')" />
            </div>
          </div>

          <!-- Playhead -->
          <div
            class="pointer-events-none absolute top-0 z-10 w-px bg-danger"
            :style="{ left: playback.currentMs * pxPerMs + 'px', height: '100%' }">
            <div class="absolute -left-1 top-0 h-2 w-2 rounded-full bg-danger" />
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
