import { defineStore } from 'pinia'
import type { SceneClip } from '~/types/editor'
import { normalizeRangeEnd, rangeEndOf } from '~/utils/playRange'

/**
 * Drives the playhead (a requestAnimationFrame loop) and exposes which clip is active per track at
 * the current time. Playback runs within the range «Inici» → «Fi» ([rangeStartMs, rangeEndMs ??
 * scene.durationMs], the show lasting until its last clip ends); the same range is what «Prova a la
 * Raspberry» rehearses. Visual effects are derived in the canvas; this store owns the clock.
 */
export const usePlaybackStore = defineStore('playback', () => {
  const scene = useSceneStore()

  const currentMs = ref(0)
  const playing = ref(false)
  const rangeStartMs = ref(0)
  /** End of the range; null = the end of the scene. */
  const rangeEndMs = ref<number | null>(null)
  const loop = ref(false)
  /** Whether the audio clips sound during preview playback (see `useAudioPreview`). */
  const audioEnabled = ref(true)
  /** Whether the LEDs of the pieces are drawn on the board (see `useLedBoardPreview`). */
  const ledEnabled = ref(true)
  let rafId: number | null = null
  let lastTs = 0

  /** Where playback stops (or loops): «Fi», or the end of the last clip. */
  const endMs = computed(() => rangeEndOf(rangeEndMs.value, rangeStartMs.value, scene.durationMs))

  function tick(ts: number) {
    if (!playing.value) return
    const delta = lastTs ? ts - lastTs : 0
    lastTs = ts
    currentMs.value = currentMs.value + delta
    if (currentMs.value >= endMs.value) {
      if (loop.value) {
        currentMs.value = rangeStartMs.value
      } else {
        currentMs.value = endMs.value
        pause()
        return
      }
    }
    rafId = requestAnimationFrame(tick)
  }

  function play() {
    if (playing.value) return
    if (currentMs.value >= endMs.value || currentMs.value < rangeStartMs.value) {
      currentMs.value = rangeStartMs.value
    }
    playing.value = true
    lastTs = 0
    rafId = requestAnimationFrame(tick)
  }

  function pause() {
    playing.value = false
    if (rafId != null) {
      cancelAnimationFrame(rafId)
      rafId = null
    }
  }

  function toggle() {
    playing.value ? pause() : play()
  }

  /** The playhead moves over the show and, when «Fi» is after it, up to «Fi». */
  function seek(ms: number) {
    currentMs.value = Math.max(0, Math.min(Math.max(scene.durationMs, endMs.value), Math.round(ms)))
  }

  function stop() {
    pause()
    currentMs.value = rangeStartMs.value
  }

  function setRangeStart(ms: number) {
    rangeStartMs.value = Math.max(0, Math.min(scene.durationMs, Math.round(ms)))
    if (rangeEndMs.value !== null && rangeEndMs.value <= rangeStartMs.value) rangeEndMs.value = null
    if (currentMs.value < rangeStartMs.value) currentMs.value = rangeStartMs.value
  }

  /** «Fi»: null or anything not after «Inici» clears it (then the range ends with the last clip). */
  function setRangeEnd(ms: number | null) {
    rangeEndMs.value = normalizeRangeEnd(ms, rangeStartMs.value)
  }

  function toggleLoop() {
    loop.value = !loop.value
  }

  function toggleAudio() {
    audioEnabled.value = !audioEnabled.value
  }

  function toggleLed() {
    ledEnabled.value = !ledEnabled.value
  }

  /** The clip active at the current time on a given track (last one wins on overlap). */
  function activeClipForTrack(trackId: string): SceneClip | null {
    let active: SceneClip | null = null
    for (const c of scene.clipsForTrack(trackId)) {
      if (currentMs.value >= c.startMs && currentMs.value < c.startMs + c.durationMs) active = c
    }
    return active
  }

  /** Item ids that have an active clip right now (for canvas highlighting). */
  const activeItemIds = computed(() => {
    const ids = new Set<string>()
    for (const t of scene.tracks) {
      if (activeClipForTrack(t.id)) ids.add(t.itemId)
    }
    return ids
  })

  return {
    currentMs,
    playing,
    rangeStartMs,
    rangeEndMs,
    loop,
    audioEnabled,
    ledEnabled,
    endMs,
    play,
    pause,
    toggle,
    seek,
    stop,
    setRangeStart,
    setRangeEnd,
    toggleLoop,
    toggleAudio,
    toggleLed,
    activeClipForTrack,
    activeItemIds
  }
})
