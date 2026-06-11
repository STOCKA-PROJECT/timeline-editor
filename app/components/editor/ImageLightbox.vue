<script setup lang="ts">
const props = defineProps<{ src: string | null, alt?: string }>()
const emit = defineEmits<{ close: [] }>()

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
watch(() => props.src, (s) => {
  if (s) window.addEventListener('keydown', onKey)
  else window.removeEventListener('keydown', onKey)
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div
      v-if="src"
      class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
      @click="emit('close')">
      <div class="relative" @click.stop>
        <button
          type="button"
          title="Cerrar"
          class="absolute -right-3 -top-3 flex h-8 w-8 items-center justify-center rounded-full bg-bg-card text-[13px] text-ink shadow-lg hover:bg-bg-soft"
          @click="emit('close')">✕</button>
        <img :src="src" :alt="alt ?? ''" class="max-h-[85vh] max-w-[85vw] rounded-[10px] object-contain shadow-2xl">
        <p v-if="alt" class="mt-2 text-center text-[13px] text-white">{{ alt }}</p>
      </div>
    </div>
  </Teleport>
</template>
