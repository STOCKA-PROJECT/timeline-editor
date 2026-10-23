import { actionParams, catalog as defaultCatalog, movingHeadProfile, pinModeOf, requiredParams, sensorProfile, type CatalogParam, type OutputCatalog, type SensorProfile } from '~/types/catalog'
import { issue, type ShowIssue, type ShowPackage } from '~/types/show'

// Semantic rules of a stocka-show package, mirroring `rpi4-system/contract/validate.py`. Runs on
// the assembled package, so an imported or hand-edited package gets the same checks the device
// will apply. The schema (structure) is the device's job; here we assume a well-formed object.

type Hardware = ShowPackage['hardware']

const I2C_PINS = [2, 3]
const DMX_UNIVERSE = 512
const MOTOR_PIN_KEYS = ['pinForward', 'pinReverse'] as const
const MOTOR_CHANNEL_KEYS = ['channelForward', 'channelReverse'] as const
const MOTOR_LIMIT_KEYS = ['limitForward', 'limitReverse'] as const
const SENSOR_PIN_KEYS = ['pinTrig', 'pinEcho'] as const
/** Keys only a `measured` sensor carries, and keys only a `digital` one carries. */
const SENSOR_MEASURED_KEYS = ['model', 'quantity', 'bus', 'address', 'pinTrig', 'pinEcho', 'deviceId', 'threshold', 'activeWhen', 'hysteresis', 'pollMs']
const SENSOR_DIGITAL_KEYS = ['expander', 'channel', 'activeLow', 'pull']
/** Wiring of a sensor profile → connection keys it accepts (the rest of SENSOR_WIRING_KEYS are extra). */
const SENSOR_WIRING: Record<SensorProfile['wiring'], string[]> = { i2c: ['bus', 'address'], onewire: ['pin', 'deviceId'], trig_echo: ['pinTrig', 'pinEcho'] }
const SENSOR_WIRING_KEYS = ['pin', 'bus', 'address', 'deviceId', 'pinTrig', 'pinEcho']
const ONEWIRE_ID = /^28-[0-9a-f]{12}$/
/** Direction of a motor action → [hard-cut key, limit-switch key]. */
const MOTOR_DIRECTIONS: Record<string, [string, string]> = {
  forward: ['maxTimeForward', 'limitForward'],
  reverse: ['maxTimeReverse', 'limitReverse'],
}

/**
 * Strict type check of a value already in package form (no coercion: the device reads it as is).
 * Returns the problem, or null when the value fits. Mirrors `check_value` in validate.py.
 */
/** `[r, g, b]` with three integers in 0–255. */
function isRgb(value: unknown): boolean {
  return Array.isArray(value) && value.length === 3 && value.every(c => Number.isInteger(c) && c >= 0 && c <= 255)
}

export function checkValue(value: unknown, spec: CatalogParam): string | null {
  const isNum = typeof value === 'number' && Number.isFinite(value)
  switch (spec.type) {
    case 'int':
      if (!isNum || !Number.isInteger(value)) return 'ha de ser un enter'
      break
    case 'number':
      if (!isNum) return 'ha de ser un número'
      break
    case 'bool':
      if (typeof value !== 'boolean') return 'ha de ser booleà'
      return null
    case 'string':
      if (typeof value !== 'string') return 'ha de ser text'
      return null
    case 'rgb':
      if (!isRgb(value)) return 'ha de ser un color [r, g, b] amb valors de 0 a 255'
      return null
    case 'rgb_list':
      if (!Array.isArray(value) || !value.every(isRgb)) return 'ha de ser una llista de colors [[r, g, b], …] amb valors de 0 a 255'
      return null
    case 'enum':
      if (typeof value !== 'string' || !spec.values?.includes(value)) return `ha de ser un de: ${(spec.values ?? []).join(', ')}`
      return null
  }
  const n = value as number
  if (spec.min !== undefined && n < spec.min) return `ha de ser com a mínim ${spec.min}`
  if (spec.max !== undefined && n > spec.max) return `ha de ser com a màxim ${spec.max}`
  return null
}

function pinsOf(name: string, entry: Hardware[string], hasPin: boolean): Array<[string, number]> {
  const out: Array<[string, number]> = []
  if (hasPin && typeof entry.pin === 'number') out.push([name, entry.pin])
  if (entry.kind === 'motor') {
    for (const key of MOTOR_PIN_KEYS) {
      if (typeof entry[key] === 'number') out.push([`${name}.${key}`, entry[key] as number])
    }
  }
  if (entry.kind === 'sensor') {
    for (const key of SENSOR_PIN_KEYS) {
      if (typeof entry[key] === 'number') out.push([`${name}.${key}`, entry[key] as number])
    }
  }
  return out
}

/** A sensor that reads a value through a model (`source: measured`). */
export function isMeasured(entry: Hardware[string]): boolean {
  return entry.kind === 'sensor' && (entry.source ?? 'digital') === 'measured'
}

/** The quantity a measured sensor watches: `quantity` or the only one of the model; null when unknown. */
function sensorQuantity(entry: Hardware[string], profile: SensorProfile): string | null {
  const quantities = Object.keys(profile.quantities)
  if (entry.quantity === undefined) return quantities.length === 1 ? quantities[0]! : null
  return typeof entry.quantity === 'string' && quantities.includes(entry.quantity) ? entry.quantity : null
}

/** Problems of a sensor according to its `source` (and, when measured, its model), in Catalan. Mirrors `sensor_problems`. */
export function sensorProblems(entry: Hardware[string], catalog: OutputCatalog = defaultCatalog): string[] {
  if (!isMeasured(entry)) {
    const extra = SENSOR_MEASURED_KEYS.filter(k => k in entry)
    return extra.length ? [`${extra.map(k => `«${k}»`).join(', ')} només té sentit amb source measured`] : []
  }
  const problems = SENSOR_DIGITAL_KEYS.filter(k => k in entry).map(k => `«${k}» és d'un sensor digital`)
  const profile = sensorProfile(entry.model, catalog)
  if (!profile) {
    problems.push('necessita un «model» de profiles.sensor')
    return problems
  }
  const model = String(entry.model)
  const allowed = SENSOR_WIRING[profile.wiring] ?? []
  for (const key of SENSOR_WIRING_KEYS) {
    if (key in entry && !allowed.includes(key)) problems.push(`«${key}» no correspon al cablejat ${profile.wiring} del model ${model}`)
  }
  if (profile.wiring === 'onewire') {
    if (!('pin' in entry)) problems.push('necessita «pin» (la línia DATA del 1-Wire)')
    if ('deviceId' in entry && !(typeof entry.deviceId === 'string' && ONEWIRE_ID.test(entry.deviceId))) {
      problems.push('«deviceId» ha de ser 28- seguit de 12 dígits hexadecimals')
    }
  } else if (profile.wiring === 'trig_echo') {
    if (!('pinTrig' in entry) || !('pinEcho' in entry)) problems.push('necessita «pinTrig» i «pinEcho»')
    else if (entry.pinTrig === entry.pinEcho) problems.push('«pinTrig» i «pinEcho» han de ser diferents')
  } else if (profile.wiring === 'i2c') {
    const addresses = profile.addresses ?? []
    if ('address' in entry && addresses.length && !addresses.includes(entry.address as number)) {
      problems.push(`el model ${model} només admet l'adreça I2C ${addresses.map(a => `0x${a.toString(16)}`).join(' o ')}`)
    }
  }
  const measures = Object.keys(profile.quantities).join(', ')
  const quantity = sensorQuantity(entry, profile)
  if (quantity === null) {
    problems.push('quantity' in entry
      ? `el model ${model} no mesura ${String(entry.quantity)} (mesura ${measures})`
      : `necessita «quantity»: el model ${model} mesura ${measures}`)
  }
  const threshold = entry.threshold
  if (typeof threshold !== 'number' || !Number.isFinite(threshold)) {
    problems.push('necessita «threshold»')
  } else if (quantity !== null) {
    const range = profile.quantities[quantity]!
    if (threshold < range.min || threshold > range.max) problems.push(`«threshold» ha d'estar entre ${range.min} i ${range.max} ${range.unit}`)
  }
  if (entry.activeWhen !== 'above' && entry.activeWhen !== 'below') problems.push('necessita «activeWhen» (above o below)')
  return problems
}

/** Expander channels an entry occupies: `[label, channel]` (relays, sensors and motors). */
function expanderChannelsOf(name: string, entry: Hardware[string]): Array<[string, number]> {
  if (!('expander' in entry)) return []
  const keys: readonly string[] = entry.kind === 'motor' ? MOTOR_CHANNEL_KEYS : entry.kind === 'relay' || entry.kind === 'sensor' ? ['channel'] : []
  const out: Array<[string, number]> = []
  for (const key of keys) {
    const value = entry[key]
    if (typeof value === 'number' && Number.isInteger(value)) out.push([key === 'channel' ? name : `${name}.${key}`, value])
  }
  return out
}

/** Problems of a motor's outputs (pins or expander), in Catalan; empty when coherent. Mirrors `motor_output_problems`. */
export function motorOutputProblems(entry: Hardware[string]): string[] {
  const pins = MOTOR_PIN_KEYS.filter(k => k in entry).length
  const channels = MOTOR_CHANNEL_KEYS.filter(k => k in entry).length
  const problems: string[] = []
  if ('expander' in entry) {
    if (pins > 0) problems.push('no pot tenir pins i expansor alhora')
    if (channels !== 2) problems.push('amb expansor necessita channelForward i channelReverse')
    else if (entry.channelForward === entry.channelReverse) problems.push('channelForward i channelReverse han de ser diferents')
    if ('activeLow' in entry) problems.push("«activeLow» es declara a l'expansor")
  } else {
    if (channels > 0) problems.push('els canals només tenen sentit amb «expander»')
    if (pins !== 2) problems.push('necessita pinForward i pinReverse, o expander amb els dos canals')
  }
  return problems
}

export function validateShowPackage(pkg: ShowPackage, catalog: OutputCatalog = defaultCatalog): ShowIssue[] {
  const issues: ShowIssue[] = []
  const kinds = catalog.kinds
  const board = catalog.boards[pkg.board]
  const hardware = pkg.hardware ?? {}
  const hasAudio = Object.values(hardware).some(e => e.kind === 'audio')

  // --- hardware: kinds, config, pins -------------------------------------------------------
  const usedPins = new Map<number, string[]>()
  for (const [name, entry] of Object.entries(hardware)) {
    const spec = kinds[entry.kind]
    if (!spec) {
      issues.push(issue('error', 'E_KIND_UNKNOWN', `El port «${name}» té un kind desconegut: ${String(entry.kind)}.`, { port: name }))
      continue
    }
    for (const [key, field] of Object.entries(spec.config)) {
      const value = entry[key]
      if (value === undefined) {
        if (field.required) issues.push(issue('error', 'E_CONFIG_INVALID', `El port «${name}» necessita «${key}».`, { port: name }))
        continue
      }
      const why = checkValue(value, field)
      if (why) issues.push(issue('error', 'E_CONFIG_INVALID', `El port «${name}»: «${key}» ${why}.`, { port: name }))
    }
    const mode = pinModeOf(spec)
    const hasPin = typeof entry.pin === 'number'
    if (mode === 'required' && !hasPin) {
      issues.push(issue('error', 'E_CONFIG_INVALID', `El port «${name}» necessita «pin».`, { port: name }))
    } else if (mode === 'optional' && isMeasured(entry)) {
      // the wiring is checked by sensorProblems against the model
    } else if (mode === 'optional') {
      if ('expander' in entry) {
        if (hasPin) issues.push(issue('error', 'E_CONFIG_INVALID', `El port «${name}» no pot tenir «pin» i «expander» alhora.`, { port: name }))
        if (!('channel' in entry)) issues.push(issue('error', 'E_CONFIG_INVALID', `El port «${name}» necessita «channel» amb l'expansor.`, { port: name }))
        if (entry.kind === 'relay' && 'activeLow' in entry) issues.push(issue('error', 'E_CONFIG_INVALID', `El port «${name}»: «activeLow» es declara a l'expansor, no al relé.`, { port: name }))
        if (entry.kind === 'sensor' && entry.pull === 'down') issues.push(issue('error', 'E_CONFIG_INVALID', `El sensor «${name}»: un canal d'expansor només admet pull «up» o «none».`, { port: name }))
      } else if (!hasPin) {
        issues.push(issue('error', 'E_CONFIG_INVALID', `El port «${name}» necessita «pin» o «expander» + «channel».`, { port: name }))
      } else if ('channel' in entry) {
        issues.push(issue('error', 'E_CONFIG_INVALID', `El port «${name}»: «channel» només té sentit amb «expander».`, { port: name }))
      }
    } else if (mode === 'none' && 'pin' in entry) {
      issues.push(issue('error', 'E_CONFIG_INVALID', `El port «${name}» (${entry.kind}) no porta «pin».`, { port: name }))
    }
    for (const [label, pin] of pinsOf(name, entry, mode !== 'none')) {
      usedPins.set(pin, [...(usedPins.get(pin) ?? []), label])
      if (board) {
        if (pin < board.gpios.min || pin > board.gpios.max) {
          issues.push(issue('error', 'E_PIN_OUT_OF_BOARD', `El pin ${pin} de «${label}» no existeix a ${pkg.board} (${board.gpios.min}–${board.gpios.max}).`, { port: name }))
        } else if (String(pin) in board.reserved) {
          issues.push(issue('error', 'E_PIN_RESERVED', `El pin ${pin} de «${label}» està reservat: ${board.reserved[String(pin)]}.`, { port: name }))
        } else if (String(pin) in board.warnings) {
          issues.push(issue('warning', 'W_PIN_PULLUP', `El pin ${pin} de «${label}»: ${board.warnings[String(pin)]}.`, { port: name }))
        }
      }
    }
    if (entry.kind === 'led_strip' && typeof entry.pin === 'number' && board) {
      const ws = board.ws281x[String(entry.pin)]
      if (!ws) {
        issues.push(issue('error', 'E_WS281X_PIN', `El pin ${entry.pin} de la tira «${name}» no admet WS281x a ${pkg.board}.`, { port: name }))
      } else {
        if (entry.channel !== ws.channel) {
          issues.push(issue('error', 'E_WS281X_CHANNEL', `La tira «${name}» al pin ${entry.pin} ha d'usar channel ${ws.channel}.`, { port: name }))
        }
        if (ws.warning && hasAudio) {
          issues.push(issue('warning', 'W_PCM_AUDIO', `La tira «${name}» al pin ${entry.pin}: ${ws.warning}.`, { port: name }))
        }
      }
      if (typeof entry.dma === 'number' && board.dma.avoid.includes(entry.dma)) {
        issues.push(issue('warning', 'W_DMA_AVOID', `La tira «${name}» usa DMA ${entry.dma}, no recomanat (evita ${board.dma.avoid.join(', ')}).`, { port: name }))
      }
    }
    if (entry.kind === 'motor') {
      for (const why of motorOutputProblems(entry)) {
        issues.push(issue('error', 'E_MOTOR_OUTPUTS', `El motor «${name}»: ${why}.`, { port: name }))
      }
    }
    if (entry.kind === 'sensor') {
      for (const why of sensorProblems(entry, catalog)) {
        issues.push(issue('error', 'E_SENSOR_CONFIG', `El sensor «${name}»: ${why}.`, { port: name }))
      }
    }
  }
  for (const [pin, labels] of usedPins) {
    if (labels.length > 1) issues.push(issue('error', 'E_PIN_DUPLICATE', `El pin ${pin} està usat per més d'un port: ${labels.join(', ')}.`))
  }

  // --- I2C devices (expanders and measured sensors): unique addresses, GPIO 2/3 reserved ------
  const expanders = Object.entries(hardware).filter(([, e]) => e.kind === 'gpio_expander')
  const i2cDevices: Array<[string, number, number | null]> = expanders.map(([name, entry]) =>
    [name, typeof entry.bus === 'number' ? entry.bus : 1, typeof entry.address === 'number' ? entry.address : null])
  for (const [name, entry] of Object.entries(hardware)) {
    const profile = isMeasured(entry) ? sensorProfile(entry.model, catalog) : undefined
    if (profile?.wiring !== 'i2c' || ('bus' in entry && typeof entry.bus !== 'number')) continue
    const address = typeof entry.address === 'number' ? entry.address : profile.addresses?.[0] ?? null
    i2cDevices.push([name, typeof entry.bus === 'number' ? entry.bus : 1, address])
  }
  if (i2cDevices.length > 0) {
    for (const pin of I2C_PINS) {
      for (const label of usedPins.get(pin) ?? []) {
        issues.push(issue('error', 'E_PIN_RESERVED', `El pin ${pin} de «${label}» és I2C i queda reservat quan hi ha un expansor o un sensor I2C.`, { port: label }))
      }
    }
    const addresses = new Map<string, string[]>()
    for (const [name, bus, address] of i2cDevices) {
      if (address === null) continue
      const key = `${bus}:${address}`
      addresses.set(key, [...(addresses.get(key) ?? []), name])
    }
    for (const [key, names] of addresses) {
      if (names.length > 1) {
        const [bus, address] = key.split(':')
        issues.push(issue('error', 'E_I2C_ADDRESS_DUPLICATE', `L'adreça I2C 0x${Number(address).toString(16)} del bus ${bus} la fan servir més d'un dispositiu: ${names.join(', ')}.`))
      }
    }
  }
  const expanderNames = new Set(expanders.map(([n]) => n))
  const channels = new Map<string, string[]>()
  for (const [name, entry] of Object.entries(hardware)) {
    if (!['relay', 'sensor', 'motor'].includes(entry.kind) || !('expander' in entry)) continue
    const expander = String(entry.expander)
    if (!expanderNames.has(expander)) {
      issues.push(issue('error', 'E_EXPANDER_MISSING', `El port «${name}» referencia l'expansor «${expander}», que no existeix com a gpio_expander.`, { port: name }))
      continue
    }
    for (const [label, channel] of expanderChannelsOf(name, entry)) {
      const key = `${expander}:${channel}`
      channels.set(key, [...(channels.get(key) ?? []), label])
    }
  }
  for (const [key, names] of channels) {
    if (names.length > 1) {
      const sep = key.lastIndexOf(':')
      issues.push(issue('error', 'E_EXPANDER_CHANNEL_DUPLICATE', `El canal ${key.slice(sep + 1)} de «${key.slice(0, sep)}» l'usen més d'un port: ${names.join(', ')}.`))
    }
  }

  // --- motors: limit switches; sensors nobody uses -------------------------------------------
  const referencedSensors = new Set<string>()
  for (const [name, entry] of Object.entries(hardware)) {
    if (entry.kind !== 'motor') continue
    for (const key of MOTOR_LIMIT_KEYS) {
      if (!(key in entry)) continue
      const sensor = entry[key]
      const target = typeof sensor === 'string' ? hardware[sensor] : undefined
      if (!target || target.kind !== 'sensor') {
        issues.push(issue('error', 'E_SENSOR_MISSING', `El motor «${name}»: «${key}» referencia «${String(sensor)}», que no existeix com a sensor.`, { port: name }))
      } else {
        referencedSensors.add(sensor as string)
      }
    }
  }
  for (const [name, entry] of Object.entries(hardware)) {
    if (entry.kind === 'sensor' && (entry.onActive ?? 'none') === 'none' && !referencedSensors.has(name)) {
      issues.push(issue('warning', 'W_SENSOR_UNUSED', `El sensor «${name}» no fa res: cap motor el fa servir i no té onActive.`, { port: name }))
    }
  }

  // --- moving heads: inside the universe, no overlaps ----------------------------------------
  const dmxRanges: Array<[string, number, number]> = []
  for (const [name, entry] of Object.entries(hardware)) {
    if (entry.kind !== 'moving_head') continue
    const profile = movingHeadProfile(entry.profile, catalog)
    if (!profile || typeof entry.address !== 'number' || !Number.isInteger(entry.address)) continue
    const last = entry.address + profile.channels - 1
    if (last > DMX_UNIVERSE) {
      issues.push(issue('error', 'E_DMX_ADDRESS_RANGE', `El cap «${name}» a l'adreça ${entry.address} necessita ${profile.channels} canals i surt de l'univers (fins a ${last}).`, { port: name }))
      continue
    }
    for (const [other, a, b] of dmxRanges) {
      if (entry.address <= b && a <= last) {
        issues.push(issue('error', 'E_DMX_ADDRESS_OVERLAP', `Els caps «${other}» (${a}–${b}) i «${name}» (${entry.address}–${last}) solapen canals DMX.`, { port: name }))
      }
    }
    dmxRanges.push([name, entry.address, last])
  }

  // --- segments ----------------------------------------------------------------------------
  // Whole strips are show targets too (fill/animate on the entire strip): their length bounds first/last.
  const segmentLength = new Map<string, number>()
  for (const [name, entry] of Object.entries(hardware)) {
    if (entry.kind === 'led_strip' && typeof entry.length === 'number') segmentLength.set(name, entry.length)
    if (entry.kind !== 'led_segment') continue
    const strip = hardware[String(entry.strip)]
    if (!strip || strip.kind !== 'led_strip') {
      issues.push(issue('error', 'E_SEGMENT_STRIP_MISSING', `El segment «${name}» referencia la tira «${String(entry.strip)}», que no existeix com a led_strip.`, { port: name }))
      continue
    }
    const first = entry.first, last = entry.last, length = strip.length
    if (typeof first === 'number' && typeof last === 'number' && typeof length === 'number') {
      if (Math.min(first, last) < 0 || Math.max(first, last) > length - 1) {
        issues.push(issue('error', 'E_SEGMENT_RANGE', `El segment «${name}» (${first}–${last}) surt de la tira «${String(entry.strip)}» (0–${length - 1}).`, { port: name }))
      }
      segmentLength.set(name, Math.abs(last - first) + 1)
    }
  }

  // --- timeline ----------------------------------------------------------------------------
  const declaredAssets = pkg.assets ?? { audio: [] }
  const referencedAssets: Record<string, Set<string>> = {}
  const usedTargets = new Set<string>()
  const continuous = new Map<string, Array<[number, number | undefined]>>()
  const singletons = new Map<string, string[]>()
  pkg.timeline.forEach((ev, idx) => {
    const where = `esdeveniment ${idx + 1} (t=${ev.t} ms)`
    const entry = hardware[ev.target]
    if (!entry) {
      issues.push(issue('error', 'E_TARGET_MISSING', `${where}: el port «${ev.target}» no és a hardware.`))
      return
    }
    usedTargets.add(ev.target)
    if (ev.t > pkg.durationMs) {
      issues.push(issue('error', 'E_T_AFTER_END', `${where}: comença després del final del show (${pkg.durationMs} ms).`, { port: ev.target }))
    }
    const spec = kinds[entry.kind]
    if (!spec) return
    const action = spec.actions[ev.action]
    if (!action) {
      issues.push(issue('error', 'E_ACTION_UNKNOWN', `${where}: l'acció «${ev.action}» no existeix per a sortides ${entry.kind} («${ev.target}»).`, { port: ev.target }))
      return
    }
    const params = ev.params ?? {}
    const animation = action.animations && typeof params.animation_type === 'string' ? params.animation_type : null
    const allowed = actionParams(action, animation)
    for (const [pname, value] of Object.entries(params)) {
      const pspec = allowed[pname]
      if (!pspec) {
        const code = animation ? 'E_ANIMATION_PARAM' : 'E_PARAM_UNKNOWN'
        issues.push(issue('error', code, `${where}: el paràmetre «${pname}» no existeix a ${entry.kind}.${ev.action}${animation ? ` per a l'animació «${animation}»` : ''}.`, { port: ev.target }))
        continue
      }
      const why = checkValue(value, pspec)
      if (why) {
        issues.push(issue('error', 'E_PARAM_TYPE', `${where}: el paràmetre «${pname}» ${why}.`, { port: ev.target }))
      }
      if (pspec.asset && typeof value === 'string') {
        ;(referencedAssets[pspec.asset] ??= new Set()).add(value)
        if (!declaredAssets[pspec.asset]?.includes(value)) {
          issues.push(issue('error', 'E_ASSET_UNLISTED', `${where}: el fitxer «${value}» no és a assets.${pspec.asset}.`, { port: ev.target }))
        }
      }
    }
    for (const pname of requiredParams(action, animation)) {
      if (!(pname in params)) issues.push(issue('error', 'E_PARAM_REQUIRED', `${where}: falta el paràmetre obligatori «${pname}».`, { port: ev.target }))
    }
    const segLen = segmentLength.get(ev.target)
    if ((entry.kind === 'led_segment' || entry.kind === 'led_strip') && segLen !== undefined) {
      for (const key of ['first', 'last'] as const) {
        const v = params[key]
        if (typeof v === 'number' && !(v >= 0 && v < segLen)) {
          issues.push(issue('error', 'E_SEGMENT_RANGE', `${where}: «${key}»=${v} surt de «${ev.target}» (0–${segLen - 1}).`, { port: ev.target }))
        }
      }
    }
    const direction = entry.kind === 'motor' ? MOTOR_DIRECTIONS[ev.action] : undefined
    if (direction && typeof params.time === 'number') {
      const [maxKey, limitKey] = direction
      const limitTime = entry[maxKey]
      if (typeof limitTime === 'number' && params.time > limitTime) {
        if (entry[limitKey]) {
          issues.push(issue('warning', 'W_MOTOR_TIME_CAPPED', `${where}: el clip dura ${params.time} s però «${ev.target}» mai gira més de ${limitTime} s en aquest sentit; pararà abans pel final de carrera o pel tall.`, { port: ev.target }))
        } else {
          issues.push(issue('error', 'E_MOTOR_TIME', `${where}: time=${params.time} supera el ${maxKey} (${limitTime}) del motor «${ev.target}».`, { port: ev.target }))
        }
      }
    }
    if (entry.kind === 'moving_head' && ev.action === 'set' && Object.keys(params).every(k => k === 'time')) {
      issues.push(issue('warning', 'W_EMPTY_CUE', `${where}: el cue de «${ev.target}» no canvia res (només time).`, { port: ev.target }))
    }
    if (ev.action === 'animate' && animation === 'fade' && !('from_color' in params)) {
      issues.push(issue('warning', 'W_FADE_FROM_BLACK', `${where}: el fos a «${ev.target}» no indica from_color: començarà des de negre.`, { port: ev.target }))
    }
    if (action.continuous) {
      const d = typeof params.duration === 'number' ? params.duration : undefined
      continuous.set(ev.target, [...(continuous.get(ev.target) ?? []), [ev.t, d]])
    }
  })

  for (const [target, events] of continuous) {
    events.sort((a, b) => a[0] - b[0])
    for (let i = 1; i < events.length; i++) {
      const [t1, d1] = events[i - 1]!
      const [t2] = events[i]!
      if (d1 === undefined || t1 + d1 * 1000 > t2) {
        issues.push(issue('warning', 'W_OVERLAP_CONTINUOUS', `Dues animacions se solapen a «${target}»: ${t1} ms i ${t2} ms.`, { port: target }))
      }
    }
  }

  for (const [name, entry] of Object.entries(hardware)) {
    const spec = kinds[entry.kind]
    if (!spec) continue
    if (Object.keys(spec.actions).length > 0 && !spec.infrastructure && !usedTargets.has(name)) {
      issues.push(issue('warning', 'W_PORT_UNUSED', `El port «${name}» no té cap esdeveniment.`, { port: name }))
    }
    if (entry.kind === 'audio') {
      singletons.set(entry.kind, [...(singletons.get(entry.kind) ?? []), name])
    }
  }
  for (const [kind, names] of singletons) {
    if (names.length > 1) {
      issues.push(issue('warning', 'W_LEGACY_SINGLE', `El reproductor actual només admet un port de tipus ${kind}; n'hi ha ${names.length}: ${names.join(', ')}.`))
    }
  }
  for (const [assetKind, names] of Object.entries(declaredAssets)) {
    for (const n of names) {
      if (!referencedAssets[assetKind]?.has(n)) {
        issues.push(issue('warning', 'W_ASSET_UNUSED', `El fitxer «${n}» és a assets.${assetKind} però cap esdeveniment l'usa.`))
      }
    }
  }
  return issues
}
