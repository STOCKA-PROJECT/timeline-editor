import { defineStore } from 'pinia'

/** Tracks the currently selected board item(s) / timeline clip / selected layer(s). */
export const useSelectionStore = defineStore('selection', () => {
  // Board selection supports multiple items (e.g. selecting a whole layer); the timeline
  // inspector still works on a single item, so {@link selectedItemId} resolves to the lone
  // selection (null when zero or many are selected).
  const selectedItemIds = ref<string[]>([])
  const selectedClipId = ref<string | null>(null)
  // Layers can be multi-selected (Ctrl/Cmd or Shift + click in the layers panel): the timeline
  // shows only their tracks. The last one selected is the "active" layer new items land on.
  const selectedLayerIds = ref<string[]>([])

  const selectedItemId = computed(() => (selectedItemIds.value.length === 1 ? selectedItemIds.value[0]! : null))
  const activeLayerId = computed(() =>
    selectedLayerIds.value.length ? selectedLayerIds.value[selectedLayerIds.value.length - 1]! : null)

  /** Adds the layer of a board item to the selection so its track is visible in the timeline. */
  function revealLayerOf(itemId: string | null | undefined) {
    if (!itemId) return
    const layerId = useSceneStore().itemById(itemId)?.layerId
    if (layerId && !selectedLayerIds.value.includes(layerId)) {
      selectedLayerIds.value = [...selectedLayerIds.value, layerId]
    }
  }

  function selectItem(id: string | null) {
    selectedItemIds.value = id ? [id] : []
    if (id) {
      selectedClipId.value = null
      revealLayerOf(id)
    }
  }

  /** Replaces the board selection with the given items (used when a layer is activated). */
  function selectItems(ids: string[]) {
    selectedItemIds.value = [...ids]
    if (ids.length) selectedClipId.value = null
  }

  function selectClip(id: string | null) {
    selectedClipId.value = id
    if (id) {
      // Selecting a clip also selects the board item (piece) it belongs to.
      const scene = useSceneStore()
      const track = scene.trackById(scene.clipById(id)?.trackId ?? '')
      selectedItemIds.value = track ? [track.itemId] : []
      revealLayerOf(track?.itemId)
    }
  }

  /** Selects a single layer, replacing the layer selection (null clears it). */
  function setActiveLayer(id: string | null) {
    selectedLayerIds.value = id ? [id] : []
  }

  /** Adds the layer to the selection or removes it when already selected (multi-select). */
  function toggleLayer(id: string) {
    selectedLayerIds.value = selectedLayerIds.value.includes(id)
      ? selectedLayerIds.value.filter(l => l !== id)
      : [...selectedLayerIds.value, id]
  }

  function isLayerSelected(id: string): boolean {
    return selectedLayerIds.value.includes(id)
  }

  /** Forgets a layer that no longer exists in the scene. */
  function dropLayer(id: string) {
    selectedLayerIds.value = selectedLayerIds.value.filter(l => l !== id)
  }

  // ----- drawing the LED path of an item on the board -----
  /** Item whose LED path is being drawn: each click on the board adds a point to it. */
  const drawingLedPathFor = ref<string | null>(null)

  function startLedPath(itemId: string) {
    drawingLedPathFor.value = itemId
  }

  /** Ends the drawing; a path with fewer than two points goes back to the default one. */
  function stopLedPath() {
    const scene = useSceneStore()
    const item = drawingLedPathFor.value ? scene.itemById(drawingLedPathFor.value) : undefined
    if (item && (item.ledPath?.length ?? 0) < 2) scene.updateItem(item.id, { ledPath: null })
    drawingLedPathFor.value = null
  }

  // Selecting something else ends the drawing.
  watch(selectedItemId, (id) => {
    if (drawingLedPathFor.value && id !== drawingLedPathFor.value) stopLedPath()
  })

  function reset() {
    selectedItemIds.value = []
    selectedClipId.value = null
    selectedLayerIds.value = []
    drawingLedPathFor.value = null
  }

  return {
    selectedItemId,
    selectedItemIds,
    selectedClipId,
    selectedLayerIds,
    activeLayerId,
    selectItem,
    selectItems,
    selectClip,
    setActiveLayer,
    toggleLayer,
    isLayerSelected,
    dropLayer,
    drawingLedPathFor,
    startLedPath,
    stopLedPath,
    reset
  }
})
