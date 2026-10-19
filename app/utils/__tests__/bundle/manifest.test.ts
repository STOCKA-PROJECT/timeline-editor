import { describe, expect, it } from 'vitest'
import schema from '~/data/bundle.schema.json'
import type { ShowPackage } from '~/types/show'
import {
  BUNDLE_FORMAT,
  BUNDLE_VERSION,
  buildManifest,
  formatCreatedAt,
  serializeManifest,
  type BundleFileEntry
} from '~/utils/bundle/manifest'
import sample from '../fixtures/belen-2026.show.json'
import { schemaErrors } from './schemaCheck'

const pkg = sample as ShowPackage
const NOW = new Date('2026-10-20T18:00:00.123Z')
const SHA = 'a'.repeat(64)
const files: BundleFileEntry[] = [
  { path: 'show.json', sha256: SHA, size: 5770, kind: 'show' },
  { path: 'assets/audio/12-nature.mp3', sha256: 'b'.repeat(64), size: 3773952, kind: 'audio' },
  { path: 'assets/video/3-intro.mp4', sha256: 'c'.repeat(64), size: 10, kind: 'video' }
]

describe('buildManifest', () => {
  it('describes the show and lists the files in order', () => {
    const manifest = buildManifest(pkg, files, { createdBy: 'timeline-editor', now: NOW })
    expect(manifest).toEqual({
      format: 'stocka-bundle',
      version: 1,
      show: { hash: pkg.meta.hash, name: 'Pessebre 2026 (mostra)', timelineId: null, board: 'rpi4b' },
      files,
      createdAt: '2026-10-20T18:00:00Z',
      createdBy: 'timeline-editor'
    })
    expect(manifest.files.map(f => f.kind)).toEqual(['show', 'audio', 'video'])
  })

  it('keeps the key order of the Python tool so both manifests read the same', () => {
    const manifest = buildManifest(pkg, files, { createdBy: 'x', now: NOW, activate: true })
    expect(Object.keys(manifest)).toEqual(['format', 'version', 'show', 'files', 'createdAt', 'createdBy', 'activate'])
    expect(Object.keys(manifest.show)).toEqual(['hash', 'name', 'timelineId', 'board'])
  })

  it('carries the timeline id when the show has one', () => {
    const withId = { ...pkg, meta: { ...pkg.meta, timelineId: 12 } }
    expect(buildManifest(withId, files, { createdBy: 'x', now: NOW }).show.timelineId).toBe(12)
  })

  it('adds activate only when asked for', () => {
    expect(buildManifest(pkg, files, { createdBy: 'x', now: NOW })).not.toHaveProperty('activate')
    expect(buildManifest(pkg, files, { createdBy: 'x', now: NOW, activate: false })).not.toHaveProperty('activate')
    expect(buildManifest(pkg, files, { createdBy: 'x', now: NOW, activate: true }).activate).toBe(true)
  })

  it('stamps the current time when no clock is given', () => {
    const before = Date.now()
    const manifest = buildManifest(pkg, files, { createdBy: 'x' })
    const stamped = Date.parse(manifest.createdAt)
    expect(stamped).toBeGreaterThanOrEqual(before - 1000)
    expect(stamped).toBeLessThanOrEqual(Date.now() + 1000)
    expect(manifest.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)
  })

  it('exposes the format constants the contract fixes', () => {
    expect(BUNDLE_FORMAT).toBe('stocka-bundle')
    expect(BUNDLE_VERSION).toBe(1)
  })
})

describe('formatCreatedAt', () => {
  it('writes ISO-8601 UTC with seconds and a Z, no milliseconds', () => {
    expect(formatCreatedAt(NOW)).toBe('2026-10-20T18:00:00Z')
    expect(formatCreatedAt(new Date('2026-01-05T09:08:07.999Z'))).toBe('2026-01-05T09:08:07Z')
  })

  it('converts a local time to UTC', () => {
    expect(formatCreatedAt(new Date(Date.UTC(2026, 11, 24, 23, 59, 59, 500)))).toBe('2026-12-24T23:59:59Z')
  })
})

describe('serializeManifest', () => {
  it('pretty-prints with two spaces and ends with a newline, and re-parses to the same object', () => {
    const manifest = buildManifest(pkg, files, { createdBy: 'x', now: NOW })
    const text = serializeManifest(manifest)
    expect(text.endsWith('}\n')).toBe(true)
    expect(text).toContain('\n  "format": "stocka-bundle",\n')
    expect(text).toContain('\n    "hash": "sha256:')
    expect(JSON.parse(text)).toEqual(manifest)
  })
})

describe('against app/data/bundle.schema.json', () => {
  it('a built manifest satisfies the contract schema', () => {
    expect(schemaErrors(buildManifest(pkg, files, { createdBy: 'timeline-editor', now: NOW }), schema)).toEqual([])
    expect(schemaErrors(buildManifest(pkg, files, { createdBy: 'x', now: NOW, activate: true }), schema)).toEqual([])
  })

  it('the checker itself rejects what the contract forbids (so the pass above means something)', () => {
    const ok = buildManifest(pkg, files, { createdBy: 'x', now: NOW })
    expect(schemaErrors({}, schema)).not.toEqual([])
    expect(schemaErrors({ ...ok, version: 2 }, schema)).toContainEqual(expect.stringContaining('$.version'))
    expect(schemaErrors({ ...ok, extra: 1 }, schema)).toContainEqual('$: unexpected extra')
    expect(schemaErrors({ ...ok, show: { ...ok.show, hash: 'sha256:xyz' } }, schema)).toContainEqual(expect.stringContaining('$.show.hash'))
    expect(schemaErrors({ ...ok, files: [] }, schema)).toContainEqual(expect.stringContaining('$.files'))
    expect(schemaErrors({ ...ok, files: [{ ...files[0]!, path: '../etc/passwd' }] }, schema)).toContainEqual(expect.stringContaining('$.files[0].path'))
    expect(schemaErrors({ ...ok, files: [{ ...files[0]!, path: 'assets/image/x.png' }] }, schema)).toContainEqual(expect.stringContaining('$.files[0].path'))
    expect(schemaErrors({ ...ok, files: [{ ...files[0]!, sha256: 'ABC' }] }, schema)).toContainEqual(expect.stringContaining('$.files[0].sha256'))
    expect(schemaErrors({ ...ok, files: [{ ...files[0]!, size: -1 }] }, schema)).toContainEqual(expect.stringContaining('$.files[0].size'))
    expect(schemaErrors({ ...ok, files: [{ ...files[0]!, kind: 'image' }] }, schema)).toContainEqual(expect.stringContaining('$.files[0].kind'))
    expect(schemaErrors({ ...ok, createdAt: 'ahir' }, schema)).toContainEqual(expect.stringContaining('$.createdAt'))
    expect(schemaErrors({ ...ok, createdBy: '' }, schema)).toContainEqual(expect.stringContaining('$.createdBy'))
    expect(schemaErrors({ ...ok, activate: 'yes' }, schema)).toContainEqual(expect.stringContaining('$.activate'))
    expect(schemaErrors({ ...ok, show: { ...ok.show, timelineId: 'x' } }, schema)).toContainEqual(expect.stringContaining('$.show.timelineId'))
  })
})
