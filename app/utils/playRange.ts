// The range Inici → Fi of the transport bar: what local playback loops over and what
// «Prova a la Raspberry» rehearses. «Fi» null means the end of the show, which is the end of its last clip.

/** A «Fi» typed by the user: kept only when it falls after Inici and before the end of the show. */
export function normalizeRangeEnd(ms: number | null, startMs: number, durationMs: number): number | null {
  if (ms === null || !Number.isFinite(ms)) return null
  const end = Math.round(ms)
  return end > startMs && end < durationMs ? end : null
}

/** Where the range ends: «Fi», or the end of the show when it is unset or no longer valid. */
export function rangeEndOf(rangeEndMs: number | null, startMs: number, durationMs: number): number {
  return normalizeRangeEnd(rangeEndMs, startMs, durationMs) ?? durationMs
}

/** The show lasts until the end of its last clip (the backend's `SceneDocument` does the same); null without clips. */
export function endOfLastClip(clips: ReadonlyArray<{ startMs: number, durationMs: number }>): number | null {
  let end: number | null = null
  for (const c of clips) end = Math.max(end ?? 0, c.startMs + c.durationMs)
  return end
}

/** How much of the timeline is drawn: the show plus room after it to drop new clips. */
export function timelineViewMs(showMs: number): number {
  return showMs + Math.max(30_000, Math.round(showMs * 0.2))
}

/** `m:ss`, `m:ss.d`, plain seconds (`315`, `315,5`) → ms; '' → null; anything else → undefined. */
export function parseTimeInput(text: string): number | null | undefined {
  const raw = text.trim().replace(',', '.')
  if (raw === '') return null
  const clock = /^(\d+):([0-5]?\d(?:\.\d+)?)$/.exec(raw)
  if (clock) return Math.round((Number(clock[1]) * 60 + Number(clock[2])) * 1000)
  if (/^\d+(?:\.\d+)?$/.test(raw)) return Math.round(Number(raw) * 1000)
  return undefined
}

/** ms → `m:ss.d` (tenths only when there are any): what the time fields show. */
export function formatTimeInput(ms: number): string {
  const tenths = Math.round(ms / 100)
  const s = Math.floor(tenths / 10)
  const rest = tenths % 10
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}${rest ? `.${rest}` : ''}`
}
