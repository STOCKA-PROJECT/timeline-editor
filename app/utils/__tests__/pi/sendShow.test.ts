import { strFromU8, unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'
import type { ShowAssetRef, ShowPackage } from '~/types/show'
import { PiApiError, type PiBundles, type PiClient, type PiImportReport } from '~/utils/pi/piClient'
import { sendShowToPi, type SendPhase } from '~/utils/pi/sendShow'
import sample from '../fixtures/belen-2026.show.json'

const AUDIO = new TextEncoder().encode('ID3fake-mp3-bytes'.repeat(100))
const NATURE: ShowAssetRef = { name: 'nature.mp3', kind: 'audio', pieceId: 8, attachmentId: 12, mimeType: 'audio/mpeg', sizeBytes: AUDIO.length, durationMs: 61000 }

function pkg(): ShowPackage {
  const p = structuredClone(sample) as ShowPackage
  p.meta.assets = [NATURE]
  return p
}

/** Fake Pi with the bits of PiClient the send uses. */
function fakePi(opts: { bundles?: Partial<PiBundles>, audio?: string[], upload?: (bytes: Uint8Array, activate: boolean) => Promise<PiImportReport> } = {}) {
  const calls: string[] = []
  let uploaded: Uint8Array | null = null
  const client = {
    async bundles() { calls.push('bundles'); return { active: null, previous: null, shows: [], ...opts.bundles } },
    async assets() { calls.push('assets'); return { audio: opts.audio ?? [] } },
    async activate(hash: string) { calls.push(`activate ${hash}`); return {} },
    async uploadBundle(bytes: Uint8Array, name: string, o: { activate?: boolean, onProgress?: (p: { sent: number, total: number }) => void }) {
      calls.push(`upload ${name} activate=${Boolean(o.activate)}`)
      uploaded = bytes
      o.onProgress?.({ sent: bytes.length, total: bytes.length })
      if (opts.upload) return opts.upload(bytes, Boolean(o.activate))
      return { ok: true, hash: sample.meta.hash, name: 'x', errors: [], warnings: [], imported: ['show.json'], skipped: [], activated: Boolean(o.activate) }
    }
  } as unknown as PiClient
  return { client, calls, uploaded: () => uploaded }
}

const fetchAsset = async () => AUDIO.slice().buffer

describe('sendShowToPi', () => {
  it('a show the Pi already stores is only activated', async () => {
    const pi = fakePi({ bundles: { shows: [{ hash: sample.meta.hash, name: 'x', size: 1, importedAt: '', active: false, previous: false }] } })
    const result = await sendShowToPi({ client: pi.client, pkg: pkg(), fetchAsset, activate: true })
    expect(result).toEqual({ status: 'already', hash: sample.meta.hash, activated: true })
    expect(pi.calls).toContain(`activate ${sample.meta.hash}`)
    expect(pi.calls.some(c => c.startsWith('upload'))).toBe(false)
  })

  it('already stored and active: nothing to do', async () => {
    const pi = fakePi({ bundles: { active: sample.meta.hash, shows: [{ hash: sample.meta.hash, name: 'x', size: 1, importedAt: '', active: true, previous: false }] } })
    const result = await sendShowToPi({ client: pi.client, pkg: pkg(), fetchAsset, activate: true })
    expect(result).toMatchObject({ status: 'already', activated: true })
    expect(pi.calls.filter(c => c.startsWith('activate'))).toEqual([])
  })

  it('already stored without activation: reports it inactive', async () => {
    const pi = fakePi({ bundles: { shows: [{ hash: sample.meta.hash, name: 'x', size: 1, importedAt: '', active: false, previous: false }] } })
    expect(await sendShowToPi({ client: pi.client, pkg: pkg(), fetchAsset, activate: false })).toMatchObject({ activated: false })
  })

  it('a new show goes up with its audio when the Pi lacks it', async () => {
    const pi = fakePi()
    const phases: SendPhase[] = []
    const result = await sendShowToPi({ client: pi.client, pkg: pkg(), fetchAsset, activate: true, onPhase: p => phases.push(p) })
    expect(result).toMatchObject({ status: 'sent', skippedAssets: [] })
    expect(Object.keys(unzipSync(pi.uploaded()!)).sort()).toEqual(['assets/audio/nature.mp3', 'manifest.json', 'show.json'])
    expect(phases).toEqual(['checking', 'building', 'uploading', 'importing'])
    expect(pi.calls.at(-1)).toMatch(/^upload .*\.belen\.zip activate=true$/)
  })

  it('audio the Pi already has stays home', async () => {
    let fetched = 0
    const pi = fakePi({ audio: ['nature.mp3', 'unrelated.mp3'] })
    const result = await sendShowToPi({ client: pi.client, pkg: pkg(), fetchAsset: async () => { fetched++; return AUDIO.slice().buffer }, activate: false })
    expect(result).toMatchObject({ status: 'sent', skippedAssets: ['nature.mp3'] })
    expect(fetched).toBe(0)
    const files = unzipSync(pi.uploaded()!)
    expect(Object.keys(files).sort()).toEqual(['manifest.json', 'show.json'])
    expect(JSON.parse(strFromU8(files['manifest.json']!)).activate).toBeUndefined()
  })

  it('a package the Pi refuses (422) comes back as rejected with its report', async () => {
    const report = { ok: false, hash: null, name: null, errors: [{ code: 'E_X', message: 'no' }], warnings: [], imported: [], skipped: [], activated: false }
    const pi = fakePi({ upload: async () => { throw new PiApiError(422, 'http_422', 'x', report as unknown as Record<string, unknown>) } })
    expect(await sendShowToPi({ client: pi.client, pkg: pkg(), fetchAsset, activate: true })).toEqual({ status: 'rejected', report })
  })

  it('other failures propagate', async () => {
    const pi = fakePi({ upload: async () => { throw new PiApiError(0, 'unreachable', 'lost') } })
    await expect(sendShowToPi({ client: pi.client, pkg: pkg(), fetchAsset, activate: true })).rejects.toMatchObject({ code: 'unreachable' })
  })
})
