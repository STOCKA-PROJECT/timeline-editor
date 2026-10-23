// The range Inicio → Fins of the transport bar: what local playback loops over and what
// «Prova a la Raspberry» rehearses. «Fins» null means the end of the show.

/** A «Fins» typed by the user: kept only when it falls after Inicio and before the end of the show. */
export function normalizeRangeEnd(ms: number | null, startMs: number, durationMs: number): number | null {
  if (ms === null || !Number.isFinite(ms)) return null
  const end = Math.round(ms)
  return end > startMs && end < durationMs ? end : null
}

/** Where the range ends: «Fins», or the end of the show when it is unset or no longer valid. */
export function rangeEndOf(rangeEndMs: number | null, startMs: number, durationMs: number): number {
  return normalizeRangeEnd(rangeEndMs, startMs, durationMs) ?? durationMs
}
