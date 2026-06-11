import { defineStore } from 'pinia'
import type { TimelineResponseDto, TimelineSceneResponseDto } from '~/types/api'
import {
  DEFAULT_ITEM_SIZE_CM,
  PX_PER_CM,
  emptyDocument,
  SCENE_SCHEMA_VERSION,
  type BoardConfig,
  type SceneClip,
  type SceneDocument,
  type SceneItem,
  type SceneLayer,
  type SceneTrack
} from '~/types/editor'
import { nextId } from '~/utils/ids'

const DEFAULT_CLIP_MS = 2000

/**
 * Holds the live, editable scene document and persists it to the backend. Mutations bump
 * {@link dirtyRevision}; the autosave composable watches it and debounces a {@link save}.
 */
export const useSceneStore = defineStore('scene', () => {
  const orgSlug = ref<string | null>(null)
  const timelineId = ref<number | null>(null)
  const timelineName = ref<string>('')

  const board = ref<BoardConfig>(emptyDocument().board)
  const layers = ref<SceneLayer[]>([])
  const items = ref<SceneItem[]>([])
  const tracks = ref<SceneTrack[]>([])
  const clips = ref<SceneClip[]>([])
  const durationMs = ref(60000)
  const fps = ref(30)

  const version = ref<number | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const dirty = ref(false)
  const dirtyRevision = ref(0)
  const lastSavedAt = ref<number | null>(null)
  const error = ref<string | null>(null)
  const conflict = ref(false)

  // ----- undo/redo history -----
  /** Maximum number of undo steps. Kept snapshots = current state + up to this many previous ones. */
  const MAX_UNDO_STEPS = 20
  const history = ref<string[]>([])
  const historyIndex = ref(-1)
  // While restoring a snapshot we must not record it as a new history step.
  let restoring = false
  // Coalesces the many mutations of a single user action into one history step.
  let captureScheduled = false

  // ----- px <-> cm conversion (fixed relationship; the UI works in cm) -----
  /** Converts centimetres to board pixels (rounded). */
  const cmToPx = (cm: number) => Math.round(cm * PX_PER_CM)
  /** Converts board pixels to centimetres (not rounded). */
  const pxToCm = (px: number) => px / PX_PER_CM

  // ----- derived -----
  const layersByZ = computed(() => [...layers.value].sort((a, b) => a.z - b.z))
  const itemById = (id: string) => items.value.find(i => i.id === id)
  const layerById = (id: string) => layers.value.find(l => l.id === id)
  const trackById = (id: string) => tracks.value.find(t => t.id === id)
  const clipById = (id: string) => clips.value.find(c => c.id === id)
  const clipsForTrack = (trackId: string) => clips.value.filter(c => c.trackId === trackId)

  function buildDocument(): SceneDocument {
    return {
      schemaVersion: SCENE_SCHEMA_VERSION,
      board: board.value,
      layers: layers.value,
      items: items.value,
      tracks: tracks.value,
      clips: clips.value,
      durationMs: durationMs.value,
      fps: fps.value
    }
  }

  function applyDocument(doc: SceneDocument) {
    const base = emptyDocument()
    board.value = { ...base.board, ...(doc.board ?? {}) }
    layers.value = doc.layers?.length ? doc.layers : base.layers
    items.value = doc.items ?? []
    tracks.value = doc.tracks ?? []
    clips.value = doc.clips ?? []
    durationMs.value = doc.durationMs ?? base.durationMs
    fps.value = doc.fps ?? base.fps ?? 30
  }

  function touch() {
    dirty.value = true
    dirtyRevision.value++
    scheduleCapture()
  }

  // ----- history (undo/redo) -----
  const canUndo = computed(() => historyIndex.value > 0)
  const canRedo = computed(() => historyIndex.value >= 0 && historyIndex.value < history.value.length - 1)

  /** Serialized snapshot of the current document. */
  function snapshot(): string {
    return JSON.stringify(buildDocument())
  }

  /** Records the current document as a new history step (capped at {@link MAX_UNDO_STEPS}). */
  function captureHistory() {
    const snap = snapshot()
    if (history.value[historyIndex.value] === snap) return // nothing actually changed
    // Drop any redo branch, append the new step, then keep the current state + MAX_UNDO_STEPS previous.
    const next = history.value.slice(0, historyIndex.value + 1)
    next.push(snap)
    while (next.length > MAX_UNDO_STEPS + 1) next.shift()
    history.value = next
    historyIndex.value = next.length - 1
  }

  /** Schedules a single history capture after the current synchronous mutation(s) settle. */
  function scheduleCapture() {
    if (restoring || captureScheduled) return
    captureScheduled = true
    queueMicrotask(() => {
      captureScheduled = false
      captureHistory()
    })
  }

  /** Resets history to a single baseline step = the current document (used after load/reset). */
  function resetHistory() {
    history.value = [snapshot()]
    historyIndex.value = 0
  }

  /** Applies the snapshot at the current index and persists it like any other edit. */
  function restoreCurrent() {
    const snap = history.value[historyIndex.value]
    if (snap == null) return
    restoring = true
    applyDocument(JSON.parse(snap) as SceneDocument)
    restoring = false
    // Mark dirty + bump the revision so autosave persists the restored state (without re-capturing).
    dirty.value = true
    dirtyRevision.value++
  }

  function undo() {
    if (!canUndo.value) return
    historyIndex.value--
    restoreCurrent()
  }

  function redo() {
    if (!canRedo.value) return
    historyIndex.value++
    restoreCurrent()
  }

  // ----- load / save -----
  async function load(slug: string, tid: number) {
    orgSlug.value = slug
    timelineId.value = tid
    loading.value = true
    error.value = null
    conflict.value = false
    try {
      const api = useApi()
      // Timeline metadata (its name titles the editor) + the scene document.
      const [timeline, res] = await Promise.all([
        api<TimelineResponseDto>(`/organizations/${slug}/timelines/${tid}`).catch(() => null),
        api<TimelineSceneResponseDto | undefined>(`/organizations/${slug}/timelines/${tid}/scene`)
      ])
      timelineName.value = timeline?.name ?? ''
      if (res && res.document) {
        applyDocument(res.document as SceneDocument)
        version.value = res.version
      } else {
        applyDocument(emptyDocument())
        version.value = null
      }
      dirty.value = false
      resetHistory()
    } finally {
      loading.value = false
    }
  }

  async function save(opts?: { keepalive?: boolean }) {
    if (!orgSlug.value || timelineId.value == null) return
    saving.value = true
    error.value = null
    try {
      const api = useApi()
      const res = await api<TimelineSceneResponseDto>(
        `/organizations/${orgSlug.value}/timelines/${timelineId.value}/scene`,
        {
          method: 'PUT',
          // `keepalive` lets the request outlive a page unload/reload, so the last edit is not lost.
          keepalive: opts?.keepalive,
          body: { schemaVersion: SCENE_SCHEMA_VERSION, document: buildDocument(), version: version.value }
        }
      )
      version.value = res.version
      dirty.value = false
      lastSavedAt.value = Date.now()
      conflict.value = false
    } catch (e) {
      const code = (e as { response?: { _data?: { code?: string } } }).response?._data?.code
      if (code === 'timeline_scenes.version_conflict') {
        conflict.value = true
        error.value = 'La escena se modificó en otra sesión. Recarga para continuar.'
      } else {
        error.value = 'No se ha podido guardar la escena.'
      }
      throw e
    } finally {
      saving.value = false
    }
  }

  // ----- board -----
  function setBoard(partial: Partial<BoardConfig>) {
    board.value = { ...board.value, ...partial }
    touch()
  }

  // ----- timeline duration ("Fin") -----
  function setDurationMs(ms: number) {
    durationMs.value = Math.max(1000, Math.round(ms))
    touch()
  }

  // ----- layers -----
  function addLayer(): SceneLayer {
    const z = layers.value.length ? Math.max(...layers.value.map(l => l.z)) + 1 : 0
    const layer: SceneLayer = {
      id: nextId('layer'),
      name: `Capa ${layers.value.length + 1}`,
      z,
      visible: true,
      locked: false,
      opacity: 1
    }
    layers.value = [...layers.value, layer]
    touch()
    return layer
  }

  function updateLayer(id: string, partial: Partial<SceneLayer>) {
    layers.value = layers.value.map(l => (l.id === id ? { ...l, ...partial } : l))
    touch()
  }

  function removeLayer(id: string) {
    if (layers.value.length <= 1) return
    const removedItemIds = items.value.filter(i => i.layerId === id).map(i => i.id)
    layers.value = layers.value.filter(l => l.id !== id)
    removedItemIds.forEach(removeItem)
    touch()
  }

  function moveLayer(id: string, dir: -1 | 1) {
    const ordered = layersByZ.value
    const idx = ordered.findIndex(l => l.id === id)
    const swapIdx = idx + dir
    if (idx < 0 || swapIdx < 0 || swapIdx >= ordered.length) return
    const a = ordered[idx]!
    const b = ordered[swapIdx]!
    const az = a.z
    updateLayer(a.id, { z: b.z })
    updateLayer(b.id, { z: az })
  }

  // ----- items -----
  function addItem(pieceId: number, layerId?: string, pos?: { x: number, y: number }): SceneItem {
    const targetLayer = layerId ?? layersByZ.value[layersByZ.value.length - 1]?.id ?? addLayer().id
    // New items default to a physical 10×10 cm, converted to pixels via the board scale.
    const size = cmToPx(DEFAULT_ITEM_SIZE_CM)
    const item: SceneItem = {
      id: nextId('item'),
      pieceId,
      layerId: targetLayer,
      x: pos?.x ?? Math.round(board.value.width / 2 - size / 2),
      y: pos?.y ?? Math.round(board.value.height / 2 - size / 2),
      width: size,
      height: size,
      rotation: 0
    }
    items.value = [...items.value, item]
    ensureTrackForItem(item.id)
    touch()
    return item
  }

  function updateItem(id: string, partial: Partial<SceneItem>) {
    items.value = items.value.map(i => (i.id === id ? { ...i, ...partial } : i))
    touch()
  }

  function removeItem(id: string) {
    const trackIds = tracks.value.filter(t => t.itemId === id).map(t => t.id)
    items.value = items.value.filter(i => i.id !== id)
    tracks.value = tracks.value.filter(t => t.itemId !== id)
    clips.value = clips.value.filter(c => !trackIds.includes(c.trackId))
    touch()
  }

  // ----- tracks -----
  function ensureTrackForItem(itemId: string): SceneTrack {
    const existing = tracks.value.find(t => t.itemId === itemId)
    if (existing) return existing
    const item = itemById(itemId)
    const track: SceneTrack = {
      id: nextId('track'),
      itemId,
      name: item ? `Artículo ${item.pieceId}` : 'Pista'
    }
    tracks.value = [...tracks.value, track]
    touch()
    return track
  }

  // ----- clips -----
  function addClip(trackId: string, actionId: number | null, startMs: number): SceneClip {
    const clip: SceneClip = {
      id: nextId('clip'),
      trackId,
      pieceTypeActionId: actionId,
      startMs: Math.max(0, Math.round(startMs)),
      durationMs: DEFAULT_CLIP_MS,
      paramValues: {}
    }
    clips.value = [...clips.value, clip]
    touch()
    return clip
  }

  function updateClip(id: string, partial: Partial<SceneClip>) {
    clips.value = clips.value.map(c => (c.id === id ? { ...c, ...partial } : c))
    touch()
  }

  function removeClip(id: string) {
    clips.value = clips.value.filter(c => c.id !== id)
    touch()
  }

  function reset() {
    applyDocument(emptyDocument())
    version.value = null
    dirty.value = false
    error.value = null
    conflict.value = false
    resetHistory()
  }

  return {
    orgSlug,
    timelineId,
    timelineName,
    board,
    layers,
    items,
    tracks,
    clips,
    durationMs,
    fps,
    version,
    loading,
    saving,
    dirty,
    dirtyRevision,
    lastSavedAt,
    error,
    conflict,
    canUndo,
    canRedo,
    undo,
    redo,
    cmToPx,
    pxToCm,
    layersByZ,
    itemById,
    layerById,
    trackById,
    clipById,
    clipsForTrack,
    buildDocument,
    load,
    save,
    setBoard,
    setDurationMs,
    addLayer,
    updateLayer,
    removeLayer,
    moveLayer,
    addItem,
    updateItem,
    removeItem,
    ensureTrackForItem,
    addClip,
    updateClip,
    removeClip,
    reset
  }
})
