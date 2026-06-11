import { defineStore } from 'pinia'

/** Tracks the currently selected board item(s) / timeline clip / active layer. */
export const useSelectionStore = defineStore('selection', () => {
  // Board selection supports multiple items (e.g. selecting a whole layer); the timeline
  // inspector still works on a single item, so {@link selectedItemId} resolves to the lone
  // selection (null when zero or many are selected).
  const selectedItemIds = ref<string[]>([])
  const selectedClipId = ref<string | null>(null)
  const activeLayerId = ref<string | null>(null)

  const selectedItemId = computed(() => (selectedItemIds.value.length === 1 ? selectedItemIds.value[0]! : null))

  function selectItem(id: string | null) {
    selectedItemIds.value = id ? [id] : []
    if (id) selectedClipId.value = null
  }

  /** Replaces the board selection with the given items (used when a layer is activated). */
  function selectItems(ids: string[]) {
    selectedItemIds.value = [...ids]
    if (ids.length) selectedClipId.value = null
  }

  function selectClip(id: string | null) {
    selectedClipId.value = id
    if (id) selectedItemIds.value = []
  }

  function setActiveLayer(id: string | null) {
    activeLayerId.value = id
  }

  function reset() {
    selectedItemIds.value = []
    selectedClipId.value = null
    activeLayerId.value = null
  }

  return {
    selectedItemId,
    selectedItemIds,
    selectedClipId,
    activeLayerId,
    selectItem,
    selectItems,
    selectClip,
    setActiveLayer,
    reset
  }
})
