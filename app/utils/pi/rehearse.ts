import type { ShowAssetRef, ShowPackage } from '~/types/show'
import { PiApiError, type PiClient, type PiIssue, type PiStatus } from '~/utils/pi/piClient'

// «Prova a la Raspberry»: the Pi plays a range of the show as it is in the editor right now, without
// storing it (rpi4-system `POST /api/rehearsal`). Only the show's JSON travels; an audio file the Pi
// lacks goes first, on its own (`PUT /api/assets/audio/{name}`).

export interface RehearsalRange {
  fromMs: number
  /** null = until the end of the show. */
  toMs: number | null
  loop: boolean
}

export type RehearseResult =
  | { status: 'started', piStatus: PiStatus, uploaded: string[] }
  | { status: 'rejected', errors: PiIssue[] }

export interface RehearseInput {
  client: PiClient
  pkg: ShowPackage
  range: RehearsalRange
  fetchAsset: (ref: ShowAssetRef) => Promise<ArrayBuffer>
  onUpload?: (name: string) => void
}

/** Thrown when the Pi has no rehearsal endpoint (a player older than this editor). */
export class RehearsalUnsupportedError extends Error {
  constructor() {
    super('Aquesta Raspberry encara no sap fer assajos: actualitza-la.')
    this.name = 'RehearsalUnsupportedError'
  }
}

export async function rehearseOnPi(input: RehearseInput): Promise<RehearseResult> {
  const { client, pkg } = input
  const uploaded: string[] = []
  const onPi = new Set((await client.assets()).audio ?? [])
  await upload(input, pkg.assets.audio.filter(name => !onPi.has(name)), uploaded)
  try {
    return { status: 'started', piStatus: await client.rehearse(pkg, input.range), uploaded }
  } catch (error) {
    if (!(error instanceof PiApiError)) throw error
    if (error.status === 404 && error.code === 'http_404') throw new RehearsalUnsupportedError()
    if (error.status === 422) return { status: 'rejected', errors: ((error.body?.errors as PiIssue[] | undefined) ?? []) }
    if (error.code === 'missing_assets') {
      // The Pi's list was stale (a file deleted meanwhile): send what it says it lacks and try once more.
      const missing = ((error.body?.missing as Record<string, string[]> | undefined)?.audio ?? []).filter(n => !uploaded.includes(n))
      if (missing.length === 0) throw error
      await upload(input, missing, uploaded)
      return { status: 'started', piStatus: await client.rehearse(pkg, input.range), uploaded }
    }
    throw error
  }
}

async function upload(input: RehearseInput, names: string[], uploaded: string[]): Promise<void> {
  const refs = new Map((input.pkg.meta.assets ?? []).map(ref => [ref.name, ref]))
  for (const name of names) {
    const ref = refs.get(name)
    if (!ref) throw new Error(`No se sap d’on surt el fitxer «${name}»: no es pot enviar a la Raspberry.`)
    input.onUpload?.(name)
    await input.client.putAsset('audio', name, new Uint8Array(await input.fetchAsset(ref)))
    uploaded.push(name)
  }
}

/** One line for a motor the Pi does not move in the rehearsal, and why. */
export function skippedMotorText(m: { target: string, reason: string, forward: number, reverse: number }): string {
  if (m.reason === 'cut') return `${m.target}: un clip queda tallat pel tram`
  return `${m.target}: ${m.forward} «Girar» i ${m.reverse} «Girar (invertit)»`
}

/**
 * Where the Pi's playhead is now: its last `cycleMs` plus the time since that status arrived, kept
 * inside the range (wrapping around when it loops, until the next status corrects it).
 */
export function rehearsalPlayheadMs(range: { fromMs: number, toMs: number, loop: boolean }, cycleMs: number, elapsedMs: number): number {
  const span = range.toMs - range.fromMs
  let ms = cycleMs + Math.max(0, elapsedMs)
  if (ms >= range.toMs) ms = range.loop && span > 0 ? range.fromMs + ((ms - range.fromMs) % span) : range.toMs
  return Math.max(range.fromMs, ms)
}
