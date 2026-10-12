<script setup lang="ts">
import { createLedAnimation, createLedFill, placeInTarget, type LedAnimator, type Rgb } from '~/utils/ledPreview'

/**
 * Animated strip of LEDs that approximates what the device will show for an LED action: the
 * animation chosen in the parameters (or a solid fill), on a target of `pixels` LEDs, limited to
 * the `first`/`last` range when given. A small timeline under the strip shows the position inside
 * the clip and can be dragged to seek. Purely cosmetic: the device remains the reference.
 */
const props = defineProps<{
  action: 'animate' | 'fill' | 'clear'
  animation?: string | null
  /** Parameters already coerced to catalog values (`[r, g, b]` colours, numbers). */
  params: Record<string, unknown>
  pixels: number
  /** Where the LED count comes from, shown in the hint. */
  source?: string | null
  durationSec?: number | null
  first?: number | null
  last?: number | null
}>()

const FRAME = 1 / 30

const canvas = ref<HTMLCanvasElement | null>(null)
const timelineEl = ref<HTMLDivElement | null>(null)
const playing = ref(true)
const built = ref(0)
/** Seconds elapsed inside the clip (loops back to 0 at the end). */
const elapsed = ref(0)
let animator: LedAnimator | null = null
let raf = 0
let lastTs = 0

const unsupported = computed(() => props.action === 'animate' && !!props.animation && animator === null && built.value > 0)

/** Length of the timeline: the clip, or the device default of the animation when the clip has no duration parameter. */
const totalSec = computed(() => {
  if (props.durationSec && props.durationSec > 0) return props.durationSec
  if (props.action !== 'animate') return 5
  return props.animation === 'sunrise' ? 10 : props.animation === 'sunset' ? 15 : props.animation === 'fade' ? 1 : 10
})
const progress = computed(() => Math.min(1, elapsed.value / totalSec.value))
const fmt = (s: number) => `${s.toFixed(1)} s`

function build() {
  const opts = { pixels: props.pixels, durationSec: props.durationSec ?? null, first: props.first ?? null, last: props.last ?? null }
  if (props.action === 'fill') {
    const color = props.params.color
    animator = createLedFill(Array.isArray(color) ? (color as Rgb) : [0, 0, 0], opts)
  } else if (props.action === 'clear') {
    animator = createLedFill([0, 0, 0], opts)
  } else {
    animator = props.animation ? createLedAnimation(props.animation, props.params, opts) : null
  }
  built.value++
  elapsed.value = 0
  lastTs = 0
  draw(0)
}

function draw(dtSec: number) {
  const el = canvas.value
  if (!el) return
  const ctx = el.getContext('2d')
  if (!ctx) return
  const width = el.clientWidth || 320
  if (el.width !== width) el.width = width
  const height = el.height
  ctx.fillStyle = '#101214'
  ctx.fillRect(0, 0, width, height)
  if (!animator) return
  const frame = placeInTarget(animator.step(dtSec), { pixels: props.pixels, first: props.first ?? null, last: props.last ?? null })
  const slot = width / frame.length
  const gap = slot > 3 ? 1 : 0
  frame.forEach(([r, g, b], i) => {
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(Math.floor(i * slot), 2, Math.max(1, Math.ceil(slot - gap)), height - 4)
  })
}

function tick(ts: number) {
  if (!playing.value) return
  const dt = lastTs ? Math.min((ts - lastTs) / 1000, 0.5) : 0
  lastTs = ts
  if (elapsed.value + dt >= totalSec.value) {
    // End of the clip: start over, like a looping preview.
    build()
  } else {
    elapsed.value += dt
    draw(dt)
  }
  raf = requestAnimationFrame(tick)
}

function start() {
  cancelAnimationFrame(raf)
  lastTs = 0
  if (playing.value) raf = requestAnimationFrame(tick)
}

function togglePlay() {
  playing.value = !playing.value
  if (playing.value) start()
  else cancelAnimationFrame(raf)
}

/** Jumps to `sec` by rebuilding the animation and fast-forwarding it frame by frame. */
function seek(sec: number) {
  const target = Math.max(0, Math.min(totalSec.value - FRAME, sec))
  build()
  let remaining = target
  while (remaining > 0 && animator) {
    const step = Math.min(0.5, remaining)
    animator.step(step)
    remaining -= step
  }
  elapsed.value = target
  lastTs = 0
  draw(0)
}

// ---- scrubbing on the mini timeline ----
let wasPlaying = true
function secAt(clientX: number): number {
  const rect = timelineEl.value?.getBoundingClientRect()
  if (!rect || rect.width === 0) return 0
  return ((clientX - rect.left) / rect.width) * totalSec.value
}
function onScrubDown(e: PointerEvent) {
  e.preventDefault()
  wasPlaying = playing.value
  playing.value = false
  cancelAnimationFrame(raf)
  seek(secAt(e.clientX))
  const onMove = (ev: PointerEvent) => seek(secAt(ev.clientX))
  const onUp = () => {
    window.removeEventListener('pointermove', onMove)
    window.removeEventListener('pointerup', onUp)
    playing.value = wasPlaying
    start()
  }
  window.addEventListener('pointermove', onMove)
  window.addEventListener('pointerup', onUp)
}

// Any change of the action, animation, parameters or target rebuilds the animation from scratch.
watch(() => [props.action, props.animation, props.params, props.pixels, props.durationSec, props.first, props.last], () => {
  build()
  start()
}, { deep: true })

onMounted(() => {
  build()
  start()
})
onBeforeUnmount(() => cancelAnimationFrame(raf))
</script>

<template>
  <div class="flex flex-col gap-1">
    <div class="flex items-center justify-between">
      <span class="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Previsualització</span>
      <button type="button" class="text-[11px] text-ink-muted hover:text-ink" @click="togglePlay">
        {{ playing ? '❚❚ Pausa' : '▶ Reprèn' }}
      </button>
    </div>
    <canvas ref="canvas" class="h-5 w-full rounded-[4px] border border-line" height="20" />

    <!-- Mini timeline: position inside the clip; click or drag to seek -->
    <div class="flex items-center gap-2">
      <span class="w-12 flex-shrink-0 font-mono text-[10.5px] tabular-nums text-ink-muted">{{ fmt(elapsed) }}</span>
      <div
        ref="timelineEl"
        class="relative h-2 min-w-0 flex-1 cursor-ew-resize rounded-full bg-line/70"
        title="Arrossega per moure't en el temps"
        @pointerdown="onScrubDown">
        <div class="absolute left-0 top-0 h-full rounded-full bg-accent/50" :style="{ width: progress * 100 + '%' }" />
        <div class="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border border-bg-card bg-danger shadow" :style="{ left: progress * 100 + '%' }" />
      </div>
      <span class="w-12 flex-shrink-0 text-right font-mono text-[10.5px] tabular-nums text-ink-muted">{{ fmt(totalSec) }}</span>
    </div>

    <p v-if="unsupported" class="text-[11px] text-ink-muted">Aquesta animació no té previsualització.</p>
    <p v-else class="text-[11px] text-ink-muted">
      Aproximació de {{ pixels }} LED{{ source ? ` (${source})` : '' }}; el reproductor és la referència.
    </p>
  </div>
</template>
