<script setup lang="ts">
import type { ShowIssue } from '~/types/show'
import { PiApiError } from '~/utils/pi/piClient'
import { rehearsalPlayheadMs, skippedMotorText, type RehearsalRange } from '~/utils/pi/rehearse'

// «Prova a la Raspberry»: the connected Pi plays the range Inicio → Fins (looping with «Repetir") of
// the show exactly as it is in the editor now, starting with everything as it would be at Inicio.
// While it plays, the playhead follows the Pi. Pressing again (or Ctrl+Enter) sends the latest edits.

const pi = usePiStore()
const playback = usePlaybackStore()
const scene = useSceneStore()
const { buildPackage, fetchAsset } = useShowPackageBuilder()

type Phase = 'building' | 'uploading' | 'starting'
const phase = ref<Phase | null>(null)
const uploading = ref<string | null>(null)
const error = ref<string | null>(null)
const issues = ref<Array<Pick<ShowIssue, 'message'>>>([])

const rehearsal = computed(() => pi.rehearsal)
const busy = computed(() => phase.value !== null)
const playingOnPi = computed(() => !!rehearsal.value && pi.state === 'PLAYING')

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

const label = computed(() => {
  if (phase.value === 'building') return 'Preparant…'
  if (phase.value === 'uploading') return 'Enviant àudio…'
  if (phase.value === 'starting') return 'Enviant…'
  return rehearsal.value ? 'Torna a provar' : 'Prova a la Raspberry'
})

const summary = computed(() => {
  const r = rehearsal.value
  if (!r) return ''
  const parts = [`Assaig a «${pi.info?.device.name ?? 'Raspberry'}» · ${fmt(r.fromMs)} → ${fmt(r.toMs)}`]
  if (r.loop) parts.push('en bucle')
  if (!playingOnPi.value) parts.push('aturat')
  return parts.join(' · ')
})
const skippedText = computed(() => (rehearsal.value?.skippedMotors ?? []).map(skippedMotorText))

function range(): RehearsalRange {
  return { fromMs: playback.rangeStartMs, toMs: playback.rangeEndMs, loop: playback.loop }
}

async function rehearse() {
  if (busy.value) return
  error.value = null
  issues.value = []
  if (!pi.connected && !(await pi.autoConnect())) {
    error.value = 'Connecta’t a la Raspberry des de «Dispositius».'
    pi.requestPanel()
    return
  }
  if (!pi.pin || !pi.pinVerified) {
    error.value = 'Cal el PIN de la Raspberry: entra’l a «Dispositius».'
    pi.requestPanel()
    return
  }
  if (playback.rangeStartMs >= scene.durationMs) {
    error.value = 'L’inici és al final del show: posa’l abans.'
    return
  }
  playback.pause()
  phase.value = 'building'
  try {
    const built = await buildPackage()
    if (!built.pkg) {
      issues.value = built.errors
      error.value = `El show té ${built.errors.length === 1 ? 'un error' : `${built.errors.length} errors`} i no es pot provar.`
      return
    }
    phase.value = 'starting'
    const result = await pi.rehearse(built.pkg, range(), fetchAsset, (name) => {
      phase.value = 'uploading'
      uploading.value = name
    })
    if (result.status === 'rejected') {
      issues.value = result.errors
      error.value = 'La Raspberry ha rebutjat el show.'
    }
  } catch (e) {
    error.value = e instanceof PiApiError || e instanceof Error ? e.message : 'No s’ha pogut provar a la Raspberry.'
  } finally {
    phase.value = null
    uploading.value = null
  }
}

async function endRehearsal() {
  error.value = null
  issues.value = []
  await pi.endRehearsal()
  if (pi.error) error.value = pi.error
}

// The playhead follows the Pi while the range plays (local playback stays paused and silent).
let raf: number | null = null
function follow() {
  raf = requestAnimationFrame(follow)
  const r = rehearsal.value
  const status = pi.status
  if (!r || !status || status.state !== 'PLAYING') return
  if (playback.playing) playback.pause()
  playback.seek(rehearsalPlayheadMs(r, status.cycleMs, performance.now() - pi.statusAt))
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.repeat) {
    e.preventDefault()
    void rehearse()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKey)
  raf = requestAnimationFrame(follow)
})
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (raf !== null) cancelAnimationFrame(raf)
})
</script>

<template>
  <div class="flex min-w-0 items-center gap-2">
    <button
      type="button"
      class="btn btn-primary !h-8 !px-2.5 !text-[12px]"
      :disabled="busy"
      :aria-busy="busy"
      :title="`La Raspberry toca de ${fmt(playback.rangeStartMs)} a ${playback.rangeEndMs === null ? 'final' : fmt(playback.rangeEndMs)}${playback.loop ? ' en bucle' : ''}, amb el show tal com està ara (Ctrl+Enter)`"
      @click="rehearse()">
      <svg class="mr-1 h-3.5 w-3.5" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2" />
        <path d="M10 7.5v5l4-2.5z" fill="currentColor" />
        <path d="M8 20h8" stroke="currentColor" stroke-width="2" stroke-linecap="round" />
      </svg>
      {{ label }}
    </button>
    <button
      v-if="rehearsal"
      type="button"
      class="btn !h-8 !px-2.5 !text-[12px]"
      :disabled="busy || pi.busyCommand === 'rehearsal'"
      title="La Raspberry torna al seu show actiu"
      @click="endRehearsal()">
      Surt de l’assaig
    </button>
    <span v-if="uploading" class="truncate text-[12px] text-ink-soft" :title="uploading">{{ uploading }}</span>
    <span v-else-if="error" class="max-w-[360px] truncate text-[12px] text-danger" role="alert" :title="[error, ...issues.map(i => i.message)].join('\n')">
      {{ error }}<template v-if="issues.length"> {{ issues[0]!.message }}</template>
    </span>
    <span v-else-if="summary" class="max-w-[360px] truncate text-[12px] text-ink-soft" :title="[summary, ...skippedText].join('\n')">
      {{ summary }}<template v-if="skippedText.length"> · <span class="text-warn">{{ skippedText.length === 1 ? '1 motor no es mou' : `${skippedText.length} motors no es mouen` }}</span></template>
    </span>
  </div>
</template>
