import type { OutputKind } from '~/types/catalog'

// The `stocka-show` v2 package: what the Raspberry Pi player executes. Format and rules are
// documented in `rpi4-system/contract/README.md` and validated by `app/utils/showValidate.ts`.

export const SHOW_FORMAT = 'stocka-show'
export const SHOW_VERSION = 2

export interface ShowMode {
  on: 'once' | 'loop' | 'pulse'
  cycles: number
}

/** One port as the device sees it: its kind, its pin when it has one, and its config keys. */
export type ShowHardwareEntry = { kind: OutputKind, pin?: number } & Record<string, unknown>

export interface ShowEvent {
  /** Milliseconds from the start of the cycle. */
  t: number
  /** Port name (unique per organization). */
  target: string
  action: string
  params: Record<string, unknown>
}

/** Where a file listed in `assets` comes from in Stocka (an attachment of a piece). */
export interface ShowAssetRef {
  /** The asset name used by the events: `<attachmentId>-<filename>`. */
  name: string
  kind: 'audio' | 'video'
  pieceId: number
  attachmentId: number
  mimeType: string
  sizeBytes: number
  durationMs: number | null
}

export interface ShowMeta {
  name: string
  timelineId: number | null
  exportedAt: string
  /** `sha256:` + hex digest of the canonical JSON of the show description (meta excluded). */
  hash: string
  /** Origin of every asset, when the editor knows it (outside the hash). */
  assets?: ShowAssetRef[]
}

export interface ShowPackage {
  format: typeof SHOW_FORMAT
  version: typeof SHOW_VERSION
  meta: ShowMeta
  board: string
  mode: ShowMode
  hardware: Record<string, ShowHardwareEntry>
  timeline: ShowEvent[]
  durationMs: number
  assets: { audio: string[], video: string[] }
}

export type ShowIssueLevel = 'error' | 'warning'

export interface ShowIssue {
  level: ShowIssueLevel
  code: string
  /** User-facing text (Catalan). */
  message: string
  clipId?: string
  port?: string
}

export function issue(level: ShowIssueLevel, code: string, message: string, extra?: { clipId?: string, port?: string }): ShowIssue {
  return { level, code, message, ...(extra ?? {}) }
}
