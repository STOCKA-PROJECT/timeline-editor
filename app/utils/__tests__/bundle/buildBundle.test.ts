import { mkdirSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import schema from '~/data/bundle.schema.json'
import type { ShowAssetRef, ShowPackage } from '~/types/show'
import {
  BundleBuildError,
  buildBundle,
  planBundleFiles,
  sha256HexOf,
  showJsonBytes,
  type BundleProgress
} from '~/utils/bundle/buildBundle'
import { buildShowPackage } from '~/utils/showPackage'
import sample from '../fixtures/belen-2026.show.json'
import * as fx from '../fixtures/belen2026'
import { schemaErrors } from './schemaCheck'
import { zipEntries } from './zipInspect'

// Same fake audio as rpi4-system/tests/test_bundle.py (b"ID3fake-mp3-bytes" * 100).
const AUDIO_BYTES = new TextEncoder().encode('ID3fake-mp3-bytes'.repeat(100))
const NOW = new Date('2026-10-20T18:00:00Z')
const NATURE: ShowAssetRef = {
  name: 'nature.mp3', kind: 'audio', pieceId: 8, attachmentId: 12,
  mimeType: 'audio/mpeg', sizeBytes: AUDIO_BYTES.length, durationMs: 61000
}
const STORED = 0
const DEFLATE = 8

/** The shared sample with the origin of its only asset filled in (`meta` is outside the hash). */
function samplePkg(): ShowPackage {
  const pkg = structuredClone(sample) as ShowPackage
  pkg.meta.assets = [NATURE]
  return pkg
}

function bytesOf(ref: ShowAssetRef): ArrayBuffer {
  if (ref.attachmentId !== 12) throw new Error(`unexpected attachment ${ref.attachmentId}`)
  return AUDIO_BYTES.slice().buffer
}
const fetchAsset = async (ref: ShowAssetRef) => bytesOf(ref)

async function hex(bytes: Uint8Array): Promise<string> {
  return sha256HexOf(bytes)
}

describe('buildBundle', () => {
  it('names the file like the Python tool and writes a manifest the contract accepts', async () => {
    const pkg = samplePkg()
    const { manifest, fileName } = await buildBundle({ pkg, fetchAsset, now: NOW })
    expect(fileName).toBe('pessebre-2026-mostra-48a434c0.belen.zip')
    expect(manifest.format).toBe('stocka-bundle')
    expect(manifest.version).toBe(1)
    expect(manifest.show).toEqual({ hash: pkg.meta.hash, name: 'Pessebre 2026 (mostra)', timelineId: null, board: 'rpi4b' })
    expect(manifest.files.map(f => [f.path, f.kind])).toEqual([['show.json', 'show'], ['assets/audio/nature.mp3', 'audio']])
    expect(manifest.createdAt).toBe('2026-10-20T18:00:00Z')
    expect(manifest.createdBy).toBe('timeline-editor')
    expect(manifest).not.toHaveProperty('activate')
    expect(schemaErrors(manifest, schema)).toEqual([])
  })

  it('puts the manifest first, deflates the JSON and stores the assets', async () => {
    const { bytes } = await buildBundle({ pkg: samplePkg(), fetchAsset, now: NOW })
    const entries = zipEntries(bytes)
    expect(entries.map(e => e.name)).toEqual(['manifest.json', 'show.json', 'assets/audio/nature.mp3'])
    expect(entries[0]!.offset).toBe(0)
    expect(entries.map(e => e.method)).toEqual([DEFLATE, DEFLATE, STORED])
    const audio = entries[2]!
    expect(audio.size).toBe(AUDIO_BYTES.length)
    expect(audio.compressedSize).toBe(AUDIO_BYTES.length)
    expect(entries[1]!.compressedSize).toBeLessThan(entries[1]!.size)
  })

  it('lists every file with the sha256 and size of the bytes actually in the zip', async () => {
    const { bytes, manifest } = await buildBundle({ pkg: samplePkg(), fetchAsset, now: NOW })
    const unzipped = unzipSync(bytes)
    expect(Object.keys(unzipped).sort()).toEqual(['assets/audio/nature.mp3', 'manifest.json', 'show.json'])
    for (const entry of manifest.files) {
      const content = unzipped[entry.path]!
      expect(content.length, entry.path).toBe(entry.size)
      expect(await hex(content), entry.path).toBe(entry.sha256)
    }
    expect(unzipped['assets/audio/nature.mp3']).toEqual(AUDIO_BYTES)
    expect(manifest.files[1]!.sha256).toBe(await hex(AUDIO_BYTES))
    const manifestText = strFromU8(unzipped['manifest.json']!)
    expect(manifestText.endsWith('\n')).toBe(true)
    expect(JSON.parse(manifestText)).toEqual(manifest)
  })

  it('show.json round-trips to the same package and is the pretty-printed export plus a newline', async () => {
    const pkg = samplePkg()
    const { bytes, manifest } = await buildBundle({ pkg, fetchAsset, now: NOW })
    const text = strFromU8(unzipSync(bytes)['show.json']!)
    expect(JSON.parse(text)).toEqual(pkg)
    expect(text).toBe(JSON.stringify(pkg, null, 2) + '\n')
    expect(manifest.files[0]).toEqual({ path: 'show.json', kind: 'show', size: showJsonBytes(pkg).length, sha256: await hex(showJsonBytes(pkg)) })
    // The hash the Pi recomputes is the one both the show and the manifest carry.
    expect(JSON.parse(text).meta.hash).toBe(manifest.show.hash)
  })

  it('returns a zip blob with the very same bytes', async () => {
    const { blob, bytes } = await buildBundle({ pkg: samplePkg(), fetchAsset, now: NOW })
    expect(blob.type).toBe('application/zip')
    expect(blob.size).toBe(bytes.length)
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(bytes)
  })

  it('reports progress before and after every file, show.json included', async () => {
    const pkg = samplePkg()
    const events: BundleProgress[] = []
    await buildBundle({ pkg, fetchAsset, now: NOW, onProgress: e => events.push(e) })
    const showSize = showJsonBytes(pkg).length
    expect(events).toEqual([
      { file: 'show.json', index: 0, total: 2, loaded: 0, size: showSize },
      { file: 'show.json', index: 0, total: 2, loaded: showSize, size: showSize },
      { file: 'assets/audio/nature.mp3', index: 1, total: 2, loaded: 0, size: AUDIO_BYTES.length },
      { file: 'assets/audio/nature.mp3', index: 1, total: 2, loaded: AUDIO_BYTES.length, size: AUDIO_BYTES.length }
    ])
  })

  it('passes activate and createdBy through to the manifest', async () => {
    const { manifest } = await buildBundle({ pkg: samplePkg(), fetchAsset, now: NOW, createdBy: 'test', activate: true })
    expect(manifest.createdBy).toBe('test')
    expect(manifest.activate).toBe(true)
    expect(schemaErrors(manifest, schema)).toEqual([])
  })

  it('stamps the current time when no clock is given', async () => {
    const before = Date.now()
    const { manifest } = await buildBundle({ pkg: samplePkg(), fetchAsset })
    expect(Date.parse(manifest.createdAt)).toBeGreaterThanOrEqual(before - 1000)
  })

  it('zips only the manifest and the show when the show references no assets', async () => {
    const pkg = samplePkg()
    pkg.assets = { audio: [] }
    pkg.meta.assets = []
    const calls: ShowAssetRef[] = []
    const { bytes, manifest } = await buildBundle({ pkg, fetchAsset: async (ref) => { calls.push(ref); return bytesOf(ref) }, now: NOW })
    expect(calls).toEqual([])
    expect(manifest.files.map(f => f.path)).toEqual(['show.json'])
    expect(zipEntries(bytes).map(e => e.name)).toEqual(['manifest.json', 'show.json'])
    expect(schemaErrors(manifest, schema)).toEqual([])
  })

  it('covers several audio assets in the order the show lists them', async () => {
    const pkg = samplePkg()
    const night: ShowAssetRef = { name: '13-night.mp3', kind: 'audio', pieceId: 9, attachmentId: 13, mimeType: 'audio/mpeg', sizeBytes: 4, durationMs: null }
    pkg.assets = { audio: ['nature.mp3', '13-night.mp3'] }
    pkg.meta.assets = [night, NATURE]
    const { bytes, manifest } = await buildBundle({
      pkg,
      fetchAsset: async ref => (ref.name === '13-night.mp3' ? new Uint8Array([1, 2, 3, 4]).buffer : bytesOf(ref)),
      now: NOW
    })
    expect(manifest.files.map(f => [f.path, f.kind, f.size])).toEqual([
      ['show.json', 'show', showJsonBytes(pkg).length],
      ['assets/audio/nature.mp3', 'audio', AUDIO_BYTES.length],
      ['assets/audio/13-night.mp3', 'audio', 4]
    ])
    expect(zipEntries(bytes).map(e => e.method)).toEqual([DEFLATE, DEFLATE, STORED, STORED])
    expect(schemaErrors(manifest, schema)).toEqual([])
  })

  describe('refusals', () => {
    it('an asset whose origin the package does not know', async () => {
      const pkg = structuredClone(sample) as ShowPackage
      expect(pkg.meta.assets).toBeUndefined()
      await expect(buildBundle({ pkg, fetchAsset })).rejects.toThrow(BundleBuildError)
      await expect(buildBundle({ pkg, fetchAsset })).rejects.toThrow(/nature\.mp3/)
      expect(() => planBundleFiles(pkg)).toThrow(/d'àudio «nature\.mp3»/)
    })

    it('a reference under another name does not count', async () => {
      const pkg = samplePkg()
      pkg.meta.assets = [{ ...NATURE, name: '12-nature.mp3' }]
      await expect(buildBundle({ pkg, fetchAsset })).rejects.toThrow(/nature\.mp3/)
      pkg.meta.assets = [NATURE]
      pkg.assets.audio = ['nature.mp3', '9-x.mp3']
      expect(() => planBundleFiles(pkg)).toThrow(/d'àudio «9-x\.mp3»/)
    })

    it('a download shorter or longer than the attachment says', async () => {
      const pkg = samplePkg()
      await expect(buildBundle({ pkg, fetchAsset: async () => new Uint8Array(10).buffer })).rejects.toThrow(/incomplet \(10 de 1700 bytes\)/)
      await expect(buildBundle({ pkg, fetchAsset: async () => new Uint8Array(1701).buffer })).rejects.toThrow(BundleBuildError)
    })

    it('an unknown size is not checked', async () => {
      const pkg = samplePkg()
      pkg.meta.assets = [{ ...NATURE, sizeBytes: 0 }]
      const { manifest } = await buildBundle({ pkg, fetchAsset, now: NOW })
      expect(manifest.files[1]!.size).toBe(AUDIO_BYTES.length)
    })

    it('a failed download surfaces as is and nothing is reported as loaded', async () => {
      const events: BundleProgress[] = []
      const boom = new Error('HTTP 503')
      await expect(buildBundle({ pkg: samplePkg(), fetchAsset: async () => { throw boom }, onProgress: e => events.push(e) })).rejects.toBe(boom)
      expect(events.at(-1)).toMatchObject({ file: 'assets/audio/nature.mp3', loaded: 0 })
    })
  })

  describe('from the editor document', () => {
    const nature = { id: 12, kind: 'AUDIO' as const, originalFilename: 'nature.mp3', mimeType: 'audio/mpeg', sizeBytes: AUDIO_BYTES.length, durationMs: 61000, createdAt: '' }

    it('bundles the package buildShowPackage produces, with the origins it recorded', async () => {
      const doc = fx.document()
      doc.clips.find(c => c.id === 'c06')!.paramValues = { audio_name: '12-nature.mp3' }
      const { pkg, errors } = await buildShowPackage({ doc, catalog: fx.catalogLookups, orgPorts: fx.ports, ...fx.META, audioByPiece: { 8: [nature] } })
      expect(errors).toEqual([])
      const seen: ShowAssetRef[] = []
      const { manifest, fileName, bytes } = await buildBundle({ pkg: pkg!, fetchAsset: async (ref) => { seen.push(ref); return bytesOf(ref) }, now: NOW })
      expect(seen.map(r => [r.pieceId, r.attachmentId])).toEqual([[8, 12]])
      expect(manifest.files.map(f => f.path)).toEqual(['show.json', 'assets/audio/12-nature.mp3'])
      expect(fileName).toMatch(/^pessebre-2026-mostra-[0-9a-f]{8}\.belen\.zip$/)
      expect(fileName).toBe(`pessebre-2026-mostra-${pkg!.meta.hash.slice(7, 15)}.belen.zip`)
      expect(JSON.parse(strFromU8(unzipSync(bytes)['show.json']!))).toEqual(pkg)
      expect(schemaErrors(manifest, schema)).toEqual([])
    })

    it('a package exported without the audio files loaded cannot be bundled', async () => {
      const { pkg } = await buildShowPackage({ doc: fx.document(), catalog: fx.catalogLookups, orgPorts: fx.ports, ...fx.META })
      expect(pkg!.meta.assets).toBeUndefined()
      await expect(buildBundle({ pkg: pkg!, fetchAsset })).rejects.toThrow(/nature\.mp3/)
    })
  })

  // `WRITE_FIXTURES=1 pnpm test` leaves the zip for rpi4-system (`python -m tools.bundle_tool inspect`).
  it.runIf(process.env.WRITE_FIXTURES === '1')('writes the interop fixture for the Python importer', async () => {
    const { bytes, fileName } = await buildBundle({ pkg: samplePkg(), fetchAsset, now: NOW })
    const dir = fileURLToPath(new URL('../fixtures/generated/', import.meta.url))
    mkdirSync(dir, { recursive: true })
    writeFileSync(`${dir}belen-2026.belen.zip`, bytes)
    writeFileSync(`${dir}${fileName}`, bytes)
    expect(bytes.length).toBeGreaterThan(0)
  })
})
