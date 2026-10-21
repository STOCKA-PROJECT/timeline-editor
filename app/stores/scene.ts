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
import { cachedRequest } from '~/utils/offline/cachedRequest'
import type { KvStore } from '~/utils/offline/kvStore'
import {
  openScene,
  rebaseEdits,
  resolveSceneConflict,
  saveLocal,
  saveScene,
  VersionConflictError,
  type SaveOutcome,
  type SceneContext
} from '~/utils/offline/sceneSync'
import type { MergeResult, MergeSide } from '~/utils/sceneMerge'
import { orderItems } from '~/utils/stripLayout'

/** Delay before an edit is also written to the laptop's copy (the server save waits longer). */
const LOCAL_WRITE_DELAY_MS = 300

export const DEFAULT_CLIP_MS = 2000

/**
 * Holds the live, editable scene document and persists it: every edit goes to the laptop's copy
 * (IndexedDB) right away and to the backend through the debounced autosave. Without a connection the
 * edits wait locally ({@link offline}) and go up when it comes back; if another session saved
 * meanwhile the two editions are merged, and clashes wait in {@link pendingMerge} for the user.
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
  const stripOrder = ref<Record<string, string[]>>({})

  const version = ref<number | null>(null)
  const loading = ref(false)
  const saving = ref(false)
  const dirty = ref(false)
  const dirtyRevision = ref(0)
  const lastSavedAt = ref<number | null>(null)
  const error = ref<string | null>(null)
  const conflict = ref(false)
  /** The last attempt to reach the server failed: edits are kept on the laptop. */
  const offline = ref(false)
  /** The open document came from the laptop's copy (the server could not be reached on load). */
  const openedOffline = ref(false)
  /** Clashing edits that need the user's choice before saving. */
  const pendingMerge = ref<{ merge: MergeResult, remoteVersion: number | null } | null>(null)
  /** One-line information for the toolbar (an automatic merge happened…). */
  const notice = ref<string | null>(null)

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
      fps: fps.value,
      stripOrder: stripOrder.value
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
    stripOrder.value = doc.stripOrder ?? {}
  }

  function touch() {
    dirty.value = true
    dirtyRevision.value++
    scheduleCapture()
    persistLocalSoon()
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
    persistLocalSoon()
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
  function syncContext(kv: KvStore): SceneContext {
    const slug = orgSlug.value!
    const tid = timelineId.value!
    const path = `/organizations/${slug}/timelines/${tid}/scene`
    return {
      kv,
      orgSlug: slug,
      timelineId: tid,
      timelineName: timelineName.value,
      server: {
        async fetch() {
          const res = await useApi()<TimelineSceneResponseDto | undefined>(path)
          return res && res.document ? { document: res.document as SceneDocument, version: res.version } : { document: null, version: res?.version ?? null }
        },
        async put(document, v) {
          try {
            const res = await useApi()<TimelineSceneResponseDto>(path, {
              method: 'PUT',
              keepalive: keepaliveNext,
              body: { schemaVersion: SCENE_SCHEMA_VERSION, document, version: v }
            })
            return res.version
          } catch (e) {
            const code = (e as { response?: { _data?: { code?: string } } }).response?._data?.code
            if (code === 'timeline_scenes.version_conflict') throw new VersionConflictError()
            throw e
          }
        }
      }
    }
  }

  async function withContext(): Promise<SceneContext> {
    return syncContext(await useOfflineDb())
  }

  let keepaliveNext = false
  let localTimer: ReturnType<typeof setTimeout> | null = null

  /** Writes the current document to the laptop's copy soon (coalesces bursts of edits). */
  function persistLocalSoon() {
    if (!orgSlug.value || timelineId.value == null || loading.value) return
    if (localTimer) clearTimeout(localTimer)
    localTimer = setTimeout(() => {
      localTimer = null
      void persistLocalNow()
    }, LOCAL_WRITE_DELAY_MS)
  }

  async function persistLocalNow() {
    if (!orgSlug.value || timelineId.value == null || !dirty.value) return
    try {
      await saveLocal(await withContext(), buildDocument(), version.value)
    } catch (e) {
      console.warn('No s’ha pogut desar la còpia local', e)
    }
  }

  async function load(slug: string, tid: number) {
    orgSlug.value = slug
    timelineId.value = tid
    loading.value = true
    error.value = null
    conflict.value = false
    pendingMerge.value = null
    notice.value = null
    try {
      const connectivity = useConnectivityStore()
      const kv = await useOfflineDb()
      // Timeline metadata (its name titles the editor), from the local copy when offline.
      const timeline = await cachedRequest(kv, `/organizations/${slug}/timelines/${tid}`,
        () => useApi()<TimelineResponseDto>(`/organizations/${slug}/timelines/${tid}`)).then(r => r.data).catch(() => null)
      timelineName.value = timeline?.name ?? ''
      const opened = await openScene(await withContext())
      applyDocument(opened.document)
      version.value = opened.version
      openedOffline.value = opened.offline
      offline.value = opened.offline
      if (opened.offline) connectivity.reportUnreachable()
      else connectivity.reportNetwork()
      dirty.value = opened.pending
      if (opened.merge) {
        pendingMerge.value = { merge: opened.merge, remoteVersion: opened.remoteVersion ?? null }
        conflict.value = true
      }
      if (opened.merged) notice.value = 'S’han fusionat els canvis fets sense connexió amb els d’una altra sessió.'
      resetHistory()
    } finally {
      loading.value = false
    }
    // Edits made offline go up as soon as the editor opens with a connection.
    if (dirty.value && !offline.value && !conflict.value) save().catch(() => { /* surfaced via error */ })
  }

  async function save(opts?: { keepalive?: boolean }) {
    if (!orgSlug.value || timelineId.value == null || conflict.value) return
    if (saving.value) return
    saving.value = true
    error.value = null
    keepaliveNext = !!opts?.keepalive
    const sent = buildDocument()
    const revision = dirtyRevision.value
    const connectivity = useConnectivityStore()
    try {
      const outcome = await saveScene(await withContext(), sent, version.value)
      applyOutcome(outcome, sent, revision)
      if (outcome.status === 'offline') connectivity.reportUnreachable()
      else connectivity.reportNetwork()
    } catch (e) {
      error.value = 'No s’ha pogut desar la escena.'
      throw e
    } finally {
      saving.value = false
      keepaliveNext = false
    }
  }

  /** Brings the editor in line with what a save achieved (edits made during it are kept). */
  function applyOutcome(outcome: SaveOutcome, sent: SceneDocument, revision: number) {
    const editedMeanwhile = dirtyRevision.value !== revision
    switch (outcome.status) {
      case 'saved':
        version.value = outcome.version
        dirty.value = editedMeanwhile
        offline.value = false
        lastSavedAt.value = Date.now()
        break
      case 'merged': {
        version.value = outcome.version
        offline.value = false
        lastSavedAt.value = Date.now()
        const doc = editedMeanwhile ? rebaseEdits(sent, buildDocument(), outcome.document) : outcome.document
        restoring = true
        applyDocument(doc)
        restoring = false
        captureHistory()
        dirty.value = editedMeanwhile
        notice.value = 'S’han fusionat els teus canvis amb els d’una altra sessió.'
        break
      }
      case 'offline':
        offline.value = true
        dirty.value = true
        break
      case 'conflict':
        pendingMerge.value = { merge: outcome.merge, remoteVersion: outcome.remoteVersion }
        conflict.value = true
        break
    }
  }

  /** Saves the user's choices for a clashing merge (works offline too: it then waits locally). */
  async function resolveMerge(choices: Record<string, MergeSide>) {
    const pending = pendingMerge.value
    if (!pending) return
    saving.value = true
    error.value = null
    try {
      const { outcome, document } = await resolveSceneConflict(await withContext(), pending.merge, pending.remoteVersion, choices)
      restoring = true
      applyDocument(document)
      restoring = false
      captureHistory()
      pendingMerge.value = null
      conflict.value = false
      if (outcome.status === 'merged' || outcome.status === 'saved') {
        version.value = outcome.version
        dirty.value = false
        offline.value = false
        lastSavedAt.value = Date.now()
      } else {
        // Offline: the resolution is kept on the laptop, on top of the server's edition.
        version.value = pending.remoteVersion
        dirty.value = true
        offline.value = true
      }
    } catch (e) {
      error.value = 'No s’ha pogut desar la resolució del conflicte.'
      throw e
    } finally {
      saving.value = false
    }
  }

  function dismissNotice() {
    notice.value = null
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
  function addItem(
    pieceId: number,
    layerId?: string,
    pos?: { x: number, y: number },
    opts?: { withTrack?: boolean }
  ): SceneItem {
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
    // Pieces without available actions get no timeline track.
    if (opts?.withTrack !== false) ensureTrackForItem(item.id)
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
    stripOrder.value = Object.fromEntries(Object.entries(stripOrder.value).map(([port, ids]) => [port, ids.filter(i => i !== id)]))
    touch()
  }

  // ----- pieces along a LED strip -----
  /** Items assigned to a port, in strip order (first LED first). */
  function itemsOnPort(portId: number): SceneItem[] {
    const assigned = items.value.filter(i => (i.ports ?? []).includes(portId))
    const ordered = orderItems(assigned.map(i => i.id), stripOrder.value[String(portId)])
    return ordered.map(id => assigned.find(i => i.id === id)!)
  }

  /** Moves an item one place earlier (-1) or later (+1) along the strip of a port. */
  function moveItemOnPort(portId: number, itemId: string, dir: -1 | 1) {
    const ids = itemsOnPort(portId).map(i => i.id)
    const idx = ids.indexOf(itemId)
    const target = idx + dir
    if (idx < 0 || target < 0 || target >= ids.length) return
    ;[ids[idx], ids[target]] = [ids[target]!, ids[idx]!]
    stripOrder.value = { ...stripOrder.value, [String(portId)]: ids }
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
  function addClip(trackId: string, actionId: number | null, startMs: number, durationMs: number = DEFAULT_CLIP_MS): SceneClip {
    const clip: SceneClip = {
      id: nextId('clip'),
      trackId,
      pieceTypeActionId: actionId,
      startMs: Math.max(0, Math.round(startMs)),
      durationMs: Math.max(1, Math.round(durationMs)),
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

  /**
   * Replaces the whole document with an imported one. Goes through {@link touch} so the
   * import is undoable and gets persisted by the autosave like any other edit.
   */
  function importDocument(doc: SceneDocument) {
    applyDocument(doc)
    touch()
  }

  function reset() {
    applyDocument(emptyDocument())
    version.value = null
    dirty.value = false
    error.value = null
    conflict.value = false
    offline.value = false
    openedOffline.value = false
    pendingMerge.value = null
    notice.value = null
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
    stripOrder,
    version,
    loading,
    saving,
    dirty,
    dirtyRevision,
    lastSavedAt,
    error,
    conflict,
    offline,
    openedOffline,
    pendingMerge,
    notice,
    resolveMerge,
    dismissNotice,
    persistLocalNow,
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
    importDocument,
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
    itemsOnPort,
    moveItemOnPort,
    ensureTrackForItem,
    addClip,
    updateClip,
    removeClip,
    reset
  }
})
