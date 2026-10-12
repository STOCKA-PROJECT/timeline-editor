import { describe, expect, it } from 'vitest'
import type { ShowPackage } from '~/types/show'
import { buildHardware } from '~/utils/showHardware'
import { validateShowPackage } from '~/utils/showValidate'
import sample from './fixtures/belen-2026.show.json'
import { ports } from './fixtures/belen2026'

function pkg(mutate: (p: ShowPackage) => void = () => {}): ShowPackage {
  const copy = JSON.parse(JSON.stringify(sample)) as ShowPackage
  mutate(copy)
  return copy
}

function codes(p: ShowPackage, level?: 'error' | 'warning') {
  return validateShowPackage(p).filter(i => !level || i.level === level).map(i => i.code)
}

describe('buildHardware', () => {
  it('keys entries by port name with kind, pin for kinds that have one, and config', () => {
    const { hardware, issues } = buildHardware(ports)
    expect(issues).toEqual([])
    expect(hardware).toEqual(sample.hardware)
    expect(hardware.Fondo1).not.toHaveProperty('pin')
    expect(hardware.Audio).toEqual({ kind: 'audio' })
  })

  it('drops pin/kind keys from config and reports unknown kinds', () => {
    const { hardware, issues } = buildHardware([
      { ...ports[0]!, config: { pin: 5, kind: 'x', extra: null } },
      { ...ports[1]!, kind: 'laser' as never }
    ])
    expect(hardware.Focos).toEqual({ kind: 'relay', pin: 27 })
    expect(issues.map(i => i.code)).toEqual(['E_KIND_UNKNOWN'])
  })
})

describe('validateShowPackage', () => {
  it('accepts the sample with no errors', () => {
    expect(codes(pkg(), 'error')).toEqual([])
    expect(codes(pkg(), 'warning')).toEqual([])
  })

  it('target missing, action unknown, parameter unknown', () => {
    expect(codes(pkg(p => { p.timeline[0]!.target = 'Pastoret' }))).toContain('E_TARGET_MISSING')
    expect(codes(pkg(p => { p.timeline[6]!.action = 'fill' }))).toContain('E_ACTION_UNKNOWN')
    expect(codes(pkg(p => { p.timeline[6]!.params = { volume: 3 } }))).toContain('E_PARAM_UNKNOWN')
    expect(codes(pkg(p => { p.timeline[9]!.params.speed = 2 }))).toContain('E_ANIMATION_PARAM')
    expect(codes(pkg(p => { p.timeline[9]!.params = { animation_type: 'fire', intensity: 0.5 } }), 'error')).toEqual([])
  })

  it('required and typed parameters, relative segment ranges', () => {
    expect(codes(pkg(p => { p.timeline[1]!.params = {} }))).toContain('E_PARAM_REQUIRED')
    expect(codes(pkg(p => { delete p.timeline[9]!.params.color }))).toContain('E_PARAM_REQUIRED')
    expect(codes(pkg(p => { p.timeline[1]!.params.color = '#ff3200' }))).toContain('E_PARAM_TYPE')
    expect(codes(pkg(p => { p.timeline[9]!.params.animation_type = 'disco' }))).toContain('E_PARAM_TYPE')
    expect(codes(pkg(p => { p.timeline[14]!.params.time = -1 }))).toContain('E_PARAM_TYPE')
    expect(codes(pkg(p => { p.timeline[10]!.params.first = 16; p.timeline[10]!.params.last = 19 }), 'error')).toEqual([])
    expect(codes(pkg(p => { p.timeline[10]!.params.first = 0; p.timeline[10]!.params.last = 28 }))).toContain('E_SEGMENT_RANGE')
  })

  it('time after the end and assets', () => {
    expect(codes(pkg(p => { p.durationMs = 100000 }))).toContain('E_T_AFTER_END')
    expect(codes(pkg(p => { p.assets.audio = [] }))).toContain('E_ASSET_UNLISTED')
    expect(codes(pkg(p => { p.assets.audio.push('silenci.mp3') }), 'warning')).toContain('W_ASSET_UNUSED')
  })

  it('pins: duplicates (strip, motor), reserved, pull-up warning, board range', () => {
    expect(codes(pkg(p => { p.hardware.Focos!.pin = 13 }))).toContain('E_PIN_DUPLICATE')
    expect(codes(pkg(p => { p.hardware.Angel = { kind: 'motor', pinR: 26, pinL: 4, sensorPin: 5, downTime: 10 } }))).toContain('E_PIN_DUPLICATE')
    expect(codes(pkg(p => { p.hardware.Angel = { kind: 'motor', pinR: 4, pinL: 4, sensorPin: 5, downTime: 10 } }))).toContain('E_CONFIG_INVALID')
    expect(codes(pkg(p => { p.hardware.Focos!.pin = 0 }))).toContain('E_PIN_RESERVED')
    expect(codes(pkg(p => { p.hardware.Focos!.pin = 40 }))).toContain('E_PIN_OUT_OF_BOARD')
    const pullup = pkg(p => { p.hardware.Focos!.pin = 6 })
    expect(codes(pullup, 'error')).toEqual([])
    expect(codes(pullup, 'warning')).toContain('W_PIN_PULLUP')
  })

  it('strips: WS281x pin, channel, DMA and PCM warnings', () => {
    expect(codes(pkg(p => { p.hardware.LedStrip3!.pin = 17 }))).toContain('E_WS281X_PIN')
    expect(codes(pkg(p => { p.hardware.LedStrip3!.channel = 0 }))).toContain('E_WS281X_CHANNEL')
    const dma = pkg(p => { p.hardware.LedStrip3!.dma = 7 })
    expect(codes(dma, 'error')).toEqual([])
    expect(codes(dma, 'warning')).toContain('W_DMA_AVOID')
    expect(codes(pkg(p => { p.hardware.LedStrip4!.pin = 21 }), 'warning')).toContain('W_PCM_AUDIO')
    const noAudio = pkg((p) => {
      p.hardware.LedStrip4!.pin = 21
      delete p.hardware.Audio
      p.timeline = p.timeline.filter(e => e.target !== 'Audio')
      p.assets.audio = []
    })
    expect(codes(noAudio, 'warning')).not.toContain('W_PCM_AUDIO')
  })

  it('segments: missing strip, non-strip reference, out of range, reversed ok', () => {
    expect(codes(pkg(p => { p.hardware.Fondo1!.strip = 'LedStrip9' }))).toContain('E_SEGMENT_STRIP_MISSING')
    expect(codes(pkg(p => { p.hardware.Fondo1!.strip = 'Focos' }))).toContain('E_SEGMENT_STRIP_MISSING')
    expect(codes(pkg(p => { p.hardware.CasaDoble!.last = 44 }))).toContain('E_SEGMENT_RANGE')
    expect(codes(pkg(), 'error')).not.toContain('E_SEGMENT_RANGE')
  })

  it('a strip is a whole-strip target with the LED actions and its own range', () => {
    const ok = pkg(p => { p.timeline.push({ t: 1000, target: 'LedStrip4', action: 'fill', params: { color: [1, 2, 3], first: 0, last: 43 } }) })
    expect(codes(ok, 'error')).toEqual([])
    const bad = pkg(p => { p.timeline.push({ t: 2000, target: 'LedStrip4', action: 'animate', params: { animation_type: 'fire', first: 0, last: 44 } }) })
    expect(codes(bad)).toContain('E_SEGMENT_RANGE')
    expect(codes(pkg(p => { p.timeline.push({ t: 1000, target: 'LedStrip4', action: 'turn_on', params: {} }) }))).toContain('E_ACTION_UNKNOWN')
  })

  it('config: required keys and types, unknown kind', () => {
    expect(codes(pkg(p => { delete p.hardware.LedStrip3!.length }))).toContain('E_CONFIG_INVALID')
    expect(codes(pkg(p => { p.hardware.LedStrip3!.dma = '10' }))).toContain('E_CONFIG_INVALID')
    expect(codes(pkg(p => { delete p.hardware.Focos!.pin }))).toContain('E_CONFIG_INVALID')
    expect(codes(pkg(p => { p.hardware.X = { kind: 'laser' as never } }))).toContain('E_KIND_UNKNOWN')
  })

  it('warnings: unused piece ports, fade from black, overlapping animations, legacy singletons', () => {
    const unused = pkg((p) => {
      p.hardware.Pastoret = { kind: 'relay', pin: 22 }
      p.hardware.LedStrip1 = { kind: 'led_strip', pin: 21, dma: 7, channel: 0, length: 60 }
    })
    const msgs = validateShowPackage(unused).filter(i => i.code === 'W_PORT_UNUSED').map(i => i.port)
    expect(msgs).toEqual(['Pastoret'])
    expect(codes(pkg(p => { delete p.timeline[9]!.params.from_color }), 'warning')).toContain('W_FADE_FROM_BLACK')
    const overlap = pkg((p) => {
      p.timeline.push({ t: 26000, target: 'Fondo1', action: 'animate', params: { animation_type: 'stars' } })
      p.timeline.push({ t: 27000, target: 'Fondo1', action: 'animate', params: { animation_type: 'fire', duration: 5 } })
    })
    expect(validateShowPackage(overlap).filter(i => i.code === 'W_OVERLAP_CONTINUOUS').length).toBeGreaterThanOrEqual(2)
    expect(codes(pkg(p => { p.hardware.Audio2 = { kind: 'audio' } }), 'warning')).toContain('W_LEGACY_SINGLE')
  })
})
