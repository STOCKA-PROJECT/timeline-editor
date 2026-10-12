import { computePeaks, type AudioPeaks } from '~/utils/audioPeaks'

// Browser side of the audio clips: fetches an attachment through the backend (same origin), decodes
// it once with Web Audio and keeps the buffer and its peaks for the waveform and the preview.

export interface DecodedAudio {
  buffer: AudioBuffer
  peaks: AudioPeaks
  durationMs: number
}

let context: AudioContext | null = null

/** The page's single AudioContext (created lazily; resumed by the caller on a user gesture). */
export function getAudioContext(): AudioContext {
  if (!context) {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    context = new Ctor()
  }
  return context
}

const pending = new Map<string, Promise<DecodedAudio>>()
const ready = new Map<string, DecodedAudio>()

/** Decoded audio of a URL, fetched and decoded once; a failed load is forgotten so it can be retried. */
export function loadDecodedAudio(url: string): Promise<DecodedAudio> {
  const done = ready.get(url)
  if (done) return Promise.resolve(done)
  let p = pending.get(url)
  if (!p) {
    p = (async () => {
      const bytes = await $fetch<ArrayBuffer>(url, { responseType: 'arrayBuffer' })
      const buffer = await getAudioContext().decodeAudioData(bytes.slice(0))
      const channels: Float32Array[] = []
      for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c))
      const decoded = { buffer, peaks: computePeaks(channels, buffer.sampleRate), durationMs: Math.round(buffer.duration * 1000) }
      ready.set(url, decoded)
      return decoded
    })()
    pending.set(url, p)
    p.catch(() => { /* retried on the next request */ }).finally(() => pending.delete(url))
  }
  return p
}

/** Already decoded audio of a URL, without triggering a load. */
export function peekDecodedAudio(url: string): DecodedAudio | undefined {
  return ready.get(url)
}
