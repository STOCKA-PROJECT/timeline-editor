<script setup lang="ts">
const scene = useSceneStore()
const config = useRuntimeConfig()
const stockaUrl = config.public.stockaUrl as string

/** Returns to the organization's timelines section in the main app, keeping the session open. */
const exitUrl = computed(() => {
  const base = stockaUrl.replace(/\/+$/, '')
  return scene.orgSlug ? `${base}/dashboard/${scene.orgSlug}/timelines` : base
})

function saveNow() {
  if (scene.dirty && !scene.saving) scene.save().catch(() => { /* surfaced via scene.error */ })
}

const saveLabel = computed(() => {
  if (scene.saving) return 'Guardando…'
  if (scene.conflict) return 'Conflicto'
  if (scene.dirty) return 'Sin guardar'
  if (scene.lastSavedAt) return 'Guardado'
  return ''
})
</script>

<template>
  <header
    class="flex h-[var(--topbar-h)] flex-shrink-0 items-center gap-3 border-b border-line bg-bg-card px-3">
    <span class="truncate text-[13px] font-semibold tracking-[-0.01em] text-ink" :title="scene.timelineName">
      {{ scene.timelineName || 'Timeline' }}
    </span>

    <div class="mx-2 h-5 w-px bg-line" />

    <!-- Board dimensions (in centimetres) -->
    <span class="text-[12px] font-medium text-ink-soft">Tablero</span>
    <label class="flex items-center gap-1 text-[12px] text-ink-soft">
      Ancho (cm)
      <input
        type="number" min="1" step="0.1" class="field !h-8 !w-20 !px-2"
        :value="scene.pxToCm(scene.board.width)"
        @change="scene.setBoard({ width: scene.cmToPx(Math.max(1, Number(($event.target as HTMLInputElement).value))) })">
    </label>
    <label class="flex items-center gap-1 text-[12px] text-ink-soft">
      Alto (cm)
      <input
        type="number" min="1" step="0.1" class="field !h-8 !w-20 !px-2"
        :value="scene.pxToCm(scene.board.height)"
        @change="scene.setBoard({ height: scene.cmToPx(Math.max(1, Number(($event.target as HTMLInputElement).value))) })">
    </label>

    <div class="ml-auto flex items-center gap-3">
      <div class="flex items-center gap-1">
        <button
          class="btn !px-2 !text-[15px] leading-none"
          :disabled="!scene.canUndo"
          title="Deshacer (Ctrl+Z)"
          @click="scene.undo()">↶</button>
        <button
          class="btn !px-2 !text-[15px] leading-none"
          :disabled="!scene.canRedo"
          title="Rehacer (Ctrl+Mayús+Z)"
          @click="scene.redo()">↷</button>
      </div>
      <div class="h-5 w-px bg-line" />
      <span class="text-[12px]" :class="scene.conflict ? 'text-danger' : 'text-ink-muted'">{{ saveLabel }}</span>
      <button class="btn" :disabled="scene.saving || !scene.dirty" @click="saveNow()">Guardar</button>
      <a :href="exitUrl" class="btn">Salir</a>
    </div>
  </header>
</template>
