<script setup lang="ts">
import { createLedAnimation, createLedFill, placeInTarget, type LedAnimator, type Rgb } from '~/utils/ledPreview'

/**
 * Animated strip of LEDs that approximates what the device will show for an LED action: the
 * animation chosen in the parameters (or a solid fill), on a target of `pixels` LEDs, limited to
 * the `first`/`last` range when given. Purely cosmetic: the device remains the reference.
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

const canvas = ref<HTMLCanvasElement | null>(null)
const playing = ref(true)
let animator: LedAnimator | null = null
let raf = 0
let lastTs = 0

const unsupported = computed(() => props.action === 'animate' && !!props.animation && animator === null && built.value > 0)
const built = ref(0)

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
  const opts = { pixels: props.pixels, first: props.first ?? null, last: props.last ?? null }
  const frame = placeInTarget(animator.step(dtSec), opts)
  const n = frame.length
  const slot = width / n
  const gap = slot > 3 ? 1 : 0
  for (let i = 0; i < n; i++) {
    const [r, g, b] = frame[i]!
    ctx.fillStyle = `rgb(${r},${g},${b})`
    ctx.fillRect(Math.floor(i * slot), 2, Math.max(1, Math.ceil(slot - gap)), height - 4)
  }
}

function tick(ts: number) {
  if (!playing.value) return
  const dt = lastTs ? (ts - lastTs) / 1000 : 0
  lastTs = ts
  draw(dt)
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
    <p v-if="unsupported" class="text-[11px] text-ink-muted">Aquesta animació no té previsualització.</p>
    <p v-else class="text-[11px] text-ink-muted">
      Aproximació de {{ pixels }} LED{{ source ? ` (${source})` : '' }}; el reproductor és la referència.
    </p>
  </div>
</template>
