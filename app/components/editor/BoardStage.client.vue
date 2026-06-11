<script setup lang="ts">
import type { SceneItem, SceneLayer } from '~/types/editor'

const scene = useSceneStore()
const selection = useSelectionStore()
const catalog = useCatalogStore()
const playback = usePlaybackStore()

/* eslint-disable @typescript-eslint/no-explicit-any */
const wrapperRef = ref<HTMLDivElement | null>(null)
const stageRef = ref<any>(null)
const transformerRef = ref<any>(null)

const stageSize = reactive({ width: 800, height: 600 })
const view = reactive({ scale: 1, x: 0, y: 0 })

const stageConfig = computed(() => ({
  width: stageSize.width,
  height: stageSize.height,
  scaleX: view.scale,
  scaleY: view.scale,
  x: view.x,
  y: view.y,
  // Dragging empty space / the board background pans the view (grabbing an item moves the item).
  draggable: true
}))

function stageNode(): any {
  return stageRef.value?.getNode?.() ?? stageRef.value?.getStage?.() ?? null
}

function itemsOfLayer(layer: SceneLayer): SceneItem[] {
  return scene.items.filter(i => i.layerId === layer.id)
}

function pieceName(item: SceneItem): string {
  return catalog.pieceById(item.pieceId)?.name ?? `#${item.pieceId}`
}

// ---- cover images ----
const images = ref<Record<string, HTMLImageElement>>({})
function ensureImages() {
  for (const item of scene.items) {
    if (images.value[item.id]) continue
    const url = catalog.coverUrl(catalog.pieceById(item.pieceId))
    if (!url) continue
    const img = new Image()
    img.onload = () => { images.value = { ...images.value, [item.id]: img } }
    img.src = url
  }
}
// Re-run when items change OR when the catalog finishes loading: on initial load the catalog (piece
// list) often resolves after the board mounts, and without `catalog.pieces` we cannot build a cover
// URL — so we must retry once it is ready, not only when items change.
watch(
  () => scene.items.map(i => i.id + ':' + i.pieceId).join(',') + '|' + catalog.pieces.length,
  ensureImages,
  { immediate: true }
)

// ---- fit / resize ----
function fitToContainer() {
  const w = wrapperRef.value?.clientWidth ?? 800
  const h = wrapperRef.value?.clientHeight ?? 600
  stageSize.width = w
  stageSize.height = h
  const scale = Math.min(w / scene.board.width, h / scene.board.height) * 0.9
  view.scale = Number.isFinite(scale) && scale > 0 ? scale : 1
  view.x = (w - scene.board.width * view.scale) / 2
  view.y = (h - scene.board.height * view.scale) / 2
}

let ro: ResizeObserver | null = null
onMounted(() => {
  fitToContainer()
  ro = new ResizeObserver(() => fitToContainer())
  if (wrapperRef.value) ro.observe(wrapperRef.value)
})
onBeforeUnmount(() => ro?.disconnect())
watch(() => [scene.board.width, scene.board.height], fitToContainer)

// ---- pan (drag empty space / the board to move around, useful when zoomed in) ----
// The stage is draggable; Konva drags the top-most draggable node under the pointer, so grabbing an
// item drags the item and grabbing the background drags (pans) the stage. Item drags bubble up to
// this handler too, hence the `e.target === stage` guard.
function syncViewFromStage(e: any) {
  const stage = e.target.getStage?.()
  if (!stage || e.target !== stage) return
  view.x = stage.x()
  view.y = stage.y()
}

// Cursor is the (open) grab hand everywhere — see the wrapper class — except over an item, where we
// switch to a move cursor. We never use the closed-hand `grabbing`: it renders nearly all-white and
// vanishes over the white board. Clearing the inline style lets the canvas inherit grab again.
function setItemCursor(over: boolean) {
  const container = stageNode()?.container()
  if (container) container.style.cursor = over ? 'move' : ''
}

// ---- zoom ----
function onWheel(e: any) {
  e.evt.preventDefault()
  const stage = stageNode()
  if (!stage) return
  const oldScale = view.scale
  const pointer = stage.getPointerPosition()
  if (!pointer) return
  const mousePoint = { x: (pointer.x - view.x) / oldScale, y: (pointer.y - view.y) / oldScale }
  const dir = e.evt.deltaY > 0 ? -1 : 1
  const newScale = Math.min(5, Math.max(0.05, oldScale * (dir > 0 ? 1.08 : 0.92)))
  view.scale = newScale
  view.x = pointer.x - mousePoint.x * newScale
  view.y = pointer.y - mousePoint.y * newScale
}

// ---- selection / transformer ----
// The transformer (move/scale/rotate) only attaches when a single item is selected. Selecting a
// whole layer highlights every item with an outline instead (see template).
function attachTransformer() {
  const tr = transformerRef.value?.getNode?.()
  const stage = stageNode()
  if (!tr || !stage) return
  const id = selection.selectedItemId
  const node = id ? stage.findOne('#item-' + id) : null
  tr.nodes(node ? [node] : [])
  tr.getLayer()?.batchDraw()
}
watch(() => selection.selectedItemId, () => nextTick(attachTransformer))
watch(() => scene.items.length, () => nextTick(attachTransformer))

// When the selected item's geometry is edited from the inspector, refresh the transformer box.
watch(() => {
  const it = selection.selectedItemId ? scene.itemById(selection.selectedItemId) : null
  return it ? `${it.x},${it.y},${it.width},${it.height},${it.rotation}` : ''
}, () => nextTick(() => {
  const tr = transformerRef.value?.getNode?.()
  tr?.forceUpdate?.()
  tr?.getLayer()?.batchDraw()
}))

function isSelected(item: SceneItem): boolean {
  return selection.selectedItemIds.includes(item.id)
}

function onItemClick(item: SceneItem, e: any) {
  e.cancelBubble = true
  selection.selectItem(item.id)
  closeCtxMenu()
}

function onStageClick(e: any) {
  // Click on empty space (the stage itself) clears selection.
  if (e.target === e.target.getStage()) selection.selectItem(null)
  closeCtxMenu()
}

// ---- right-click: move item to another layer ----
const ctxMenu = ref<{ itemId: string, x: number, y: number } | null>(null)
const layersTopFirst = computed(() => [...scene.layersByZ].reverse())

function onItemContextMenu(item: SceneItem, e: any) {
  e.evt.preventDefault()
  e.cancelBubble = true
  selection.selectItem(item.id)
  const rect = wrapperRef.value?.getBoundingClientRect()
  if (!rect) return
  ctxMenu.value = { itemId: item.id, x: e.evt.clientX - rect.left, y: e.evt.clientY - rect.top }
}

function onStageContextMenu(e: any) {
  e.evt.preventDefault()
  if (e.target === e.target.getStage()) closeCtxMenu()
}

function moveItemToLayer(layerId: string) {
  if (ctxMenu.value) {
    scene.updateItem(ctxMenu.value.itemId, { layerId })
    selection.setActiveLayer(layerId)
  }
  closeCtxMenu()
}

function closeCtxMenu() {
  ctxMenu.value = null
}

function onDragEnd(item: SceneItem, e: any) {
  const node = e.target
  scene.updateItem(item.id, { x: Math.round(node.x()), y: Math.round(node.y()) })
}

function onTransformEnd(item: SceneItem, e: any) {
  const node = e.target
  const scaleX = node.scaleX()
  const scaleY = node.scaleY()
  node.scaleX(1)
  node.scaleY(1)
  scene.updateItem(item.id, {
    x: Math.round(node.x()),
    y: Math.round(node.y()),
    width: Math.max(8, Math.round(item.width * scaleX)),
    height: Math.max(8, Math.round(item.height * scaleY)),
    rotation: Math.round(node.rotation())
  })
}

// ---- drop from catalog ----
function onDrop(e: DragEvent) {
  e.preventDefault()
  const raw = e.dataTransfer?.getData('application/x-stocka-piece')
  if (!raw) return
  const pieceId = Number(raw)
  // A piece can only be placed on the board once.
  if (scene.items.some(i => i.pieceId === pieceId)) { flashHint('Este artículo ya está en el tablero.'); return }
  // Items can only be added when a layer is selected; they land on that layer.
  const layerId = selection.activeLayerId
  if (!layerId) { flashHint('Selecciona una capa para añadir artículos.'); return }
  const rect = wrapperRef.value?.getBoundingClientRect()
  if (!rect) return
  const x = Math.round((e.clientX - rect.left - view.x) / view.scale)
  const y = Math.round((e.clientY - rect.top - view.y) / view.scale)
  const item = scene.addItem(pieceId, layerId, { x, y })
  selection.selectItem(item.id)
  catalog.ensureActionsForPiece(catalog.pieceById(pieceId))
}

// Brief hint banner shown when a drop is rejected (no active layer / already placed).
const hintText = ref<string | null>(null)
let hintTimer: ReturnType<typeof setTimeout> | null = null
function flashHint(msg: string) {
  hintText.value = msg
  if (hintTimer) clearTimeout(hintTimer)
  hintTimer = setTimeout(() => { hintText.value = null }, 2500)
}
onBeforeUnmount(() => { if (hintTimer) clearTimeout(hintTimer) })
</script>

<template>
  <div
    ref="wrapperRef"
    class="relative min-h-0 flex-1 overflow-hidden cursor-grab"
    @dragover.prevent
    @drop="onDrop">
    <v-stage
      ref="stageRef"
      :config="stageConfig"
      @wheel="onWheel"
      @click="onStageClick"
      @tap="onStageClick"
      @contextmenu="onStageContextMenu"
      @dragmove="syncViewFromStage"
      @dragend="syncViewFromStage">
      <!-- Board background (always a rectangle) -->
      <v-layer>
        <v-rect :config="{ x: 0, y: 0, width: scene.board.width, height: scene.board.height, fill: '#ffffff', stroke: '#d4ccba', strokeWidth: 1 }" />
      </v-layer>

      <!-- One Konva layer per scene layer, in z order -->
      <v-layer
        v-for="layer in scene.layersByZ"
        :key="layer.id"
        :config="{ visible: layer.visible, opacity: layer.opacity, listening: !layer.locked }">
        <v-group
          v-for="item in itemsOfLayer(layer)"
          :key="item.id"
          :config="{ id: 'item-' + item.id, x: item.x, y: item.y, rotation: item.rotation, draggable: !layer.locked }"
          @click="onItemClick(item, $event)"
          @tap="onItemClick(item, $event)"
          @contextmenu="onItemContextMenu(item, $event)"
          @mouseenter="setItemCursor(true)"
          @mouseleave="setItemCursor(false)"
          @dragend="onDragEnd(item, $event)"
          @transformend="onTransformEnd(item, $event)">
          <v-image
            v-if="images[item.id]"
            :config="{ image: images[item.id], width: item.width, height: item.height }" />
          <v-rect
            v-else
            :config="{ width: item.width, height: item.height, fill: '#efe9dc', stroke: '#d4ccba', strokeWidth: 1, cornerRadius: 6 }" />
          <v-text
            :config="{ text: pieceName(item), width: item.width, padding: 4, fontSize: 12, fill: '#2a2722', ellipsis: true, wrap: 'none' }" />
          <v-rect
            v-if="isSelected(item)"
            :config="{ width: item.width, height: item.height, stroke: '#3b6cb4', strokeWidth: 2, dash: [6, 4], cornerRadius: 6, listening: false }" />
          <v-rect
            v-if="playback.activeItemIds.has(item.id)"
            :config="{ width: item.width, height: item.height, stroke: '#6b8068', strokeWidth: 3, cornerRadius: 6, listening: false }" />
        </v-group>
      </v-layer>

      <!-- Transformer overlay -->
      <v-layer>
        <v-transformer ref="transformerRef" :config="{ rotateEnabled: true, keepRatio: false }" />
      </v-layer>
    </v-stage>

    <div class="pointer-events-none absolute bottom-2 left-2 rounded bg-bg-card/80 px-2 py-1 text-[11px] text-ink-muted">
      {{ scene.pxToCm(scene.board.width).toFixed(0) }} × {{ scene.pxToCm(scene.board.height).toFixed(0) }} cm ·
      zoom {{ Math.round(view.scale * 100) }}%
    </div>

    <!-- Hint shown when a drop is rejected (no active layer / already placed) -->
    <div
      v-if="hintText"
      class="pointer-events-none absolute left-1/2 top-3 -translate-x-1/2 rounded-[8px] bg-danger px-3 py-1.5 text-[12px] text-white shadow-lg">
      {{ hintText }}
    </div>

    <!-- Right-click menu: move the item to another layer -->
    <template v-if="ctxMenu">
      <div class="absolute inset-0 z-10" @click="closeCtxMenu" @contextmenu.prevent="closeCtxMenu" />
      <div
        class="absolute z-20 min-w-[170px] rounded-[8px] border border-line bg-bg-card py-1 shadow-lg"
        :style="{ left: ctxMenu.x + 'px', top: ctxMenu.y + 'px' }">
        <div class="px-3 py-1 text-[11px] uppercase tracking-[.06em] text-ink-muted">Mover a capa</div>
        <button
          v-for="layer in layersTopFirst"
          :key="layer.id"
          type="button"
          class="flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-bg-soft"
          @click="moveItemToLayer(layer.id)">
          <span class="truncate">{{ layer.name }}</span>
          <span v-if="scene.itemById(ctxMenu.itemId)?.layerId === layer.id" class="text-accent">✓</span>
        </button>
      </div>
    </template>
  </div>
</template>
