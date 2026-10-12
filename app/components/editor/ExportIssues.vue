<script setup lang="ts">
import type { ShowIssue } from '~/types/show'

const props = defineProps<{
  errors: ShowIssue[]
  warnings: ShowIssue[]
  /** Name of the file that was (or was not) downloaded. */
  fileName?: string
}>()

const emit = defineEmits<{ close: [] }>()

const title = computed(() => {
  if (props.errors.length > 0) {
    return `No s'ha exportat: ${props.errors.length} ${props.errors.length === 1 ? 'error' : 'errors'}`
  }
  return `Exportat ${props.fileName ?? ''} amb ${props.warnings.length} ${props.warnings.length === 1 ? 'avís' : 'avisos'}`
})
</script>

<template>
  <section
    class="absolute right-3 top-[calc(var(--topbar-h)+8px)] z-30 w-[480px] max-w-[calc(100vw-24px)] panel shadow-overlay"
    role="dialog"
    aria-labelledby="export-issues-title">
    <header class="flex items-center gap-2 border-b border-line-strong px-4 py-2">
      <h2 id="export-issues-title" class="text-[15px] font-semibold leading-5 text-ink">{{ title }}</h2>
      <button class="btn btn-sm ml-auto" aria-label="Tanca els avisos" @click="emit('close')">Tancar</button>
    </header>
    <ul class="max-h-[320px] overflow-y-auto px-2 py-2">
      <li
        v-for="(e, i) in errors" :key="'e' + i"
        class="flex items-start gap-2 rounded-[6px] px-2 py-1.5 text-[13px] leading-[18px] text-ink">
        <span class="badge badge-danger mt-0.5">Error</span>
        <span class="min-w-0">{{ e.message }}</span>
      </li>
      <li
        v-for="(w, i) in warnings" :key="'w' + i"
        class="flex items-start gap-2 rounded-[6px] px-2 py-1.5 text-[13px] leading-[18px] text-ink">
        <span class="badge badge-warn mt-0.5">Avís</span>
        <span class="min-w-0">{{ w.message }}</span>
      </li>
    </ul>
    <footer v-if="errors.length" class="border-t border-line-strong bg-bg-alt px-4 py-2 text-[12px] leading-4 text-ink-soft">
      Corregeix els errors i torna a exportar. Els avisos no bloquegen l'exportació.
    </footer>
  </section>
</template>
