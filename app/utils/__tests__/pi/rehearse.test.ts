import { describe, expect, it } from 'vitest'
import type { ShowAssetRef, ShowPackage } from '~/types/show'
import { PiApiError, type PiClient, type PiStatus } from '~/utils/pi/piClient'
import { RehearsalUnsupportedError, rehearsalPlayheadMs, rehearseOnPi, skippedMotorText } from '~/utils/pi/rehearse'
import sample from '../fixtures/belen-2026.show.json'

const AUDIO = new TextEncoder().encode('ID3fake')
const NATURE: ShowAssetRef = { name: 'nature.mp3', kind: 'audio', pieceId: 8, attachmentId: 12, mimeType: 'audio/mpeg', sizeBytes: AUDIO.length, durationMs: 61000 }
const RANGE = { fromMs: 26000, toMs: 40000, loop: true }
const STATUS = { state: 'PLAYING', rehearsal: { fromMs: 26000 } } as unknown as PiStatus

function pkg(assets: ShowAssetRef[] | undefined = [NATURE]): ShowPackage {
  const p = structuredClone(sample) as ShowPackage
  p.meta.assets = assets
  return p
}

/** Fake Pi: `answers` are what successive `rehearse` calls do (a status or an error to throw). */
function fakePi(opts: { audio?: string[], answers?: Array<PiStatus | Error> } = {}) {
  const calls: string[] = []
  const answers = [...(opts.answers ?? [STATUS])]
  const client = {
    async assets() { calls.push('assets'); return { audio: opts.audio ?? [] } },
    async putAsset(kind: string, name: string, bytes: Uint8Array) { calls.push(`put ${kind}/${name} ${bytes.length}`); return { kind, name, stored: true } },
    async rehearse(p: ShowPackage, range: unknown) {
      calls.push(`rehearse ${p.meta.hash.slice(0, 15)} ${JSON.stringify(range)}`)
      const answer = answers.shift()
      if (answer instanceof Error) throw answer
      return answer
    }
  } as unknown as PiClient
  return { client, calls }
}

const fetchAsset = async () => AUDIO.slice().buffer

describe('rehearseOnPi', () => {
  it('sends the audio the Pi lacks, then the range', async () => {
    const pi = fakePi()
    const uploads: string[] = []
    const result = await rehearseOnPi({ client: pi.client, pkg: pkg(), range: RANGE, fetchAsset, onUpload: n => uploads.push(n) })
    expect(result).toEqual({ status: 'started', piStatus: STATUS, uploaded: ['nature.mp3'] })
    expect(pi.calls).toEqual(['assets', `put audio/nature.mp3 ${AUDIO.length}`, `rehearse ${sample.meta.hash.slice(0, 15)} ${JSON.stringify(RANGE)}`])
    expect(uploads).toEqual(['nature.mp3'])
  })

  it('a Pi that has every file only gets the show', async () => {
    const pi = fakePi({ audio: ['nature.mp3', 'other.mp3'] })
    const result = await rehearseOnPi({ client: pi.client, pkg: pkg(), range: RANGE, fetchAsset })
    expect(result).toMatchObject({ status: 'started', uploaded: [] })
    expect(pi.calls.filter(c => c.startsWith('put'))).toEqual([])
  })

  it('a file of unknown origin cannot be sent', async () => {
    const pi = fakePi()
    await expect(rehearseOnPi({ client: pi.client, pkg: pkg([]), range: RANGE, fetchAsset })).rejects.toThrow(/nature\.mp3/)
    expect(pi.calls).toEqual(['assets'])
  })

  it('a show the Pi refuses comes back with its errors', async () => {
    const refused = new PiApiError(422, 'http_422', 'x', { ok: false, errors: [{ code: 'E_SCHEMA', message: 'malament' }] })
    const result = await rehearseOnPi({ client: fakePi({ audio: ['nature.mp3'], answers: [refused] }).client, pkg: pkg(), range: RANGE, fetchAsset })
    expect(result).toEqual({ status: 'rejected', errors: [{ code: 'E_SCHEMA', message: 'malament' }] })
  })

  it('a 422 without a report is still a rejection', async () => {
    const result = await rehearseOnPi({ client: fakePi({ audio: ['nature.mp3'], answers: [new PiApiError(422, 'http_422', 'x')] }).client, pkg: pkg(), range: RANGE, fetchAsset })
    expect(result).toEqual({ status: 'rejected', errors: [] })
  })

  it('an old Pi without the endpoint asks to be updated', async () => {
    const pi = fakePi({ audio: ['nature.mp3'], answers: [new PiApiError(404, 'http_404', 'Not Found')] })
    await expect(rehearseOnPi({ client: pi.client, pkg: pkg(), range: RANGE, fetchAsset })).rejects.toBeInstanceOf(RehearsalUnsupportedError)
  })

  it('a 404 with its own code is not mistaken for an old Pi', async () => {
    const pi = fakePi({ audio: ['nature.mp3'], answers: [new PiApiError(404, 'unknown_target', 'x')] })
    await expect(rehearseOnPi({ client: pi.client, pkg: pkg(), range: RANGE, fetchAsset })).rejects.toMatchObject({ code: 'unknown_target' })
  })

  it('files missing after all are sent and the range is tried once more', async () => {
    const missing = new PiApiError(409, 'missing_assets', 'x', { missing: { audio: ['nature.mp3'] } })
    const pi = fakePi({ audio: ['nature.mp3'], answers: [missing, STATUS] })
    const result = await rehearseOnPi({ client: pi.client, pkg: pkg(), range: RANGE, fetchAsset })
    expect(result).toMatchObject({ status: 'started', uploaded: ['nature.mp3'] })
    expect(pi.calls.filter(c => c.startsWith('rehearse'))).toHaveLength(2)
  })

  it('a missing file it already sent is not sent twice', async () => {
    const missing = new PiApiError(409, 'missing_assets', 'x', { missing: { audio: ['nature.mp3'] } })
    const pi = fakePi({ answers: [missing] })
    await expect(rehearseOnPi({ client: pi.client, pkg: pkg(), range: RANGE, fetchAsset })).rejects.toBe(missing)
    expect(pi.calls.filter(c => c.startsWith('put'))).toHaveLength(1)
  })

  it('other errors pass through', async () => {
    const busy = new PiApiError(409, 'rehearsal', 'ocupada')
    await expect(rehearseOnPi({ client: fakePi({ audio: ['nature.mp3'], answers: [busy] }).client, pkg: pkg(), range: RANGE, fetchAsset })).rejects.toBe(busy)
    const boom = new Error('boom')
    await expect(rehearseOnPi({ client: fakePi({ audio: ['nature.mp3'], answers: [boom] }).client, pkg: pkg(), range: RANGE, fetchAsset })).rejects.toBe(boom)
  })
})

describe('rehearsalPlayheadMs', () => {
  const range = { fromMs: 10_000, toMs: 20_000, loop: false }

  it('adds the time since the last status', () => {
    expect(rehearsalPlayheadMs(range, 12_000, 300)).toBe(12_300)
  })

  it('stops at the end of a range without loop', () => {
    expect(rehearsalPlayheadMs(range, 19_900, 500)).toBe(20_000)
  })

  it('wraps around when the range loops', () => {
    expect(rehearsalPlayheadMs({ ...range, loop: true }, 19_900, 500)).toBe(10_400)
  })

  it('never goes before the start (a status from just before the range)', () => {
    expect(rehearsalPlayheadMs(range, 0, 0)).toBe(10_000)
  })

  it('ignores a negative elapsed time', () => {
    expect(rehearsalPlayheadMs(range, 15_000, -50)).toBe(15_000)
  })
})

describe('skippedMotorText', () => {
  it('names a cut clip', () => {
    expect(skippedMotorText({ target: 'Àngel', reason: 'cut', forward: 1, reverse: 1 })).toBe('Àngel: un clip queda tallat pel tram')
  })

  it('counts unbalanced turns', () => {
    expect(skippedMotorText({ target: 'Àngel', reason: 'unbalanced', forward: 2, reverse: 1 })).toBe('Àngel: 2 «Girar» i 1 «Girar (invertit)»')
  })
})
