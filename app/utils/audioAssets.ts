import type { PieceAttachmentResponseDto, PieceTypeActionResponseDto } from '~/types/api'

// Audio files in a show: an `audio.play` clip names an AUDIO attachment of its piece by asset name
// (`<attachmentId>-<filename>`, see rpi4-system/contract/README.md) and covers a window of the
// file: from `start` seconds for `time` seconds (the clip length when `time` is the duration
// parameter), or until the end of the file when there is no duration.

/** `m:ss` (or `h:mm:ss`) for a length in milliseconds; `—` when unknown. */
export function formatClock(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms) || ms < 0) return '—'
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = h ? String(m).padStart(2, '0') : String(m)
  return `${h ? h + ':' : ''}${mm}:${String(s).padStart(2, '0')}`
}

/** The original file name made safe for the player's media folder (same rule as the backend keys). */
export function safeAssetFilename(name: string | null | undefined): string {
  const base = (name ?? '').trim().toLowerCase().replace(/[^a-z0-9._-]/g, '_')
  return base || 'file'
}

/** Asset name of an attachment: unique (the id) and readable (the file name). */
export function assetNameFor(attachment: { id: number, originalFilename: string }): string {
  return `${attachment.id}-${safeAssetFilename(attachment.originalFilename)}`
}

/** The attachment id encoded at the front of an asset name, or null when the name has none. */
export function attachmentIdFromAssetName(name: unknown): number | null {
  if (typeof name !== 'string') return null
  const m = /^(\d+)-/.exec(name.trim())
  return m ? Number(m[1]) : null
}

/** The attachment an asset name points at, among a piece's audio files. */
export function findAudioByAssetName(list: PieceAttachmentResponseDto[], name: unknown): PieceAttachmentResponseDto | undefined {
  const id = attachmentIdFromAssetName(name)
  return id == null ? undefined : list.find(a => a.id === id)
}

/** Whether an action is the catalog's `audio.play` (the only action that names an audio file). */
export function isAudioPlay(kind: string | null | undefined, actionName: string | null | undefined): boolean {
  return kind === 'audio' && actionName === 'play'
}

export interface AudioClipRange {
  /** Second of the file where playback starts. */
  startSec: number
  /** Seconds played from `startSec`; null means until the end of the file. */
  durationSec: number | null
}

function numberOrNull(raw: unknown): number | null {
  if (raw == null || raw === '') return null
  const n = Number(raw)
  return Number.isFinite(n) ? n : null
}

/** Value of a parameter for a clip: its own value when dynamic, the type's fixed value otherwise. */
function paramValue(action: PieceTypeActionResponseDto, name: string, paramValues: Record<string, unknown>): unknown {
  const def = action.parameters.find(p => p.name === name)
  if (!def) return undefined
  return def.dynamic ? paramValues[name] : def.staticValue
}

/** Window of the file an `audio.play` clip covers, from its parameters and length. */
export function audioClipRange(clip: { durationMs: number, paramValues: Record<string, unknown> }, action: PieceTypeActionResponseDto): AudioClipRange {
  const start = numberOrNull(paramValue(action, 'start', clip.paramValues))
  const startSec = start != null && start > 0 ? start : 0
  const timeDef = action.parameters.find(p => p.name === 'time')
  let durationSec: number | null = null
  if (timeDef?.isDuration) {
    durationSec = clip.durationMs / 1000
  } else if (timeDef) {
    const t = numberOrNull(paramValue(action, 'time', clip.paramValues))
    durationSec = t != null && t > 0 ? t : null
  }
  return { startSec, durationSec }
}

/**
 * Seconds of the file that will actually sound: the clip window cut at the end of the file when
 * its length is known. `beyondEndSec` is how much of the clip falls after the file ends (0 when
 * it fits or the length is unknown).
 */
export function audioFileWindow(range: AudioClipRange, fileDurationMs: number | null | undefined): { fromSec: number, toSec: number | null, beyondEndSec: number } {
  const fileSec = fileDurationMs != null && fileDurationMs > 0 ? fileDurationMs / 1000 : null
  const fromSec = fileSec != null ? Math.min(range.startSec, fileSec) : range.startSec
  const wantedEnd = range.durationSec != null ? range.startSec + range.durationSec : null
  if (fileSec == null) return { fromSec, toSec: wantedEnd, beyondEndSec: 0 }
  const toSec = wantedEnd != null ? Math.min(wantedEnd, fileSec) : fileSec
  const beyondEndSec = wantedEnd != null ? Math.max(0, wantedEnd - fileSec) : 0
  return { fromSec, toSec, beyondEndSec }
}
