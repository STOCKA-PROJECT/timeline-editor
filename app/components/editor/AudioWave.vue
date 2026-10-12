<script setup lang="ts">
import { loadDecodedAudio, type DecodedAudio } from '~/utils/audioCache'
import { drawPeaks, peaksBetween } from '~/utils/audioPeaks'

/**
 * Waveform of a window of an audio file, drawn on a canvas sized by the parent (a clip on the
 * timeline, or the whole file in the inspector with the played window highlighted).
 */
const props = withDefaults(defineProps<{
  /** Same-origin URL of the audio bytes; null draws nothing. */
  url: string | null
  fromSec: number
  /** End of the drawn window; null means the end of the file. */
  toSec: number | null
  width: number
  height: number
  /** Window drawn in the accent colour (seconds of the file). */
  highlight?: { fromSec: number, toSec: number } | null
}>(), { highlight: null })

const canvas = ref<HTMLCanvasElement | null>(null)
const audio = ref<DecodedAudio | null>(null)

watch(() => props.url, async (url) => {
  audio.value = null
  if (!url) return
  try {
    const decoded = await loadDecodedAudio(url)
    if (props.url === url) audio.value = decoded
  } catch { /* the clip stays blank */ }
}, { immediate: true })

function cssVar(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return value || fallback
}

function draw() {
  const el = canvas.value
  if (!el) return
  const w = Math.max(1, Math.floor(props.width))
  const h = Math.max(1, Math.floor(props.height))
  const dpr = window.devicePixelRatio || 1
  el.width = w * dpr
  el.height = h * dpr
  const ctx = el.getContext('2d')
  if (!ctx) return
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  ctx.clearRect(0, 0, w, h)
  const decoded = audio.value
  if (!decoded) return
  const to = props.toSec ?? decoded.peaks.durationSec
  const peaks = peaksBetween(decoded.peaks, props.fromSec, to, w)
  drawPeaks(ctx, peaks, w, h, props.highlight ? cssVar('--c-ink-muted', '#9a8f80') : cssVar('--c-accent-ink', '#7a3b1e'))
  if (props.highlight && to > props.fromSec) {
    const pxPerSec = w / (to - props.fromSec)
    const x0 = Math.max(0, Math.floor((props.highlight.fromSec - props.fromSec) * pxPerSec))
    const x1 = Math.min(w, Math.ceil((props.highlight.toSec - props.fromSec) * pxPerSec))
    if (x1 > x0) {
      ctx.save()
      ctx.translate(x0, 0)
      drawPeaks(ctx, peaks.slice(x0, x1), x1 - x0, h, cssVar('--c-accent', '#b4552d'))
      ctx.restore()
    }
  }
}

watch(
  [audio, () => props.width, () => props.height, () => props.fromSec, () => props.toSec, () => props.highlight?.fromSec, () => props.highlight?.toSec],
  () => nextTick(draw),
  { flush: 'post' }
)
onMounted(draw)
</script>

<template>
  <canvas ref="canvas" class="block" :style="{ width: Math.max(1, Math.floor(width)) + 'px', height: Math.max(1, Math.floor(height)) + 'px' }" aria-hidden="true" />
</template>
