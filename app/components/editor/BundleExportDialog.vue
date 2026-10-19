<script setup lang="ts">
import type { BundleExportFile, BundleExportPhase } from '~/composables/useBundleExport'
import { formatBytes } from '~/utils/bundle/formatBytes'

// Progress of «Exportar paquet»: one row per file of the zip, the warnings of the show and, once
// the file is downloaded, how to take it to the Raspberry Pi of the belén (no Internet there).

const emit = defineEmits<{ close: [] }>()

const { phase, files, errors, warnings, error, fileName, busy, totalSize, loadedSize, start } = useBundleExport()

const PHASE_LABEL: Record<BundleExportPhase, string> = {
  idle: '',
  building: 'Preparant el show…',
  downloading: 'Descarregant els fitxers…',
  zipping: 'Empaquetant…',
  done: 'Paquet exportat',
  error: "No s'ha exportat"
}
const KIND_LABEL: Record<BundleExportFile['kind'], string> = { show: 'Show', audio: 'Àudio', video: 'Vídeo' }
const RPI_URL = 'http://belen.local:8080'
const RPI_IP_URL = 'http://10.42.0.1:8080'

const phaseBadge = computed(() => {
  if (phase.value === 'done') return 'badge-ok'
  if (phase.value === 'error') return 'badge-danger'
  return 'badge-brand'
})
/** Retrying only helps when the download failed; show errors need the editor first. */
const canRetry = computed(() => phase.value === 'error' && errors.value.length === 0)

function percent(file: BundleExportFile): number {
  if (file.size <= 0) return file.done ? 100 : 0
  return Math.round((100 * Math.min(file.loaded, file.size)) / file.size)
}

function fileLabel(file: BundleExportFile): string {
  return file.kind === 'show' ? file.path : file.path.replace(/^assets\/(audio|video)\//, '')
}

function tryClose() {
  if (!busy.value) emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') tryClose()
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  start()
})
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" @click="tryClose">
      <section
        class="panel flex max-h-[85vh] w-[560px] max-w-full flex-col shadow-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="bundle-export-title"
        :aria-busy="busy"
        @click.stop>
        <header class="flex items-center gap-3 border-b border-line-strong px-4 py-3">
          <h2 id="bundle-export-title" class="font-display text-[15px] font-semibold leading-5 text-ink">Exportar paquet</h2>
          <span v-if="PHASE_LABEL[phase]" class="badge" :class="phaseBadge">{{ PHASE_LABEL[phase] }}</span>
        </header>

        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <p v-if="fileName" class="truncate text-[13px] leading-[18px] text-ink-soft" :title="fileName">
            Fitxer: <code class="font-mono text-ink">{{ fileName }}</code>
          </p>

          <ul v-if="files.length" class="space-y-2" aria-label="Fitxers del paquet">
            <li v-for="f in files" :key="f.path">
              <div class="flex items-baseline gap-2 text-[13px] leading-[18px]">
                <span class="badge" :class="f.kind === 'show' ? 'badge-brand' : ''">{{ KIND_LABEL[f.kind] }}</span>
                <span class="min-w-0 flex-1 truncate font-mono text-ink" :title="f.path">{{ fileLabel(f) }}</span>
                <span class="whitespace-nowrap text-[12px] text-ink-muted">
                  {{ f.done ? formatBytes(f.size) : `${formatBytes(f.loaded)} / ${formatBytes(f.size)}` }}
                </span>
              </div>
              <div
                class="mt-1 h-1.5 overflow-hidden rounded-full bg-bg-alt"
                role="progressbar"
                :aria-label="f.path"
                :aria-valuenow="percent(f)"
                aria-valuemin="0"
                aria-valuemax="100">
                <div class="h-full rounded-full transition-[width]" :class="f.done ? 'bg-ok' : 'bg-accent'" :style="{ width: `${percent(f)}%` }" />
              </div>
            </li>
          </ul>
          <p v-if="files.length" class="flex justify-between text-[12px] leading-4 text-ink-soft">
            <span>{{ files.length }} {{ files.length === 1 ? 'fitxer' : 'fitxers' }}</span>
            <span>{{ formatBytes(loadedSize) }} de {{ formatBytes(totalSize) }}</span>
          </p>

          <ul
            v-if="errors.length || warnings.length"
            class="max-h-44 overflow-y-auto rounded-[6px] border border-line bg-bg-alt px-1 py-1"
            aria-label="Avisos del show">
            <li
              v-for="(e, i) in errors" :key="'e' + i"
              class="flex items-start gap-2 px-2 py-1.5 text-[13px] leading-[18px] text-ink">
              <span class="badge badge-danger mt-0.5">Error</span>
              <span class="min-w-0">{{ e.message }}</span>
            </li>
            <li
              v-for="(w, i) in warnings" :key="'w' + i"
              class="flex items-start gap-2 px-2 py-1.5 text-[13px] leading-[18px] text-ink">
              <span class="badge badge-warn mt-0.5">Avís</span>
              <span class="min-w-0">{{ w.message }}</span>
            </li>
          </ul>

          <p v-if="error" class="text-[13px] leading-[18px] text-danger" role="alert">{{ error }}</p>

          <div
            v-if="phase === 'done'"
            class="rounded-[6px] border border-line bg-accent-soft px-3 py-2 text-[13px] leading-[18px] text-ink">
            <p class="font-medium">El paquet s'ha desat a l'ordinador. Per portar-lo al pessebre:</p>
            <ol class="mt-1 list-decimal space-y-0.5 pl-5">
              <li>Connecta't a la Wi-Fi <strong>belen</strong> (la contrasenya és a l'etiqueta de la caixa).</li>
              <li>
                Obre <code class="font-mono">{{ RPI_URL }}</code> (o <code class="font-mono">{{ RPI_IP_URL }}</code>) i escriu el PIN.
              </li>
              <li>Arrossega-hi el fitxer <code class="font-mono">{{ fileName }}</code> i activa el show.</li>
            </ol>
            <p class="mt-1 text-ink-soft">No cal Internet: la Raspberry només copia els fitxers que encara no té.</p>
          </div>
        </div>

        <footer class="flex items-center justify-end gap-2 border-t border-line-strong bg-bg-alt px-4 py-2">
          <button v-if="canRetry" type="button" class="btn btn-sm" @click="start()">Torna-ho a provar</button>
          <button
            type="button"
            class="btn btn-sm"
            :class="phase === 'done' ? 'btn-primary' : ''"
            :disabled="busy"
            @click="emit('close')">Tanca</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
