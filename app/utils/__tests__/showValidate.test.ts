import { describe, expect, it } from 'vitest'
import type { ShowPackage } from '~/types/show'
import { buildHardware } from '~/utils/showHardware'
import { validateShowPackage } from '~/utils/showValidate'
import sample from './fixtures/belen-2026.show.json'
import complet from './fixtures/pessebre-2026-complet.show.json'
import { ports } from './fixtures/belen2026'

function pkg(mutate: (p: ShowPackage) => void = () => {}): ShowPackage {
  const copy = JSON.parse(JSON.stringify(sample)) as ShowPackage
  mutate(copy)
  return copy
}

function codes(p: ShowPackage, level?: 'error' | 'warning') {
  return validateShowPackage(p).filter(i => !level || i.level === level).map(i => i.code)
}

/** The complete 2026 sample (expander relays, two moving heads, the angel), optionally mutated. */
function full(mutate: (p: ShowPackage) => void = () => {}): ShowPackage {
  const copy = JSON.parse(JSON.stringify(complet)) as ShowPackage
  mutate(copy)
  return copy
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

  it('fade waypoints must be a list of colours', () => {
    expect(codes(pkg(p => { p.timeline[9]!.params.waypoints = [[10, 0, 60], [255, 255, 0]] }), 'error')).toEqual([])
    expect(codes(pkg(p => { p.timeline[9]!.params.waypoints = [] }), 'error')).toEqual([])
    expect(codes(pkg(p => { p.timeline[9]!.params.waypoints = [[10, 0, 60], '#ff0'] }))).toContain('E_PARAM_TYPE')
    expect(codes(pkg(p => { p.timeline[9]!.params.waypoints = [10, 0, 60] }))).toContain('E_PARAM_TYPE')
    expect(codes(pkg(p => { p.timeline[10]!.params = { animation_type: 'fire', waypoints: [[1, 2, 3]] } }))).toContain('E_ANIMATION_PARAM')
  })

  it('time after the end and assets', () => {
    expect(codes(pkg(p => { p.durationMs = 100000 }))).toContain('E_T_AFTER_END')
    expect(codes(pkg(p => { p.assets.audio = [] }))).toContain('E_ASSET_UNLISTED')
    expect(codes(pkg(p => { p.assets.audio.push('silenci.mp3') }), 'warning')).toContain('W_ASSET_UNUSED')
  })

  it('pins: duplicates (strip, motor), reserved, pull-up warning, board range', () => {
    expect(codes(pkg(p => { p.hardware.Focos!.pin = 13 }))).toContain('E_PIN_DUPLICATE')
    expect(codes(pkg(p => { p.hardware.Angel = { kind: 'motor', pinR: 26, pinL: 4, sensorPin: 5, downTime: 10, maxUpTime: 13 } }))).toContain('E_PIN_DUPLICATE')
    expect(codes(pkg(p => { p.hardware.Angel = { kind: 'motor', pinR: 4, pinL: 4, sensorPin: 5, downTime: 10, maxUpTime: 13 } }))).toContain('E_CONFIG_INVALID')
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

describe('validateShowPackage · contract v3 (expanders, moving heads, motor)', () => {
  it('accepts the complete 2026 sample with no errors', () => {
    expect(codes(full(), 'error')).toEqual([])
    expect(codes(full(), 'warning')).not.toContain('W_PORT_UNUSED')
  })

  it('relays: a pin or expander + channel, never both; activeLow only on native relays', () => {
    expect(codes(full(p => { p.hardware.Estable!.pin = 22 }))).toContain('E_CONFIG_INVALID')
    expect(codes(full(p => { delete p.hardware.Estable!.channel }))).toContain('E_CONFIG_INVALID')
    expect(codes(full(p => { p.hardware.Sembra = { kind: 'relay' } }))).toContain('E_CONFIG_INVALID')
    expect(codes(full(p => { p.hardware.Sembra!.channel = 2 }))).toContain('E_CONFIG_INVALID')
    expect(codes(full(p => { p.hardware.Estable!.activeLow = true }))).toContain('E_CONFIG_INVALID')
    expect(codes(full(p => { p.hardware.Sembra!.activeLow = true }), 'error')).toEqual([])
    expect(codes(full(p => { p.hardware.Audio!.pin = 5 }))).toContain('E_CONFIG_INVALID')
  })

  it('expanders: existing reference, unique channel, unique I2C address per bus, GPIO 2/3 reserved', () => {
    expect(codes(full(p => { p.hardware.Estable!.expander = 'exp9' }))).toContain('E_EXPANDER_MISSING')
    expect(codes(full(p => { p.hardware.Estable!.expander = 'Sembra' }))).toContain('E_EXPANDER_MISSING')
    expect(codes(full(p => { p.hardware.Pou!.channel = 3 }))).toContain('E_EXPANDER_CHANNEL_DUPLICATE')
    expect(codes(full(p => { p.hardware.exp2 = { kind: 'gpio_expander', chip: 'mcp23017', bus: 1, address: 32 } }))).toContain('E_I2C_ADDRESS_DUPLICATE')
    expect(codes(full(p => { p.hardware.exp2 = { kind: 'gpio_expander', chip: 'mcp23017', bus: 0, address: 32 } }))).not.toContain('E_I2C_ADDRESS_DUPLICATE')
    expect(codes(full(p => { p.hardware.Sembra!.pin = 2 }))).toContain('E_PIN_RESERVED')
    const noExpander = pkg(p => { p.hardware.Sembra!.pin = 3 })
    expect(codes(noExpander, 'error')).not.toContain('E_PIN_RESERVED')
    expect(codes(noExpander, 'warning')).toContain('W_PIN_PULLUP')
  })

  it('moving heads: inside the universe, no overlaps, physical units, empty cue warns', () => {
    expect(codes(full(p => { p.hardware.Foco2!.address = 500 }))).toContain('E_DMX_ADDRESS_RANGE')
    expect(codes(full(p => { p.hardware.Foco2!.address = 498 }))).not.toContain('E_DMX_ADDRESS_RANGE')
    expect(codes(full(p => { p.hardware.Foco2!.address = 15 }))).toContain('E_DMX_ADDRESS_OVERLAP')
    expect(codes(full(p => { p.hardware.Foco2!.address = 16 }))).not.toContain('E_DMX_ADDRESS_OVERLAP')
    const cue = (p: ShowPackage) => p.timeline.find(e => e.target === 'Foco' && e.action === 'set')!
    expect(codes(full(p => { cue(p).params.pan = 541 }))).toContain('E_PARAM_TYPE')
    expect(codes(full(p => { cue(p).params.zoom = 5 }))).toContain('E_PARAM_TYPE')
    expect(codes(full(p => { cue(p).params.strobe = 1 }))).toContain('E_PARAM_UNKNOWN')
    const empty = full(p => { p.timeline.push({ t: 1000, target: 'Foco', action: 'set', params: { time: 2 } }) })
    expect(codes(empty, 'error')).toEqual([])
    expect(codes(empty, 'warning')).toContain('W_EMPTY_CUE')
  })

  it('motor: maxUpTime required, start_up within it, a short one warns', () => {
    expect(codes(full(p => { delete p.hardware.Angel!.maxUpTime }))).toContain('E_CONFIG_INVALID')
    const up = (p: ShowPackage) => p.timeline.find(e => e.action === 'start_up')!
    expect(codes(full(p => { up(p).params.time = 25 }))).toContain('E_MOTOR_UP_TIME')
    expect(codes(full(p => { up(p).params.time = 24 }))).not.toContain('E_MOTOR_UP_TIME')
    const short = full(p => { p.hardware.Angel!.maxUpTime = 10 })
    expect(codes(short, 'error')).toEqual([])
    expect(codes(short, 'warning')).toContain('W_MOTOR_UP_TIME_SHORT')
  })

  it('the projector is gone: video kind and focoOn are unknown', () => {
    expect(codes(pkg(p => { p.hardware.Video = { kind: 'video' as never } }))).toContain('E_KIND_UNKNOWN')
    expect(codes(pkg(p => { p.timeline[0]!.action = 'focoOn' }))).toContain('E_ACTION_UNKNOWN')
  })
})
