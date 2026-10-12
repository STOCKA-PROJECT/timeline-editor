import { describe, expect, it } from 'vitest'
import type { PieceAttachmentResponseDto, PieceTypeActionResponseDto } from '~/types/api'
import {
  assetNameFor,
  attachmentIdFromAssetName,
  audioClipRange,
  audioFileWindow,
  findAudioByAssetName,
  formatClock,
  isAudioPlay,
  safeAssetFilename
} from '~/utils/audioAssets'

const att = (id: number, name: string, durationMs: number | null = 61000): PieceAttachmentResponseDto =>
  ({ id, kind: 'AUDIO', originalFilename: name, mimeType: 'audio/mpeg', sizeBytes: 1, durationMs, createdAt: '' })

function play(parameters: PieceTypeActionResponseDto['parameters']): PieceTypeActionResponseDto {
  return { id: 31, name: 'play', displayName: 'Reproduir', position: 1, parameters }
}
const AUDIO_NAME = { name: 'audio_name', displayName: 'Fitxer', type: 'TEXT' as const, required: true, dynamic: true }
const START = { name: 'start', displayName: 'Inici', type: 'DECIMAL' as const, required: false, dynamic: true }
const TIME = { name: 'time', displayName: 'Temps', type: 'DECIMAL' as const, required: false, dynamic: true, isDuration: true }

describe('asset names', () => {
  it('makes the file name safe like the backend keys do', () => {
    expect(safeAssetFilename('Nit d\'Estels (final).MP3')).toBe('nit_d_estels__final_.mp3')
    expect(safeAssetFilename('  ')).toBe('file')
    expect(safeAssetFilename(null)).toBe('file')
  })

  it('prefixes the attachment id so the name is unique and traceable', () => {
    expect(assetNameFor(att(12, 'nature.mp3'))).toBe('12-nature.mp3')
    expect(assetNameFor(att(7, 'Cançó.wav'))).toBe('7-can__.wav')
  })

  it('reads the id back from the name and tolerates anything else', () => {
    expect(attachmentIdFromAssetName('12-nature.mp3')).toBe(12)
    expect(attachmentIdFromAssetName(' 3-x ')).toBe(3)
    expect(attachmentIdFromAssetName('nature.mp3')).toBeNull()
    expect(attachmentIdFromAssetName('')).toBeNull()
    expect(attachmentIdFromAssetName(12)).toBeNull()
    expect(attachmentIdFromAssetName(null)).toBeNull()
  })

  it('finds the attachment an asset name points at', () => {
    const list = [att(12, 'nature.mp3'), att(13, 'night.mp3')]
    expect(findAudioByAssetName(list, '13-night.mp3')?.id).toBe(13)
    expect(findAudioByAssetName(list, '13-renamed.mp3')?.id).toBe(13)
    expect(findAudioByAssetName(list, '14-gone.mp3')).toBeUndefined()
    expect(findAudioByAssetName(list, 'nature.mp3')).toBeUndefined()
  })

  it('only audio.play names a file', () => {
    expect(isAudioPlay('audio', 'play')).toBe(true)
    expect(isAudioPlay('audio', 'stop')).toBe(false)
    expect(isAudioPlay('relay', 'play')).toBe(false)
    expect(isAudioPlay(null, 'play')).toBe(false)
  })
})

describe('audioClipRange', () => {
  it('uses the dynamic start and the clip length when time is the duration parameter', () => {
    const range = audioClipRange({ durationMs: 12500, paramValues: { start: 2.5 } }, play([AUDIO_NAME, START, TIME]))
    expect(range).toEqual({ startSec: 2.5, durationSec: 12.5 })
  })

  it('starts at 0 when start is missing, blank, negative or not a number', () => {
    const action = play([AUDIO_NAME, START, TIME])
    for (const start of [undefined, null, '', -3, 'abc']) {
      expect(audioClipRange({ durationMs: 1000, paramValues: { start } }, action).startSec).toBe(0)
    }
  })

  it('takes a fixed start from the type and a fixed time when it is not the duration', () => {
    const action = play([
      AUDIO_NAME,
      { ...START, dynamic: false, staticValue: '4' },
      { ...TIME, isDuration: false, dynamic: false, staticValue: '9' }
    ])
    expect(audioClipRange({ durationMs: 1000, paramValues: {} }, action)).toEqual({ startSec: 4, durationSec: 9 })
  })

  it('plays until the end of the file when there is no time parameter or it is empty', () => {
    expect(audioClipRange({ durationMs: 1000, paramValues: {} }, play([AUDIO_NAME])).durationSec).toBeNull()
    const dynamicTime = play([AUDIO_NAME, { ...TIME, isDuration: false }])
    expect(audioClipRange({ durationMs: 1000, paramValues: { time: '' } }, dynamicTime).durationSec).toBeNull()
    expect(audioClipRange({ durationMs: 1000, paramValues: { time: 0 } }, dynamicTime).durationSec).toBeNull()
    expect(audioClipRange({ durationMs: 1000, paramValues: { time: '7.5' } }, dynamicTime).durationSec).toBe(7.5)
  })
})

describe('audioFileWindow', () => {
  it('cuts the window at the end of the file and reports what runs past it', () => {
    expect(audioFileWindow({ startSec: 50, durationSec: 20 }, 61000)).toEqual({ fromSec: 50, toSec: 61, beyondEndSec: 9 })
    expect(audioFileWindow({ startSec: 10, durationSec: 20 }, 61000)).toEqual({ fromSec: 10, toSec: 30, beyondEndSec: 0 })
  })

  it('runs to the end of the file when there is no duration', () => {
    expect(audioFileWindow({ startSec: 10, durationSec: null }, 61000)).toEqual({ fromSec: 10, toSec: 61, beyondEndSec: 0 })
  })

  it('cannot check anything when the file length is unknown', () => {
    expect(audioFileWindow({ startSec: 10, durationSec: 20 }, null)).toEqual({ fromSec: 10, toSec: 30, beyondEndSec: 0 })
    expect(audioFileWindow({ startSec: 10, durationSec: null }, undefined)).toEqual({ fromSec: 10, toSec: null, beyondEndSec: 0 })
  })

  it('clamps a start past the end of the file', () => {
    expect(audioFileWindow({ startSec: 90, durationSec: 5 }, 61000)).toEqual({ fromSec: 61, toSec: 61, beyondEndSec: 34 })
  })
})

describe('formatClock', () => {
  it('formats m:ss and h:mm:ss, dash when unknown', () => {
    expect(formatClock(61000)).toBe('1:01')
    expect(formatClock(0)).toBe('0:00')
    expect(formatClock(3661000)).toBe('1:01:01')
    expect(formatClock(null)).toBe('—')
    expect(formatClock(-5)).toBe('—')
  })
})
