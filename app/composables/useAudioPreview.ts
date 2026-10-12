import { getAudioContext, loadDecodedAudio } from '~/utils/audioCache'

/**
 * Makes the audio clips sound during preview playback, in sync with the playhead. Every time
 * playback starts (or the playhead jumps, or the scene changes while playing) the clips are
 * scheduled on the AudioContext clock from the current position: a clip already under the playhead
 * starts mid-file, a later one is queued at its exact offset. Pausing stops every source.
 */
export function useAudioPreview() {
  const scene = useSceneStore()
  const playback = usePlaybackStore()
  const { audioClips, ensureAudioLoaded } = useAudioClips()

  let active: AudioBufferSourceNode[] = []
  /** Where the timeline was (ms) when the sources were scheduled, and the context time then. */
  let anchor: { ctxTime: number, ms: number } | null = null
  let token = 0
  let rescheduleTimer: ReturnType<typeof setTimeout> | null = null

  function stopAll() {
    token++
    for (const src of active) {
      try { src.stop() } catch { /* already ended */ }
    }
    active = []
    anchor = null
  }

  async function schedule() {
    stopAll()
    if (!playback.playing || !playback.audioEnabled || !import.meta.client) return
    const ctx = getAudioContext()
    if (ctx.state !== 'running') {
      try { await ctx.resume() } catch { return }
    }
    const mine = ++token
    anchor = { ctxTime: ctx.currentTime, ms: playback.currentMs }
    const anchored = anchor
    for (const info of audioClips.value) {
      if (!info.url) continue
      loadDecodedAudio(info.url).then((audio) => {
        if (mine !== token || !playback.playing) return
        // Account for the decoding time: where is the playhead now according to the audio clock?
        const nowMs = anchored.ms + (ctx.currentTime - anchored.ctxTime) * 1000
        const clipStart = info.clip.startMs
        const clipEnd = clipStart + info.clip.durationMs
        if (clipEnd <= nowMs) return
        const offsetIntoClip = Math.max(0, nowMs - clipStart) / 1000
        const fileOffset = info.range.startSec + offsetIntoClip
        if (fileOffset >= audio.buffer.duration) return
        const when = ctx.currentTime + Math.max(0, clipStart - nowMs) / 1000
        const remaining = (clipEnd - Math.max(nowMs, clipStart)) / 1000
        const length = Math.min(remaining, audio.buffer.duration - fileOffset)
        if (length <= 0) return
        const src = ctx.createBufferSource()
        src.buffer = audio.buffer
        src.connect(ctx.destination)
        src.onended = () => { active = active.filter(s => s !== src) }
        src.start(when, fileOffset, length)
        active.push(src)
      }).catch(() => { /* a file that fails to load simply stays silent */ })
    }
  }

  function scheduleSoon() {
    if (rescheduleTimer) clearTimeout(rescheduleTimer)
    rescheduleTimer = setTimeout(() => { rescheduleTimer = null; void schedule() }, 150)
  }

  watch(() => playback.playing, (playing) => { playing ? void schedule() : stopAll() })
  watch(() => playback.audioEnabled, () => { if (playback.playing) void schedule() })
  // A seek while playing (or the loop restarting): the playhead is no longer where the sources were scheduled.
  watch(() => playback.currentMs, (ms) => {
    if (!playback.playing || !anchor || !import.meta.client) return
    const expected = anchor.ms + (getAudioContext().currentTime - anchor.ctxTime) * 1000
    if (Math.abs(ms - expected) > 250) void schedule()
  })
  // Clips moved, trimmed or re-pointed while playing: reschedule once the edit settles.
  watch(() => scene.dirtyRevision, () => { if (playback.playing) scheduleSoon() })
  // The files of the audio pieces on the board, so clips resolve their attachment (and the waveform shows).
  watch(() => [...new Set(scene.items.map(i => i.pieceId))].join(','), () => { if (import.meta.client) void ensureAudioLoaded() }, { immediate: true })

  onBeforeUnmount(() => {
    stopAll()
    if (rescheduleTimer) clearTimeout(rescheduleTimer)
  })
}
