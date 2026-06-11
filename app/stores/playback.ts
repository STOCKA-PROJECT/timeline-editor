import { defineStore } from 'pinia'
import type { SceneClip } from '~/types/editor'

/**
 * Drives the playhead (a requestAnimationFrame loop) and exposes which clip is active per track at
 * the current time. Playback runs within the range [rangeStartMs, scene.durationMs]; the "Fin"
 * (end) is the scene duration. Visual effects are derived in the canvas; this store owns the clock.
 */
export const usePlaybackStore = defineStore('playback', () => {
  const scene = useSceneStore()

  const currentMs = ref(0)
  const playing = ref(false)
  const rangeStartMs = ref(0)
  const loop = ref(false)
  let rafId: number | null = null
  let lastTs = 0

  const endMs = computed(() => scene.durationMs)

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

  function seek(ms: number) {
    currentMs.value = Math.max(0, Math.min(endMs.value, Math.round(ms)))
  }

  function stop() {
    pause()
    currentMs.value = rangeStartMs.value
  }

  function setRangeStart(ms: number) {
    rangeStartMs.value = Math.max(0, Math.min(endMs.value, Math.round(ms)))
    if (currentMs.value < rangeStartMs.value) currentMs.value = rangeStartMs.value
  }

  function toggleLoop() {
    loop.value = !loop.value
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
    loop,
    endMs,
    play,
    pause,
    toggle,
    seek,
    stop,
    setRangeStart,
    toggleLoop,
    activeClipForTrack,
    activeItemIds
  }
})
