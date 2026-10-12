import { actionParams, catalog as defaultCatalog, requiredParams, type CatalogParam, type OutputCatalog } from '~/types/catalog'
import { issue, type ShowIssue, type ShowPackage } from '~/types/show'

// Semantic rules of a stocka-show package, mirroring `rpi4-system/contract/validate.py`. Runs on
// the assembled package, so an imported or hand-edited package gets the same checks the device
// will apply. The schema (structure) is the device's job; here we assume a well-formed object.

type Hardware = ShowPackage['hardware']

/**
 * Strict type check of a value already in package form (no coercion: the device reads it as is).
 * Returns the problem, or null when the value fits. Mirrors `check_value` in validate.py.
 */
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
      if (!Array.isArray(value) || value.length !== 3 || !value.every(c => Number.isInteger(c) && c >= 0 && c <= 255)) {
        return 'ha de ser un color [r, g, b] amb valors de 0 a 255'
      }
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
    for (const key of ['pinR', 'pinL', 'sensorPin'] as const) {
      if (typeof entry[key] === 'number') out.push([`${name}.${key}`, entry[key] as number])
    }
  }
  return out
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
    if (spec.pin && typeof entry.pin !== 'number') {
      issues.push(issue('error', 'E_CONFIG_INVALID', `El port «${name}» necessita «pin».`, { port: name }))
    }
    for (const [label, pin] of pinsOf(name, entry, spec.pin)) {
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
      const pins = ['pinR', 'pinL', 'sensorPin'].map(k => entry[k]).filter(v => typeof v === 'number')
      if (new Set(pins).size !== pins.length) {
        issues.push(issue('error', 'E_CONFIG_INVALID', `El motor «${name}» repeteix un pin entre pinR, pinL i sensorPin.`, { port: name }))
      }
    }
  }
  for (const [pin, labels] of usedPins) {
    if (labels.length > 1) issues.push(issue('error', 'E_PIN_DUPLICATE', `El pin ${pin} està usat per més d'un port: ${labels.join(', ')}.`))
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
  const declaredAssets = pkg.assets ?? { audio: [], video: [] }
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
    if (entry.kind === 'motor' || entry.kind === 'audio' || entry.kind === 'video') {
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
