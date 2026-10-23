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
    expect(codes(pkg(p => { p.hardware.Angel = { kind: 'motor', pinForward: 26, pinReverse: 4, maxTimeForward: 13, maxTimeReverse: 10 } }))).toContain('E_PIN_DUPLICATE')
    expect(codes(pkg(p => { p.hardware.Angel = { kind: 'motor', pinForward: 4, pinReverse: 4, maxTimeForward: 13, maxTimeReverse: 10 } }))).toContain('E_PIN_DUPLICATE')
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
    // The player drives any number of motors: two motors are no longer a legacy warning.
    expect(codes(full(), 'warning')).not.toContain('W_LEGACY_SINGLE')
  })
})

describe('validateShowPackage · contract v3 (expanders, moving heads, motors, sensors)', () => {
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

  it('motor: both max times required; a clip over one is an error, or a warning with a limit sensor', () => {
    expect(codes(full(p => { delete p.hardware.Angel!.maxTimeForward }))).toContain('E_CONFIG_INVALID')
    expect(codes(full(p => { delete p.hardware.Noria!.maxTimeReverse }))).toContain('E_CONFIG_INVALID')
    // The sample's Angel forward clip (30 s) is longer than maxTimeForward (24) but has a limit sensor.
    expect(codes(full(), 'warning')).toContain('W_MOTOR_TIME_CAPPED')
    expect(codes(full(p => { delete p.hardware.Angel!.limitForward }))).toContain('E_MOTOR_TIME')
    const rev = (p: ShowPackage) => p.timeline.find(e => e.target === 'Angel' && e.action === 'reverse')!
    expect(codes(full(p => { rev(p).params.time = 19 }))).toContain('E_MOTOR_TIME')
    expect(codes(full(p => { rev(p).params.time = 18 }))).not.toContain('E_MOTOR_TIME')
    expect(codes(full(p => { delete rev(p).params.time }), 'error')).toEqual([])
    expect(codes(full(p => { rev(p).action = 'start_down' }))).toContain('E_ACTION_UNKNOWN')
  })

  it('motor outputs: both native pins, or the expander with two distinct channels', () => {
    expect(codes(full(p => { delete p.hardware.Angel!.pinReverse }))).toContain('E_MOTOR_OUTPUTS')
    expect(codes(full(p => { p.hardware.Angel!.channelForward = 1 }))).toContain('E_MOTOR_OUTPUTS')
    expect(codes(full(p => { p.hardware.Noria!.pinForward = 5 }))).toContain('E_MOTOR_OUTPUTS')
    expect(codes(full(p => { delete p.hardware.Noria!.channelReverse }))).toContain('E_MOTOR_OUTPUTS')
    expect(codes(full(p => { p.hardware.Noria!.channelReverse = 6 }))).toContain('E_MOTOR_OUTPUTS')
    expect(codes(full(p => { p.hardware.Noria!.activeLow = true }))).toContain('E_MOTOR_OUTPUTS')
    expect(codes(full(p => { p.hardware.Angel!.activeLow = true }), 'error')).toEqual([])
    const message = validateShowPackage(full(p => { delete p.hardware.Angel!.pinReverse })).find(i => i.code === 'E_MOTOR_OUTPUTS')!
    expect(message.port).toBe('Angel')
    expect(message.message).toContain('necessita pinForward i pinReverse')
  })

  it('motor channels share the expander with relays and sensors; motor pins are GPIO pins', () => {
    const relay = validateShowPackage(full(p => { p.hardware.Estable!.channel = 7 })).find(i => i.code === 'E_EXPANDER_CHANNEL_DUPLICATE')!
    expect(relay.message).toContain('Estable, Noria.channelReverse')
    expect(codes(full(p => { p.hardware.PortaCaixa!.channel = 6 }))).toContain('E_EXPANDER_CHANNEL_DUPLICATE')
    expect(codes(full(p => { p.hardware.Noria!.expander = 'exp9' }))).toContain('E_EXPANDER_MISSING')
    expect(codes(full(p => { p.hardware.Angel!.pinForward = 3 }))).toContain('E_PIN_RESERVED')
    expect(codes(full(p => { p.hardware.Angel!.pinForward = 23 }))).toContain('E_PIN_DUPLICATE')
  })

  it('limits must name sensor ports', () => {
    expect(codes(full(p => { p.hardware.Angel!.limitForward = 'Fantasma' }))).toContain('E_SENSOR_MISSING')
    expect(codes(full(p => { p.hardware.Angel!.limitReverse = 'Sembra' }))).toContain('E_SENSOR_MISSING')
    expect(codes(full(p => { p.hardware.Angel!.limitReverse = 'Seta' }), 'error')).toEqual([])
  })

  it('sensors: pin or expander + channel, own polarity, no pull down on an expander, known onActive, no actions', () => {
    expect(codes(full(p => { p.hardware.PortaCaixa!.pin = 24 }))).toContain('E_CONFIG_INVALID')
    expect(codes(full(p => { delete p.hardware.PortaCaixa!.channel }))).toContain('E_CONFIG_INVALID')
    expect(codes(full(p => { delete p.hardware.Seta!.pin }))).toContain('E_CONFIG_INVALID')
    expect(codes(full(p => { p.hardware.Seta!.channel = 1 }))).toContain('E_CONFIG_INVALID')
    expect(codes(full(p => { p.hardware.PortaCaixa!.activeLow = false; p.hardware.PortaCaixa!.pull = 'none' }), 'error')).toEqual([])
    expect(codes(full(p => { p.hardware.PortaCaixa!.pull = 'down' }))).toContain('E_CONFIG_INVALID')
    expect(codes(full(p => { p.hardware.Seta!.pull = 'down' }), 'error')).toEqual([])
    expect(codes(full(p => { p.hardware.Seta!.onActive = 'explode' }))).toContain('E_CONFIG_INVALID')
    expect(codes(full(p => { p.hardware.Seta!.debounceMs = 2001 }))).toContain('E_CONFIG_INVALID')
    expect(codes(full(p => { p.timeline.push({ t: 1000, target: 'Seta', action: 'press', params: {} }) }))).toContain('E_ACTION_UNKNOWN')
  })

  it('a sensor without onActive that no motor uses warns; limits and onActive sensors do not', () => {
    const issues = validateShowPackage(full(p => { p.hardware.Solt = { kind: 'sensor', pin: 24 } }))
    expect(issues.filter(i => i.code === 'W_SENSOR_UNUSED').map(i => i.port)).toEqual(['Solt'])
    expect(codes(full(), 'warning')).not.toContain('W_SENSOR_UNUSED')
    expect(codes(full(p => { delete p.hardware.Angel!.limitForward }), 'warning')).toContain('W_SENSOR_UNUSED')
  })

  it('the projector is gone: video kind and focoOn are unknown', () => {
    expect(codes(pkg(p => { p.hardware.Video = { kind: 'video' as never } }))).toContain('E_KIND_UNKNOWN')
    expect(codes(pkg(p => { p.timeline[0]!.action = 'focoOn' }))).toContain('E_ACTION_UNKNOWN')
  })
})

describe('validateShowPackage · measured sensors', () => {
  const laser = { kind: 'sensor', source: 'measured', model: 'vl53l0x', threshold: 25, activeWhen: 'below', onActive: 'panic' } as const
  function messages(p: ShowPackage) {
    return validateShowPackage(p).map(i => i.message)
  }

  it('accepts every model with its own wiring, also as a motor limit', () => {
    expect(codes(full((p) => {
      p.hardware.Laser = { ...laser, hysteresis: 2, pollMs: 200 }
      p.hardware.Sonar = { kind: 'sensor', source: 'measured', model: 'hc-sr04', pinTrig: 5, pinEcho: 6, threshold: 30, activeWhen: 'below', onActive: 'panic' }
      p.hardware.Termo = { kind: 'sensor', source: 'measured', model: 'ds18b20', pin: 4, deviceId: '28-0123456789ab', threshold: 40, activeWhen: 'above', onActive: 'panic' }
      p.hardware.Humitat = { kind: 'sensor', source: 'measured', model: 'bme280', quantity: 'humidity', address: 119, threshold: 80, activeWhen: 'above', onActive: 'panic' }
      p.hardware.AngelDalt = { kind: 'sensor', source: 'measured', model: 'bme280', quantity: 'temperature', threshold: 30, activeWhen: 'above' }
    }), 'error')).toEqual([])
  })

  it('reports each inconsistency as E_SENSOR_CONFIG with the messages of validate.py', () => {
    const p = full((p) => {
      p.hardware.A = { ...laser, pin: 9, pull: 'up', address: 48, threshold: 500 }
      p.hardware.B = { kind: 'sensor', source: 'measured', model: 'bme280', threshold: 10, onActive: 'panic' }
      p.hardware.C = { kind: 'sensor', source: 'measured', model: 'hc-sr04', pinTrig: 5, pinEcho: 5, threshold: 30, activeWhen: 'below', onActive: 'panic' }
      p.hardware.D = { kind: 'sensor', source: 'measured', model: 'ds18b20', deviceId: '10-abc', threshold: 30, activeWhen: 'above', onActive: 'panic' }
      p.hardware.E = { kind: 'sensor', source: 'measured', threshold: 1, activeWhen: 'above', onActive: 'panic' }
      p.hardware.F = { kind: 'sensor', pin: 9, threshold: 3, onActive: 'panic' }
      p.hardware.G = { ...laser, quantity: 'temperature' }
    })
    expect(messages(p)).toEqual(expect.arrayContaining([
      'El sensor «A»: «pull» és d\'un sensor digital.',
      'El sensor «A»: «pin» no correspon al cablejat i2c del model vl53l0x.',
      'El sensor «A»: el model vl53l0x només admet l\'adreça I2C 0x29.',
      'El sensor «A»: «threshold» ha d\'estar entre 3 i 200 cm.',
      'El sensor «B»: necessita «quantity»: el model bme280 mesura temperature, humidity, pressure.',
      'El sensor «B»: necessita «activeWhen» (above o below).',
      'El sensor «C»: «pinTrig» i «pinEcho» han de ser diferents.',
      'El sensor «D»: necessita «pin» (la línia DATA del 1-Wire).',
      'El sensor «D»: «deviceId» ha de ser 28- seguit de 12 dígits hexadecimals.',
      'El sensor «E»: necessita un «model» de profiles.sensor.',
      'El sensor «F»: «threshold» només té sentit amb source measured.',
      'El sensor «G»: el model vl53l0x no mesura temperature (mesura distance).',
    ]))
  })

  it('TRIG/ECHO pins are pins; an I2C sensor reserves GPIO 2/3 and shares the address space', () => {
    expect(messages(full((p) => {
      p.hardware.Sonar = { kind: 'sensor', source: 'measured', model: 'hc-sr04', pinTrig: 5, pinEcho: 26, threshold: 30, activeWhen: 'below', onActive: 'panic' }
    }))).toContain('El pin 26 està usat per més d\'un port: Sembra, Sonar.pinEcho.')
    const i2c = pkg((p) => {
      p.hardware.Calor = { kind: 'sensor', source: 'measured', model: 'bme280', quantity: 'temperature', threshold: 30, activeWhen: 'above', onActive: 'panic' }
      p.hardware.Pressio = { kind: 'sensor', source: 'measured', model: 'bme280', quantity: 'pressure', threshold: 1000, activeWhen: 'below', onActive: 'panic' }
      p.hardware.Sembra = { kind: 'relay', pin: 3 }
    })
    expect(messages(i2c)).toEqual(expect.arrayContaining([
      'El pin 3 de «Sembra» és I2C i queda reservat quan hi ha un expansor o un sensor I2C.',
      'L\'adreça I2C 0x76 del bus 1 la fan servir més d\'un dispositiu: Calor, Pressio.',
    ]))
  })
})

describe('validateShowPackage · relay double pulse', () => {
  /** The Pou event of the complete sample: double_pulse(0.3, 0.2, 0.3). */
  function doublePulse(p: ShowPackage) {
    return p.timeline.find(e => e.action === 'double_pulse')!
  }

  it('the complete sample carries a valid double pulse', () => {
    expect(doublePulse(full()).params).toEqual({ first_press: 0.3, gap: 0.2, second_press: 0.3 })
    expect(codes(full(p => { doublePulse(p).params = { first_press: 5, gap: 0, second_press: 1 } }), 'error')).toEqual([])
  })

  it.each(['first_press', 'gap', 'second_press'])('requires %s', (missing) => {
    const issues = validateShowPackage(full(p => { delete doublePulse(p).params[missing] })).filter(i => i.level === 'error')
    expect(issues.map(i => i.code)).toEqual(['E_PARAM_REQUIRED'])
    expect(issues[0]!.message).toContain(`«${missing}»`)
  })

  it.each([-0.1, '0.2', true, null])('rejects gap = %s', (value) => {
    expect(codes(full(p => { doublePulse(p).params.gap = value }), 'error')).toContain('E_PARAM_TYPE')
  })

  it('has no duration parameter and the old pulse action is gone', () => {
    expect(codes(full(p => { doublePulse(p).params.duration = 0.5 }), 'error')).toContain('E_PARAM_UNKNOWN')
    expect(codes(full(p => { const e = doublePulse(p); e.action = 'pulse'; e.params = { duration: 0.5 } }), 'error')).toContain('E_ACTION_UNKNOWN')
  })
})
