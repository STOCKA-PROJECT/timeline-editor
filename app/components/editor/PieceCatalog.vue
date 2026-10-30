<script setup lang="ts">
import type { PieceListItemDto, PieceStatus } from '~/types/api'
import {
  EMPTY_PIECE_QUERY,
  advancedFilterCount,
  filterLocally,
  filterServerResults,
  hasActiveFilters,
  isHardwareFilter,
  locationOptions,
  needsServer,
  queryKey,
  typesLabel,
  usesHardware,
  type HardwareFilter,
  type PieceQuery
} from '~/utils/pieceFilters'

// The piece palette: what can be dragged to the board. A text box (ranked by the server, through
// the semantic index when the organization has one), a hardware switch (pieces the Raspberry Pi
// animates, the rest, or all) and a fold-out with the advanced filters (type, location, status).
// Structural filters resolve on the laptop; text and location ask the server, falling back to a
// name match on the local list without a connection.

const catalog = useCatalogStore()
const scene = useSceneStore()
const selection = useSelectionStore()
const connectivity = useConnectivityStore()

const HARDWARE_KEY = 'tle:catalog:hardware'
const SEARCH_DEBOUNCE_MS = 300

const HARDWARE_OPTIONS: ReadonlyArray<{ value: HardwareFilter, label: string, title: string }> = [
  { value: 'rpi', label: 'Amb RPi', title: 'Articles el tipus dels quals controla una sortida de la Raspberry Pi (relés, llums, motors, àudio…)' },
  { value: 'none', label: 'Sense RPi', title: 'Articles que no es connecten a res: figures, construccions, decorat' },
  { value: 'all', label: 'Tots', title: 'Tots els articles de l’organització' }
]

// ---- query ----
const query = reactive<PieceQuery>({ ...EMPTY_PIECE_QUERY, typeIds: [] })

onMounted(() => {
  try {
    const saved = localStorage.getItem(HARDWARE_KEY)
    if (isHardwareFilter(saved)) query.hardware = saved
  } catch { /* private mode: keep the default */ }
})

function setHardware(value: HardwareFilter) {
  query.hardware = value
  try { localStorage.setItem(HARDWARE_KEY, value) } catch { /* ignore */ }
}

// Organizations without hardware pieces do not get the switch: everything is shown.
const hardwareFilterVisible = computed(() => catalog.hardwareAvailable)
const effectiveQuery = computed<PieceQuery>(() => ({
  q: query.q,
  hardware: hardwareFilterVisible.value ? query.hardware : 'all',
  typeIds: [...query.typeIds],
  locationId: query.locationId,
  status: query.status
}))

// The text box applies after a short pause, so the server is not asked for every keystroke.
const qInput = ref('')
let qTimer: ReturnType<typeof setTimeout> | null = null
watch(qInput, (value) => {
  if (qTimer) clearTimeout(qTimer)
  qTimer = setTimeout(() => { query.q = value }, SEARCH_DEBOUNCE_MS)
})
function clearText() {
  if (qTimer) clearTimeout(qTimer)
  qInput.value = ''
  query.q = ''
}
onBeforeUnmount(() => { if (qTimer) clearTimeout(qTimer) })

// ---- server search ----
const serverResults = ref<PieceListItemDto[] | null>(null)
const searching = ref(false)
/** Why the local list is shown although the query wanted the server. */
const fallback = ref<'offline' | 'failed' | null>(null)
let activeKey = ''

async function runSearch(key: string) {
  const q = effectiveQuery.value
  activeKey = key
  if (!needsServer(q)) {
    serverResults.value = null
    fallback.value = null
    searching.value = false
    return
  }
  searching.value = true
  try {
    const list = await catalog.searchPieces(q)
    if (activeKey !== key) return
    serverResults.value = list
    fallback.value = null
  } catch {
    if (activeKey !== key) return
    serverResults.value = null
    fallback.value = connectivity.online ? 'failed' : 'offline'
  } finally {
    if (activeKey === key) searching.value = false
  }
}

watch(() => queryKey(effectiveQuery.value), key => { void runSearch(key) })
// Back online: the pending query gets its real answer.
watch(() => connectivity.online, (online) => {
  if (online && fallback.value) void runSearch(queryKey(effectiveQuery.value))
})

const fallbackMessage = computed(() => {
  if (!fallback.value) return null
  const location = effectiveQuery.value.locationId != null ? ' La ubicació no s’aplica.' : ''
  return fallback.value === 'offline'
    ? `Sense connexió: només es cerca pel nom entre els articles desats.${location}`
    : `No s’ha pogut cercar al servidor: resultats pel nom.${location}`
})

// ---- what is shown ----
const matching = computed(() => {
  const q = effectiveQuery.value
  if (serverResults.value && needsServer(q)) return filterServerResults(serverResults.value, q)
  return filterLocally(catalog.pieces, q)
})

// A piece can be placed on the board only once, so it lives in exactly one of the two lists.
const usedPieceIds = computed(() => new Set(scene.items.map(i => i.pieceId)))
const unusedPieces = computed(() => matching.value.filter(p => !usedPieceIds.value.has(p.id)))
const usedPieces = computed(() => matching.value.filter(p => usedPieceIds.value.has(p.id)))

// Which view is shown (0 = no usados, 1 = usados). Switched only via the tab buttons.
const page = ref(0)
function goTo(index: number) { page.value = index }

const filtersActive = computed(() => hasActiveFilters(effectiveQuery.value))
/** The "RPi" mark on a row only informs when the list mixes both kinds of pieces. */
const markHardware = computed(() => hardwareFilterVisible.value && query.hardware === 'all')

// ---- advanced filters ----
const advancedOpen = ref(false)
const advancedCount = computed(() => advancedFilterCount(query))

/** The org's types (or, if that request failed, the ones the pieces mention), by name. */
const typeOptions = computed(() => {
  const byId = new Map<number, { id: number, name: string, hardware: boolean }>()
  for (const t of catalog.pieceTypes) byId.set(t.id, { id: t.id, name: t.name, hardware: t.kind != null })
  for (const p of catalog.pieces) {
    for (const t of p.pieceTypes) if (!byId.has(t.id)) byId.set(t.id, { id: t.id, name: t.name, hardware: t.kind != null })
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }))
})
const locationChoices = computed(() => locationOptions(catalog.locations))

function toggleType(id: number) {
  query.typeIds = query.typeIds.includes(id) ? query.typeIds.filter(t => t !== id) : [...query.typeIds, id]
}
function onLocationChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  query.locationId = v ? Number(v) : null
}
function onStatusChange(e: Event) {
  const v = (e.target as HTMLSelectElement).value
  query.status = v ? (v as PieceStatus) : null
}
function clearAdvanced() {
  query.typeIds = []
  query.locationId = null
  query.status = null
}
function clearAll() {
  clearAdvanced()
  clearText()
}

// ---- rows ----
// Enlarged image preview (lightbox) when a thumbnail is clicked.
const preview = ref<{ src: string, name: string } | null>(null)
function openPreview(piece: PieceListItemDto) {
  const url = catalog.coverFullUrl(piece)
  if (url) preview.value = { src: url, name: piece.name }
}

// Unused pieces are added to the board by dragging them onto the selected layer (see BoardStage).
function onDragStart(e: DragEvent, piece: PieceListItemDto) {
  e.dataTransfer?.setData('application/x-stocka-piece', String(piece.id))
  if (e.dataTransfer) e.dataTransfer.effectAllowed = 'copy'
}

// Clicking a used piece selects its placed item (and activates its layer) on the board.
function selectPlaced(piece: PieceListItemDto) {
  const item = scene.items.find(i => i.pieceId === piece.id)
  if (!item) return
  selection.setActiveLayer(item.layerId)
  selection.selectItem(item.id)
}

const emptyUnused = computed(() => filtersActive.value
  ? 'Cap article coincideix amb la cerca.'
  : (effectiveQuery.value.hardware === 'rpi' && matching.value.length === 0 && catalog.pieces.length > 0
      ? 'Cap article fa servir la Raspberry Pi. Prova «Tots».'
      : 'Tots els articles són al tauler.'))
const emptyUsed = computed(() => filtersActive.value
  ? 'Cap article del tauler coincideix amb la cerca.'
  : 'Encara no has afegit cap article al tauler.')
</script>

<template>
  <section class="panel flex min-h-0 flex-1 flex-col">
    <!-- Header: title + the two views -->
    <div class="flex items-center gap-2 px-2 pt-1.5">
      <div class="panel-title flex-1 !px-1 !py-1">Articles</div>
      <div role="tablist" aria-label="Articles segons el tauler" class="flex gap-0.5">
        <button
          type="button"
          role="tab"
          class="tab"
          :class="{ 'tab-active': page === 0 }"
          :aria-selected="page === 0"
          title="Articles que encara no són al tauler: arrossega’ls a una capa"
          @click="goTo(0)">
          No usats <span class="tab-count">{{ unusedPieces.length }}</span>
        </button>
        <button
          type="button"
          role="tab"
          class="tab"
          :class="{ 'tab-active': page === 1 }"
          :aria-selected="page === 1"
          title="Articles ja col·locats: clic per seleccionar-los"
          @click="goTo(1)">
          Usats <span class="tab-count">{{ usedPieces.length }}</span>
        </button>
      </div>
    </div>

    <!-- Search + advanced toggle -->
    <div class="flex items-center gap-1 px-2 pb-1.5 pt-1">
      <div class="relative min-w-0 flex-1">
        <span
          class="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2"
          :class="catalog.semanticSearch ? 'text-accent' : 'text-ink-muted'"
          aria-hidden="true">
          <!-- Sparkles when the search is semantic, a magnifier otherwise -->
          <svg v-if="catalog.semanticSearch" width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2zm7 11l.9 2.6L22.5 16.5l-2.6.9L19 20l-.9-2.6-2.6-.9 2.6-.9L19 13zM5 14l.7 2 2 .7-2 .7L5 19.4l-.7-2-2-.7 2-.7L5 14z" />
          </svg>
          <svg v-else width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
          </svg>
        </span>
        <input
          v-model="qInput"
          class="field field-sm !pl-7"
          :class="{ '!pr-7': qInput }"
          type="search"
          autocomplete="off"
          spellcheck="false"
          aria-label="Cerca articles"
          :placeholder="catalog.semanticSearch ? 'Descriu l’article…' : 'Cerca pel nom…'"
          :title="catalog.semanticSearch
            ? 'Cerca intel·ligent: descriu l’article amb les teves paraules; entén sinònims i errors d’escriptura.'
            : 'Cerca pel nom o la descripció.'"
          @keydown.escape.prevent="clearText">
        <button
          v-if="qInput"
          type="button"
          class="clear-btn"
          title="Esborra la cerca"
          aria-label="Esborra la cerca"
          @click="clearText">
          ✕
        </button>
      </div>
      <button
        type="button"
        class="filter-btn"
        :class="{ 'filter-btn-on': advancedOpen || advancedCount > 0 }"
        :aria-expanded="advancedOpen"
        aria-controls="catalog-advanced"
        :title="advancedOpen ? 'Amaga els filtres avançats' : 'Filtres avançats: tipus, ubicació, estat'"
        @click="advancedOpen = !advancedOpen">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
          <path d="M3 5h18l-7 8v5l-4 2v-7L3 5z" />
        </svg>
        <span v-if="advancedCount > 0" class="filter-count">{{ advancedCount }}</span>
      </button>
    </div>

    <!-- Pieces according to the Raspberry Pi -->
    <div v-if="hardwareFilterVisible" class="px-2 pb-1.5">
      <div class="seg" role="radiogroup" aria-label="Articles segons la Raspberry Pi">
        <button
          v-for="opt in HARDWARE_OPTIONS"
          :key="opt.value"
          type="button"
          role="radio"
          class="seg-btn"
          :class="{ 'seg-btn-on': query.hardware === opt.value }"
          :aria-checked="query.hardware === opt.value"
          :title="opt.title"
          @click="setHardware(opt.value)">
          {{ opt.label }}
        </button>
      </div>
    </div>

    <!-- Advanced filters (fold-out) -->
    <div v-if="advancedOpen" id="catalog-advanced" class="advanced mx-2 mb-1.5">
      <div v-if="typeOptions.length" class="flex flex-col gap-1">
        <span class="label">Tipus</span>
        <div class="flex flex-wrap gap-1">
          <button
            v-for="t in typeOptions"
            :key="t.id"
            type="button"
            class="chip"
            :class="{ 'chip-on': query.typeIds.includes(t.id) }"
            :aria-pressed="query.typeIds.includes(t.id)"
            :title="t.hardware ? `${t.name} · fa servir la Raspberry Pi` : t.name"
            @click="toggleType(t.id)">
            <span v-if="t.hardware" class="chip-dot" aria-hidden="true" />
            {{ t.name }}
          </button>
        </div>
      </div>
      <div class="grid gap-1.5" :class="locationChoices.length ? 'grid-cols-2' : 'grid-cols-1'">
        <label v-if="locationChoices.length" class="flex min-w-0 flex-col gap-1">
          <span class="label">Ubicació</span>
          <select class="field field-sm" :value="query.locationId ?? ''" @change="onLocationChange">
            <option value="">Totes</option>
            <option v-for="l in locationChoices" :key="l.id" :value="l.id" :title="l.path">
              {{ '   '.repeat(l.depth) + l.name }}
            </option>
          </select>
        </label>
        <label class="flex min-w-0 flex-col gap-1">
          <span class="label">Estat</span>
          <select class="field field-sm" :value="query.status ?? ''" @change="onStatusChange">
            <option value="">Tots</option>
            <option value="ACTIVE">Actiu</option>
            <option value="PENDING">Pendent</option>
          </select>
        </label>
      </div>
      <div v-if="advancedCount > 0" class="flex justify-end">
        <button type="button" class="btn btn-sm btn-quiet" @click="clearAdvanced">Treu els filtres</button>
      </div>
    </div>

    <!-- State line -->
    <p v-if="catalog.loading" class="hint">Carregant…</p>
    <p v-else-if="searching" class="hint" aria-live="polite">Cercant…</p>
    <p v-else-if="fallbackMessage" class="hint hint-warn" aria-live="polite">{{ fallbackMessage }}</p>

    <!-- Page 0: not placed yet (draggable) -->
    <div v-if="!catalog.loading && page === 0" class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
      <div v-if="unusedPieces.length === 0" class="px-1 py-2 text-[12px] text-ink-muted">
        {{ emptyUnused }}
        <button v-if="filtersActive" type="button" class="ml-1 text-accent hover:underline" @click="clearAll">Neteja</button>
      </div>
      <ul v-else class="flex flex-col gap-0.5">
        <li v-for="p in unusedPieces" :key="p.id">
          <div
            draggable="true"
            title="Arrossega’l al tauler per afegir-lo a la capa seleccionada"
            class="row cursor-grab active:cursor-grabbing"
            @dragstart="onDragStart($event, p)">
            <img
              v-if="catalog.coverUrl(p)"
              :src="catalog.coverUrl(p)!"
              alt=""
              title="Mostra’l més gran"
              class="thumb cursor-zoom-in"
              loading="lazy"
              draggable="false"
              @click.stop="openPreview(p)">
            <span v-else class="thumb thumb-empty">—</span>
            <span class="min-w-0 flex-1 truncate text-[12.5px] text-ink">{{ p.name }}</span>
            <span v-if="typesLabel(p)" class="types" :title="typesLabel(p)">{{ typesLabel(p) }}</span>
            <span v-if="markHardware && usesHardware(p)" class="rpi" title="Fa servir la Raspberry Pi">RPi</span>
          </div>
        </li>
      </ul>
    </div>

    <!-- Page 1: already on the board (click to select, not draggable) -->
    <div v-else-if="!catalog.loading" class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
      <div v-if="usedPieces.length === 0" class="px-1 py-2 text-[12px] text-ink-muted">
        {{ emptyUsed }}
        <button v-if="filtersActive" type="button" class="ml-1 text-accent hover:underline" @click="clearAll">Neteja</button>
      </div>
      <ul v-else class="flex flex-col gap-0.5">
        <li v-for="p in usedPieces" :key="p.id">
          <button
            type="button"
            title="Ja és al tauler · clic per seleccionar-lo"
            class="row row-used w-full"
            @click="selectPlaced(p)">
            <img
              v-if="catalog.coverUrl(p)"
              :src="catalog.coverUrl(p)!"
              alt=""
              title="Mostra’l més gran"
              class="thumb cursor-zoom-in opacity-70"
              loading="lazy"
              draggable="false"
              @click.stop="openPreview(p)">
            <span v-else class="thumb thumb-empty">—</span>
            <span class="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">{{ p.name }}</span>
            <span v-if="typesLabel(p)" class="types" :title="typesLabel(p)">{{ typesLabel(p) }}</span>
            <span v-if="markHardware && usesHardware(p)" class="rpi" title="Fa servir la Raspberry Pi">RPi</span>
            <span class="flex-shrink-0 text-[11px] text-accent">✓</span>
          </button>
        </li>
      </ul>
    </div>

    <EditorImageLightbox :src="preview?.src ?? null" :alt="preview?.name" @close="preview = null" />
  </section>
</template>

<style scoped>
/* Views: text tabs with a count, underlined when active. */
.tab {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 6px;
  border-radius: 6px;
  font-size: 12px;
  color: var(--c-ink-muted);
  transition: background .12s, color .12s;
}
.tab:hover { background: var(--c-bg-soft); color: var(--c-ink); }
.tab-active { color: var(--c-ink); box-shadow: inset 0 -2px 0 var(--c-accent); border-radius: 6px 6px 0 0; }
.tab-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 999px;
  background: var(--c-bg-soft);
  font-size: 10.5px;
  line-height: 16px;
  text-align: center;
  color: var(--c-ink-soft);
}
.tab-active .tab-count { background: var(--c-accent-soft); color: var(--c-accent-ink); }

.clear-btn {
  position: absolute;
  right: 4px;
  top: 50%;
  width: 20px;
  height: 20px;
  transform: translateY(-50%);
  border-radius: 4px;
  font-size: 11px;
  line-height: 20px;
  color: var(--c-ink-muted);
}
.clear-btn:hover { background: var(--c-bg-soft); color: var(--c-ink); }
/* The browser's own clear button of type=search duplicates ours. */
input[type="search"]::-webkit-search-cancel-button { -webkit-appearance: none; appearance: none; }

.filter-btn {
  position: relative;
  display: inline-flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  border: 1px solid var(--c-line-control);
  border-radius: 6px;
  background: var(--c-bg-card);
  color: var(--c-ink-soft);
  transition: background .12s, border-color .12s, color .12s;
}
.filter-btn:hover { background: var(--c-bg-soft); color: var(--c-ink); }
.filter-btn-on { border-color: var(--c-accent); background: var(--c-accent-soft); color: var(--c-accent-ink); }
.filter-count {
  position: absolute;
  right: -5px;
  top: -5px;
  min-width: 15px;
  height: 15px;
  padding: 0 4px;
  border-radius: 999px;
  background: var(--c-accent);
  color: var(--c-on-accent);
  font-size: 9.5px;
  font-weight: 600;
  line-height: 15px;
  text-align: center;
}

/* Segmented control (brandbook: one row, the active segment raised on the card color). */
.seg {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 2px;
  padding: 2px;
  border-radius: 7px;
  background: var(--c-bg-soft);
}
.seg-btn {
  height: 22px;
  border-radius: 5px;
  font-size: 12px;
  color: var(--c-ink-soft);
  transition: background .12s, color .12s, box-shadow .12s;
}
.seg-btn:hover { color: var(--c-ink); }
.seg-btn-on { background: var(--c-bg-card); color: var(--c-ink); font-weight: 500; box-shadow: var(--shadow-raised); }

.advanced {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border: 1px solid var(--c-line);
  border-radius: 8px;
  background: var(--c-bg-soft);
}
.chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  height: 22px;
  padding: 0 8px;
  border: 1px solid var(--c-line-control);
  border-radius: 999px;
  background: var(--c-bg-card);
  font-size: 11.5px;
  color: var(--c-ink-soft);
  transition: background .12s, border-color .12s, color .12s;
}
.chip:hover { color: var(--c-ink); }
.chip-on { border-color: var(--c-accent); background: var(--c-accent-soft); color: var(--c-accent-ink); }
.chip-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; opacity: .7; }

.hint {
  padding: 2px 12px 6px;
  font-size: 11.5px;
  line-height: 15px;
  color: var(--c-ink-muted);
}
.hint-warn { color: var(--c-warn); }

/* Compact rows: a 24 px cover, the name, the types faded on the right. */
.row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  border: 1px solid var(--c-line);
  border-radius: 7px;
  background: var(--c-bg-card);
  text-align: left;
  transition: background .12s;
}
.row:hover { background: var(--c-bg-soft); }
.row-used { background: color-mix(in srgb, var(--c-bg-soft) 60%, transparent); }
.thumb {
  width: 24px;
  height: 24px;
  flex: none;
  border-radius: 4px;
  object-fit: cover;
}
.thumb-empty {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: var(--c-bg-soft);
  font-size: 10px;
  color: var(--c-ink-muted);
}
.types {
  flex: 0 1 auto;
  max-width: 45%;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
  font-size: 10.5px;
  color: var(--c-ink-muted);
}
.rpi {
  flex: none;
  padding: 0 5px;
  border-radius: 3px;
  background: var(--c-accent-soft);
  font-size: 9.5px;
  font-weight: 600;
  line-height: 15px;
  letter-spacing: .02em;
  color: var(--c-accent-ink);
}
</style>
