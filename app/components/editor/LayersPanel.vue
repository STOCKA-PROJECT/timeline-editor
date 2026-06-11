<script setup lang="ts">
import type { SceneLayer } from '~/types/editor'

const scene = useSceneStore()
const selection = useSelectionStore()

// Top of the list = topmost layer (highest z).
const orderedTopFirst = computed(() => [...scene.layersByZ].reverse())

/** Makes a layer active and selects all of its board items (so they highlight together). */
function activateLayer(layer: SceneLayer) {
  selection.setActiveLayer(layer.id)
  selection.selectItems(scene.items.filter(i => i.layerId === layer.id).map(i => i.id))
}

function addLayer() {
  activateLayer(scene.addLayer())
}

// ----- inline rename -----
const editingId = ref<string | null>(null)
const editingName = ref('')

// A function ref runs on every re-render, so we only focus/select once per rename session
// (otherwise the v-model update on each keystroke would re-select the whole text).
let focusedFor: string | null = null

/** Function ref: focus and select the rename input the first time it mounts for a layer. */
function focusRenameInput(el: unknown) {
  if (el instanceof HTMLInputElement && focusedFor !== editingId.value) {
    focusedFor = editingId.value
    // Defer to the next frame so the focus/select runs after the browser settles the originating
    // double-click (which would otherwise place the caret at the end and lose the selection).
    requestAnimationFrame(() => {
      el.focus()
      el.select()
    })
  }
}

function startRename(layer: SceneLayer) {
  editingId.value = layer.id
  editingName.value = layer.name
}

/** Persists the edited name (if non-empty) and exits edit mode. */
function commitRename() {
  if (!editingId.value) return
  const name = editingName.value.trim()
  if (name) scene.updateLayer(editingId.value, { name })
  editingId.value = null
  focusedFor = null
}

function cancelRename() {
  editingId.value = null
  focusedFor = null
}
</script>

<template>
  <section class="panel flex min-h-0 flex-1 flex-col">
    <div class="flex items-center justify-between">
      <div class="panel-title">Capas</div>
      <button class="btn !h-7 !px-2 !text-[12px] mr-2" @click="addLayer">
        + Capa
      </button>
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
      <ul class="flex flex-col gap-1">
        <li
          v-for="layer in orderedTopFirst"
          :key="layer.id"
          class="flex items-center gap-1.5 rounded-[8px] border px-2 py-1.5"
          :class="selection.activeLayerId === layer.id ? 'border-accent bg-accent-soft' : 'border-line bg-bg-card'">
          <button
            type="button"
            class="text-[13px]"
            :title="layer.visible ? 'Ocultar' : 'Mostrar'"
            @click="scene.updateLayer(layer.id, { visible: !layer.visible })">
            {{ layer.visible ? '👁' : '🚫' }}
          </button>
          <input
            v-if="editingId === layer.id"
            :ref="focusRenameInput"
            v-model="editingName"
            type="text"
            class="field min-w-0 flex-1 !h-7 !text-[12.5px]"
            @keyup.enter="commitRename"
            @keyup.esc="cancelRename"
            @blur="commitRename">
          <button
            v-else
            type="button"
            class="min-w-0 flex-1 truncate text-left text-[12.5px] text-ink"
            title="Doble clic para renombrar"
            @click="activateLayer(layer)"
            @dblclick="startRename(layer)">
            {{ layer.name }}
          </button>
          <div class="flex items-center gap-0.5 text-ink-muted">
            <button v-if="editingId !== layer.id" class="px-1 text-[12px]" title="Renombrar"
              @click="startRename(layer)">✏️</button>
            <button class="px-1 text-[12px] disabled:opacity-30" title="Subir"
              @click="scene.moveLayer(layer.id, 1)">▲</button>
            <button class="px-1 text-[12px] disabled:opacity-30" title="Bajar"
              @click="scene.moveLayer(layer.id, -1)">▼</button>
            <button class="px-1 text-[12px] text-danger disabled:opacity-30" title="Eliminar"
              :disabled="scene.layers.length <= 1" @click="scene.removeLayer(layer.id)">✕</button>
          </div>
        </li>
      </ul>
    </div>
  </section>
</template>
