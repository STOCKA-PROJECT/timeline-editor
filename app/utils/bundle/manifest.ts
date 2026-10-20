import type { ShowPackage } from '~/types/show'

// `manifest.json` of a `stocka-bundle` v1 package: what the zip holds and how the Raspberry Pi
// verifies it without network. The schema is `rpi4-system/contract/bundle/bundle.schema.json`;
// `app/data/bundle.schema.json` is a byte-identical copy (same policy as `catalog.json`).

export const BUNDLE_FORMAT = 'stocka-bundle'
export const BUNDLE_VERSION = 1

export type BundleFileKind = 'show' | 'audio'

export interface BundleFileEntry {
  /** `show.json` or `assets/<kind>/<asset name>`. */
  path: string
  /** Lowercase hex SHA-256 of the bytes as stored in the zip. */
  sha256: string
  size: number
  kind: BundleFileKind
}

export interface BundleManifest {
  format: typeof BUNDLE_FORMAT
  version: typeof BUNDLE_VERSION
  /** Identity of the show: `meta.hash` of `show.json` (the Pi recomputes it on import). */
  show: { hash: string, name: string, timelineId: number | null, board: string }
  files: BundleFileEntry[]
  /** ISO-8601 UTC with seconds and `Z`, e.g. `2026-10-20T18:00:00Z`. */
  createdAt: string
  createdBy: string
  /** Present (and true) only when the Pi should activate the show as soon as it is imported. */
  activate?: true
}

export interface BuildManifestOptions {
  createdBy: string
  /** Clock for `createdAt`; injectable for deterministic tests. */
  now?: Date
  activate?: boolean
}

/** `2026-10-20T18:00:00Z`: what Python's `isoformat(timespec="seconds")` writes for a UTC time. */
export function formatCreatedAt(date: Date): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/** Same keys, same order and same optional `activate` as `build_manifest` in the Python tool. */
export function buildManifest(pkg: ShowPackage, files: BundleFileEntry[], options: BuildManifestOptions): BundleManifest {
  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    show: {
      hash: pkg.meta.hash,
      name: pkg.meta.name,
      timelineId: pkg.meta.timelineId ?? null,
      board: pkg.board
    },
    files,
    createdAt: formatCreatedAt(options.now ?? new Date()),
    createdBy: options.createdBy
  }
  if (options.activate) manifest.activate = true
  return manifest
}

/** Pretty-printed with two spaces and a trailing newline, like the Python tool writes it. */
export function serializeManifest(manifest: BundleManifest): string {
  return JSON.stringify(manifest, null, 2) + '\n'
}
