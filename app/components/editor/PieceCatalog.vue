<script setup lang="ts">
import type { PieceListItemDto } from '~/types/api'

const catalog = useCatalogStore()
const scene = useSceneStore()
const selection = useSelectionStore()

const search = ref('')
const filtered = computed(() => {
  const q = search.value.trim().toLowerCase()
  if (!q) return catalog.pieces
  return catalog.pieces.filter(p => p.name.toLowerCase().includes(q))
})

// A piece can be placed on the board only once, so it lives in exactly one of the two lists.
const usedPieceIds = computed(() => new Set(scene.items.map(i => i.pieceId)))
const unusedPieces = computed(() => filtered.value.filter(p => !usedPieceIds.value.has(p.id)))
const usedPieces = computed(() => filtered.value.filter(p => usedPieceIds.value.has(p.id)))

// Which view is shown (0 = no usados, 1 = usados). Switched only via the tab buttons.
const page = ref(0)
function goTo(index: number) { page.value = index }

// Enlarged image preview (lightbox) when a thumbnail is clicked.
const preview = ref<{ src: string, name: string } | null>(null)
function openPreview(piece: PieceListItemDto) {
  const url = catalog.coverUrl(piece)
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
</script>

<template>
  <section class="panel flex min-h-0 flex-1 flex-col">
    <div class="panel-title">Artículos</div>

    <!-- Tabs: switch between the two horizontally-scrollable views -->
    <div class="flex items-center gap-1 px-2">
      <button
        type="button"
        class="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] border px-2 py-1 text-[12px] transition-colors"
        :class="page === 0 ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-bg-card text-ink-muted hover:bg-bg-soft'"
        @click="goTo(0)">
        No usados
        <span class="rounded-full bg-bg-soft px-1.5 text-[10.5px]">{{ unusedPieces.length }}</span>
      </button>
      <button
        type="button"
        class="flex flex-1 items-center justify-center gap-1.5 rounded-[8px] border px-2 py-1 text-[12px] transition-colors"
        :class="page === 1 ? 'border-accent bg-accent-soft text-ink' : 'border-line bg-bg-card text-ink-muted hover:bg-bg-soft'"
        @click="goTo(1)">
        Usados
        <span class="rounded-full bg-bg-soft px-1.5 text-[10.5px]">{{ usedPieces.length }}</span>
      </button>
    </div>

    <div class="px-2 py-2">
      <input v-model="search" class="field" type="text" placeholder="Buscar…">
    </div>

    <p v-if="catalog.loading" class="px-3 py-2 text-[12px] text-ink-muted">Cargando…</p>

    <!-- Page 0: not placed yet (draggable) -->
    <div v-else-if="page === 0" class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
      <p v-if="unusedPieces.length === 0" class="px-1 py-2 text-[12px] text-ink-muted">
        {{ search ? 'Sin resultados.' : 'Todos los artículos están en el tablero.' }}
      </p>
      <ul v-else class="flex flex-col gap-1">
        <li v-for="p in unusedPieces" :key="p.id">
          <div
            draggable="true"
            title="Arrastra al tablero para añadirlo a la capa seleccionada"
            class="flex w-full cursor-grab items-center gap-2 rounded-[8px] border border-line bg-bg-card px-2 py-1.5 text-left transition-colors hover:bg-bg-soft active:cursor-grabbing"
            @dragstart="onDragStart($event, p)">
            <img
              v-if="catalog.coverUrl(p)"
              :src="catalog.coverUrl(p)!"
              alt=""
              title="Ver más grande"
              class="h-7 w-7 flex-shrink-0 cursor-zoom-in rounded object-cover"
              loading="lazy"
              draggable="false"
              @click.stop="openPreview(p)">
            <span v-else class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-bg-soft text-[10px] text-ink-muted">—</span>
            <span class="truncate text-[12.5px] text-ink">{{ p.name }}</span>
          </div>
        </li>
      </ul>
    </div>

    <!-- Page 1: already on the board (click to select, not draggable) -->
    <div v-else class="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 pb-2">
      <p v-if="usedPieces.length === 0" class="px-1 py-2 text-[12px] text-ink-muted">
        {{ search ? 'Sin resultados.' : 'Aún no has añadido artículos al tablero.' }}
      </p>
      <ul v-else class="flex flex-col gap-1">
        <li v-for="p in usedPieces" :key="p.id">
          <button
            type="button"
            title="Ya está en el tablero · clic para seleccionarlo"
            class="flex w-full items-center gap-2 rounded-[8px] border border-line bg-bg-soft/60 px-2 py-1.5 text-left transition-colors hover:bg-bg-soft"
            @click="selectPlaced(p)">
            <img
              v-if="catalog.coverUrl(p)"
              :src="catalog.coverUrl(p)!"
              alt=""
              title="Ver más grande"
              class="h-7 w-7 flex-shrink-0 cursor-zoom-in rounded object-cover opacity-70"
              loading="lazy"
              draggable="false"
              @click.stop="openPreview(p)">
            <span v-else class="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded bg-bg-soft text-[10px] text-ink-muted">—</span>
            <span class="min-w-0 flex-1 truncate text-[12.5px] text-ink-soft">{{ p.name }}</span>
            <span class="flex-shrink-0 text-[11px] text-accent">✓</span>
          </button>
        </li>
      </ul>
    </div>

    <EditorImageLightbox :src="preview?.src ?? null" :alt="preview?.name" @close="preview = null" />
  </section>
</template>
