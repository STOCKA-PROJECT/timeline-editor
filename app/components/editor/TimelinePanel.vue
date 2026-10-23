<script setup lang="ts">
import type { SceneClip, SceneLayer, SceneTrack } from '~/types/editor'
import { assignLanes, constrainMove, constrainResize, constrainResizeStart } from '~/utils/clipBounds'
import { formatTimeInput, timelineViewMs } from '~/utils/playRange'
import { rulerTicks } from '~/utils/rulerTicks'
import { DEFAULT_CLIP_MS } from '~/stores/scene'

const scene = useSceneStore()
const selection = useSelectionStore()
const catalog = useCatalogStore()
const playback = usePlaybackStore()
const { audioClipOf } = useAudioClips()

// ---- audio clips: waveform inside the clip and trimming that keeps the file in place ----
/** Audio info per clip id (null for the rest), recomputed as clips, actions or files change. */
const audioInfos = computed(() => new Map(scene.clips.map(c => [c.id, audioClipOf(c)])))
function audioOf(clip: SceneClip) {
  return audioInfos.value.get(clip.id) ?? null
}

const pxPerMs = ref(0.04)
const lanesRef = ref<HTMLDivElement | null>(null)

/** The show plus room after its last clip, to drop new ones there. */
const viewMs = computed(() => timelineViewMs(scene.durationMs))
const totalWidth = computed(() => viewMs.value * pxPerMs.value)
/** Ruler ticks adapted to the zoom: labels keep a minimum spacing, minor ticks fill the gaps. */
const ruler = computed(() => rulerTicks(viewMs.value, pxPerMs.value))
/** The Inici → Fi band on the ruler, only when it is not the whole show. */
const rangeBand = computed(() => {
  const fromMs = playback.rangeStartMs
  const toMs = playback.endMs
  if (fromMs <= 0 && toMs >= scene.durationMs) return null
  return { fromMs, toMs, label: `${formatTimeInput(fromMs)} a ${formatTimeInput(toMs)}` }
})

// ---- layer filter and folders ----
/**
 * Tracks shown: those of the selected layers (every layer when none is selected), and only for
 * pieces with available actions (also hides tracks of actionless pieces in older scenes).
 */
const visibleTracks = computed(() =>
  scene.tracks.filter((track) => {
    const item = scene.itemById(track.itemId)
    if (!item) return false
    if (selection.selectedLayerIds.length && !selection.selectedLayerIds.includes(item.layerId)) return false
    return catalog.actionsForPiece(catalog.pieceById(item.pieceId)).length > 0
  })
)

interface TrackGroup { layer: SceneLayer, tracks: SceneTrack[] }

/** Visible tracks grouped by layer, topmost layer first (same order as the layers panel). */
const trackGroups = computed<TrackGroup[]>(() => {
  const byLayer = new Map<string, SceneTrack[]>()
  for (const track of visibleTracks.value) {
    const layerId = scene.itemById(track.itemId)!.layerId
    if (!byLayer.has(layerId)) byLayer.set(layerId, [])
    byLayer.get(layerId)!.push(track)
  }
  return [...scene.layersByZ].reverse()
    .filter(layer => byLayer.has(layer.id))
    .map(layer => ({ layer, tracks: byLayer.get(layer.id)! }))
})

/** Folders only make sense when tracks of more than one layer are on screen. */
const showFolders = computed(() => trackGroups.value.length > 1)
const collapsedLayerIds = ref<string[]>([])
function isCollapsed(layerId: string): boolean {
  return collapsedLayerIds.value.includes(layerId)
}
function toggleFolder(layerId: string) {
  collapsedLayerIds.value = isCollapsed(layerId)
    ? collapsedLayerIds.value.filter(id => id !== layerId)
    : [...collapsedLayerIds.value, layerId]
}

/** True when the scene has tracks but the selected layers hide all of them. */
const hiddenBySelection = computed(() =>
  visibleTracks.value.length === 0 && selection.selectedLayerIds.length > 0 && scene.tracks.some((track) => {
    const item = scene.itemById(track.itemId)
    return !!item && catalog.actionsForPiece(catalog.pieceById(item.pieceId)).length > 0
  }))

// ---- board <-> timeline selection sync ----
/** A track is highlighted when its board item is part of the current selection. */
function isTrackSelected(track: SceneTrack): boolean {
  return selection.selectedItemIds.includes(track.itemId)
}

// Selecting a board item scrolls its track into view ("focus" in the timeline), opening its folder.
watch(() => selection.selectedItemId, (itemId) => {
  if (!itemId) return
  const track = visibleTracks.value.find(t => t.itemId === itemId)
  if (!track) return
  const layerId = scene.itemById(itemId)?.layerId
  if (layerId && isCollapsed(layerId)) toggleFolder(layerId)
  nextTick(() => {
    lanesRef.value
      ?.querySelector(`[data-track-id="${track.id}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  })
})

function trackItemName(track: SceneTrack): string {
  const item = scene.itemById(track.itemId)
  return item ? (catalog.pieceById(item.pieceId)?.name ?? `#${item.pieceId}`) : track.name
}

function clipLeft(c: SceneClip) { return c.startMs * pxPerMs.value }
function clipWidth(c: SceneClip) { return Math.max(6, c.durationMs * pxPerMs.value) }

function clipLabel(c: SceneClip): string {
  if (c.pieceTypeActionId == null) return 'Sense acció'
  // Try to resolve a display name from the catalog of the clip's item.
  const track = scene.trackById(c.trackId)
  const item = track ? scene.itemById(track.itemId) : undefined
  const action = catalog.actionsForPiece(catalog.pieceById(item?.pieceId ?? -1))
    .find(a => a.id === c.pieceTypeActionId)
  const name = action?.displayName ?? c.label ?? 'Acció'
  const audio = audioOf(c)
  if (audio) return audio.attachment ? `${name} · ${audio.attachment.originalFilename}` : audio.assetName ? `${name} · ${audio.assetName}` : `${name} · sense fitxer`
  return name
}

// ---- add clip ----
async function addClipAt(track: SceneTrack, ms: number) {
  const item = scene.itemById(track.itemId)
  const piece = catalog.pieceById(item?.pieceId ?? -1)
  await catalog.ensureActionsForPiece(piece)
  // Clips always carry an action; without one available the clip is not created.
  const firstAction = catalog.actionsForPiece(piece)[0]?.id
  if (firstAction == null) return
  // A piece may run several actions at once, so a new clip can start anywhere (it lands on a
  // free sub-lane of the track when it overlaps another clip).
  const clip = scene.addClip(track.id, firstAction, Math.max(0, ms), DEFAULT_CLIP_MS)
  selection.selectClip(clip.id)
}

// ---- sub-lanes: overlapping clips are stacked instead of drawn on top of each other ----
const LANE_H = 32
const ROW_PAD = 4
/** Lane of every clip and lane count per track, recomputed as clips move. */
const trackLanes = computed(() => {
  const out = new Map<string, { lanes: Map<string, number>, count: number }>()
  for (const track of scene.tracks) out.set(track.id, assignLanes(scene.clipsForTrack(track.id)))
  return out
})
function rowHeight(track: SceneTrack): number {
  return ROW_PAD * 2 + (trackLanes.value.get(track.id)?.count ?? 1) * LANE_H
}
function clipTop(clip: SceneClip): number {
  return ROW_PAD + (trackLanes.value.get(clip.trackId)?.lanes.get(clip.id) ?? 0) * LANE_H
}

function onLaneDblClick(track: SceneTrack, e: MouseEvent) {
  const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
  addClipAt(track, Math.max(0, (e.clientX - rect.left) / pxPerMs.value))
}

// ---- drag / resize clips ----
/** Magnetic distance of the snap, in screen pixels (converted to ms at the current zoom). */
const SNAP_PX = 8

/**
 * Drags a clip, its right edge or its left edge. Clips may overlap (a piece can run several
 * actions at once); their edges are magnetised to the neighbours, the start of the scene and the
 * playhead (Alt disables the snap) and the start is rounded to the grid. An audio clip behaves
 * like in any editor: trimming its left edge moves the in-point of the file (the sound stays in
 * place), it cannot start before the file does, and its right edge stops at the end of the file.
 */
function startClipDrag(clip: SceneClip, e: PointerEvent, mode: 'move' | 'resize' | 'resize-start') {
  e.preventDefault()
  e.stopPropagation()
  selection.selectClip(clip.id)
  const startX = e.clientX
  const orig = { id: clip.id, startMs: clip.startMs, durationMs: clip.durationMs }
  const others = scene.clipsForTrack(clip.trackId).filter(c => c.id !== clip.id)
  const audio = audioOf(clip)
  const fileStartSec = audio?.range.startSec ?? 0
  // Longest the clip may be: the rest of the file after its in-point (when the length is the play time).
  const maxMs = audio?.durationEditable && audio.fileDurationMs != null ? Math.max(100, audio.fileDurationMs - fileStartSec * 1000) : undefined
  // Earliest the left edge may go: the in-point cannot become negative.
  const minStartMs = audio?.startEditable ? Math.max(0, orig.startMs - fileStartSec * 1000) : undefined
  const origParams = { ...clip.paramValues }

  function onMove(ev: PointerEvent) {
    const deltaMs = (ev.clientX - startX) / pxPerMs.value
    const opts = {
      allowOverlap: true,
      snapMs: ev.altKey ? 0 : SNAP_PX / pxPerMs.value,
      snapTargets: [0, playback.currentMs, ...others.flatMap(c => [c.startMs, c.startMs + c.durationMs])]
    }
    if (mode === 'move') {
      scene.updateClip(clip.id, { startMs: constrainMove(orig, others, orig.startMs + deltaMs, opts) })
    } else if (mode === 'resize') {
      scene.updateClip(clip.id, { durationMs: constrainResize(orig, others, orig.durationMs + deltaMs, { ...opts, maxMs }) })
    } else {
      const newStart = constrainResizeStart(orig, others, orig.startMs + deltaMs, { ...opts, minStartMs })
      const partial: Partial<SceneClip> = { startMs: newStart, durationMs: orig.startMs + orig.durationMs - newStart }
      if (audio?.startEditable) {
        const inPoint = Math.max(0, Math.round((fileStartSec + (newStart - orig.startMs) / 1000) * 1000) / 1000)
        partial.paramValues = { ...origParams, start: inPoint }
      }
      scene.updateClip(clip.id, partial)
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
  // Scrubbing is a drag: without this the browser starts a text selection across the labels.
  e.preventDefault()
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

// ---- label column ----
const LABEL_W_DEFAULT = 168
/** Width of the sticky label column: draggable from the splitter on its right edge and persisted. */
const labels = usePaneSize('timeline-labels', LABEL_W_DEFAULT, { min: 96, max: 480, axis: 'x', dir: 1 })
const labelW = computed(() => labels.size.value)

function resetLabelWidth() {
  labels.size.value = LABEL_W_DEFAULT
  try { localStorage.setItem('tle:pane:timeline-labels', String(LABEL_W_DEFAULT)) } catch { /* private mode */ }
}

/** Clicking a track label selects its whole piece on the board (and clears any clip selection). */
function selectTrackItem(track: SceneTrack) {
  selection.selectItem(track.itemId)
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col select-none border-t border-line bg-bg-card">
    <!-- Transport bar: everything related to playback lives here, right above the timeline. -->
    <div class="flex items-center gap-3 border-b border-line px-3 py-1.5">
      <EditorPlaybackControls />
      <EditorRehearsalControls />
      <div class="ml-auto flex items-center gap-1">
        <span class="text-[11px] text-ink-muted">Zoom</span>
        <button class="btn !h-7 !px-2 !text-[12px]" @click="pxPerMs = Math.max(0.008, pxPerMs / 1.25)">−</button>
        <button class="btn !h-7 !px-2 !text-[12px]" @click="pxPerMs = Math.min(0.4, pxPerMs * 1.25)">+</button>
      </div>
    </div>

    <!-- Single scroll container: labels stay sticky-left and the ruler sticky-top,
         so name and lane always share the same row while scrolling in any direction. -->
    <div ref="lanesRef" class="relative min-h-0 flex-1 overflow-auto">
      <div class="relative" :style="{ width: labelW + totalWidth + 'px', minWidth: '100%' }">
        <!-- Header row -->
        <div class="sticky top-0 z-30 flex">
          <div
            class="sticky left-0 z-10 h-6 flex-shrink-0 border-b border-r border-line bg-bg-soft"
            :style="{ width: labelW + 'px' }">
            <div
              class="splitter absolute right-0 top-0 h-full w-1.5 cursor-col-resize"
              title="Arrossega per canviar l'amplada; doble clic per restablir-la"
              @pointerdown="labels.startDrag"
              @dblclick="resetLabelWidth" />
          </div>
          <div
            class="relative h-6 min-w-0 flex-1 cursor-ew-resize border-b border-line bg-bg-soft"
            @pointerdown="onRulerPointerDown">
            <div
              v-for="ms in ruler.minor"
              :key="'m' + ms"
              class="absolute bottom-0 h-1.5 border-l border-line/60"
              :style="{ left: ms * pxPerMs + 'px' }" />
            <div
              v-for="tick in ruler.major"
              :key="tick.ms"
              class="absolute top-0 h-full whitespace-nowrap border-l border-line/80 pl-1 text-[10px] tabular-nums text-ink-muted"
              :style="{ left: tick.ms * pxPerMs + 'px' }">
              {{ tick.label }}
            </div>
            <div
              class="show-end pointer-events-none absolute top-0 h-full"
              title="Final del show (el del darrer clip)"
              :style="{ left: scene.durationMs * pxPerMs + 'px', width: (viewMs - scene.durationMs) * pxPerMs + 'px' }" />
            <div
              v-if="rangeBand"
              class="range-band pointer-events-none absolute top-0 h-full"
              :title="`Tram: de ${rangeBand.label}`"
              :style="{ left: rangeBand.fromMs * pxPerMs + 'px', width: (rangeBand.toMs - rangeBand.fromMs) * pxPerMs + 'px' }" />
            <div
              class="pointer-events-none absolute top-0 h-full w-px bg-danger"
              :style="{ left: playback.currentMs * pxPerMs + 'px' }">
              <div class="absolute -left-1 top-0 h-2 w-2 rounded-full bg-danger" />
            </div>
          </div>
        </div>

        <template v-for="group in trackGroups" :key="group.layer.id">
          <!-- Folder header: one per layer when tracks of several layers are shown -->
          <div v-if="showFolders" class="flex h-7 border-b border-line" :data-layer-id="group.layer.id">
            <div
              class="sticky left-0 z-20 flex h-full flex-shrink-0 cursor-pointer items-center gap-1.5 truncate border-r border-line bg-bg-soft px-2 text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted hover:text-ink"
              :style="{ width: labelW + 'px' }"
              role="button"
              tabindex="0"
              :title="(isCollapsed(group.layer.id) ? 'Desplega' : 'Plega') + ' la capa «' + group.layer.name + '»'"
              @click="toggleFolder(group.layer.id)"
              @keydown.enter.prevent="toggleFolder(group.layer.id)"
              @keydown.space.prevent="toggleFolder(group.layer.id)">
              <span class="w-3 flex-shrink-0 text-center text-[10px]">{{ isCollapsed(group.layer.id) ? '▸' : '▾' }}</span>
              <span class="truncate">{{ group.layer.name }}</span>
              <span class="ml-auto flex-shrink-0 font-normal normal-case tracking-normal">{{ group.tracks.length }}</span>
              <div
                class="splitter absolute right-0 top-0 h-full w-1.5 cursor-col-resize"
                @pointerdown.stop="labels.startDrag"
                @click.stop
                @dblclick.stop="resetLabelWidth" />
            </div>
            <div class="min-w-0 flex-1 bg-bg-soft/60" />
          </div>

          <!-- Track rows: label + lane share the same row, always aligned -->
          <div
            v-for="track in (showFolders && isCollapsed(group.layer.id) ? [] : group.tracks)"
            :key="track.id"
            :data-track-id="track.id"
            class="flex border-b border-line/60"
            :style="{ height: rowHeight(track) + 'px' }">
            <div
              class="sticky left-0 z-20 flex h-full flex-shrink-0 cursor-pointer items-center gap-1 truncate border-r border-line px-2 text-[12px]"
              :class="isTrackSelected(track) ? 'bg-accent-soft font-medium text-accent-ink' : 'bg-bg-card text-ink hover:bg-bg-soft'"
              :style="{ width: labelW + 'px' }"
              role="button"
              tabindex="0"
              :title="'Selecciona «' + trackItemName(track) + '» al tauler'"
              @click="selectTrackItem(track)"
              @keydown.enter.prevent="selectTrackItem(track)"
              @keydown.space.prevent="selectTrackItem(track)">
              <span class="truncate">{{ trackItemName(track) }}</span>
              <!-- Same splitter on every row so the column can be resized from anywhere along its edge -->
              <div
                class="splitter absolute right-0 top-0 h-full w-1.5 cursor-col-resize"
                @pointerdown.stop="labels.startDrag"
                @click.stop
                @dblclick.stop="resetLabelWidth" />
            </div>
            <div
              class="relative h-full min-w-0 flex-1"
              :class="{ 'lane-selected': isTrackSelected(track) }"
              @dblclick="onLaneDblClick(track, $event)">
              <div
                v-for="clip in scene.clipsForTrack(track.id)"
                :key="clip.id"
                class="clip absolute flex h-7 cursor-grab items-center overflow-hidden rounded-[6px] text-[11px]"
                :class="{ 'is-selected': selection.selectedClipId === clip.id }"
                :style="{ left: clipLeft(clip) + 'px', width: clipWidth(clip) + 'px', top: clipTop(clip) + 'px' }"
                @pointerdown="startClipDrag(clip, $event, 'move')">
                <!-- Audio clips show the window of the file they play -->
                <EditorAudioWave
                  v-if="audioOf(clip)?.url"
                  class="pointer-events-none absolute left-0 top-0.5 opacity-70"
                  :color-var="selection.selectedClipId === clip.id ? '--c-on-accent' : '--c-accent-ink'"
                  :url="audioOf(clip)!.url"
                  :from-sec="audioOf(clip)!.range.startSec"
                  :to-sec="audioOf(clip)!.range.startSec + clip.durationMs / 1000"
                  :width="clipWidth(clip)"
                  :height="LANE_H - 8" />
                <span class="relative truncate px-2 font-medium">{{ clipLabel(clip) }}</span>
                <span
                  class="clip-handle absolute left-0 top-0 h-full w-1.5 cursor-ew-resize"
                  title="Retalla el principi"
                  @pointerdown="startClipDrag(clip, $event, 'resize-start')" />
                <span
                  class="clip-handle absolute right-0 top-0 h-full w-1.5 cursor-ew-resize"
                  title="Retalla el final"
                  @pointerdown="startClipDrag(clip, $event, 'resize')" />
              </div>
            </div>
          </div>
        </template>

        <p v-if="hiddenBySelection" class="p-2 text-[11.5px] text-ink-muted">
          Les capes seleccionades no tenen cap article amb accions. Tria una altra capa al panell de capes (Ctrl/Maj+clic per afegir-ne més).
        </p>
        <p v-else-if="visibleTracks.length === 0" class="p-2 text-[11.5px] text-ink-muted">
          Afegeix articles amb accions al tauler per veure les seves pistes.
        </p>

        <!-- Playhead line over the lanes (the dot lives in the sticky ruler) -->
        <div
          class="pointer-events-none absolute top-0 z-10 w-px bg-danger"
          :style="{ left: labelW + playback.currentMs * pxPerMs + 'px', height: '100%' }" />
      </div>
    </div>
  </section>
</template>

<style scoped>
/* Brand tints mixed from the tokens: Tailwind's opacity modifiers cannot apply to colours held in
   CSS variables, so `bg-accent-soft/70` and friends silently did nothing. */
.clip {
  background: color-mix(in oklab, var(--c-accent) 16%, var(--c-bg-card));
  border: 1px solid color-mix(in oklab, var(--c-accent) 55%, var(--c-line));
  border-left: 3px solid var(--c-accent);
  color: var(--c-accent-ink);
  box-shadow: 0 1px 2px rgba(16, 32, 40, .12);
  transition: background .12s, box-shadow .12s;
}
.clip:hover {
  background: color-mix(in oklab, var(--c-accent) 26%, var(--c-bg-card));
}
.clip.is-selected {
  background: var(--c-accent);
  border-color: var(--c-accent-ink);
  color: var(--c-on-accent);
  box-shadow: 0 0 0 2px var(--c-bg-card), 0 0 0 4px var(--c-accent);
  z-index: 1;
}
.clip-handle {
  background: color-mix(in oklab, var(--c-accent) 35%, transparent);
}
.clip.is-selected .clip-handle {
  background: color-mix(in oklab, var(--c-on-accent) 45%, transparent);
}
/* After the last clip: drawn, but not part of the show. */
.show-end {
  background: color-mix(in oklab, var(--c-ink) 6%, transparent);
  border-left: 1px dashed var(--c-line-strong);
}
/* Inici → Fi on the ruler: what local playback loops over and what the Raspberry rehearses. */
.range-band {
  background: color-mix(in oklab, var(--c-accent) 14%, transparent);
  border-left: 2px solid var(--c-accent);
  border-right: 2px solid var(--c-accent);
}
.lane-selected {
  background: color-mix(in oklab, var(--c-accent) 7%, transparent);
}
.splitter:hover {
  background: color-mix(in oklab, var(--c-accent) 40%, transparent);
}
</style>
