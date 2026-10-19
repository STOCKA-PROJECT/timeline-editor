import type { ShowPackage } from '~/types/show'

// Name of a `.belen.zip`: `<slug of the show name>-<first 8 hex of the hash>.belen.zip`, the same
// rule as `slugify` and `bundle_file_name` in `rpi4-system/tools/bundle_tool.py`, so the editor,
// the backend and the Python tool name the same package the same way.

export const BUNDLE_EXTENSION = '.belen.zip'

/** Lowercase; every run of anything but `[a-z0-9]` becomes `-`; trimmed; `show` when nothing is left. */
export function slugify(name: string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return slug || 'show'
}

/** The 8 hex digits after `sha256:`, enough to tell packages apart at a glance. */
export function shortHash(hash: string): string {
  return hash.slice('sha256:'.length, 'sha256:'.length + 8)
}

export function bundleFileName(pkg: Pick<ShowPackage, 'meta'>): string {
  return `${slugify(pkg.meta.name)}-${shortHash(pkg.meta.hash)}${BUNDLE_EXTENSION}`
}
