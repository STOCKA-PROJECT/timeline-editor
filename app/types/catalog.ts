import catalogJson from '~/data/catalog.json'

// Output catalog shared with the backend and the Raspberry Pi player. `app/data/catalog.json` is a
// byte-identical copy of `rpi4-system/contract/catalog.json`; keep them in sync (see `version`).

export type OutputKind = 'relay' | 'gpio_expander' | 'led_strip' | 'led_segment' | 'motor' | 'audio' | 'moving_head' | 'sensor'
export type CatalogType = 'int' | 'number' | 'bool' | 'string' | 'rgb' | 'rgb_list' | 'enum'

export interface CatalogParam {
  type: CatalogType
  required?: boolean
  default?: unknown
  min?: number
  max?: number
  values?: string[]
  /** The single parameter that receives the clip length, in seconds. */
  duration?: boolean
  /** The value names a media file that must travel with the show. */
  asset?: 'audio'
  /** Config keys only: the value must be the name of a port of this kind. */
  ref?: OutputKind
  /** Hint for editors: usually fixed on the piece-type action (static) rather than set per clip. */
  static?: boolean
  recommended?: [number, number]
  notes?: string
}

export interface CatalogAnimation {
  params: Record<string, CatalogParam>
  unsupported?: string[]
  transition?: boolean
  notes?: string
}

export interface CatalogAction {
  params: Record<string, CatalogParam>
  animations?: Record<string, CatalogAnimation>
  unsupported?: string[]
  /** Keeps running until replaced on the same target or until its duration ends. */
  continuous?: boolean
  /** Interpolates from the current state to the new one over the duration parameter (fades, cues). */
  transition?: boolean
  notes?: string
}

export interface CatalogKind {
  controller: string
  infrastructure: boolean
  /** `true`: always a pin; `'optional'`: a pin unless the config addresses it otherwise (relay on an expander); `false`: never. */
  pin: boolean | 'optional'
  notes?: string
  legacy: { addressing: 'name' | 'controller', pinType?: string, module?: string, name?: string }
  config: Record<string, CatalogParam>
  actions: Record<string, CatalogAction>
}

/** A DMX fixture profile (`profiles.moving_head.<id>`): channel count and physical ranges. */
export interface FixtureProfile {
  name: string
  mode?: string
  channels: number
  pan: { max: number }
  tilt: { max: number }
  zoom: { min: number, max: number }
  map: Record<string, number>
  fixed?: Record<string, number>
  notes?: string
}

/** A measured-sensor model (`profiles.sensor.<id>`): wiring, I2C addresses and measured quantities. */
export interface SensorProfile {
  name: string
  wiring: 'i2c' | 'onewire' | 'trig_echo'
  /** I2C models: accepted addresses, the first is the default. */
  addresses?: number[]
  quantities: Record<string, { unit: string, min: number, max: number }>
  pollMs: number
  notes?: string
}

export interface BoardSpec {
  name: string
  numbering: string
  gpios: { min: number, max: number }
  reserved: Record<string, string>
  warnings: Record<string, string>
  ws281x: Record<string, { channel: number, via: string, warning?: string }>
  dma: { min: number, max: number, avoid: number[] }
  capabilities: OutputKind[]
}

export interface OutputCatalog {
  format: 'stocka-catalog'
  version: number
  types: CatalogType[]
  kinds: Record<OutputKind, CatalogKind>
  profiles?: { moving_head?: Record<string, FixtureProfile>, sensor?: Record<string, SensorProfile> }
  excludedMethods: Record<string, string[]>
  boards: Record<string, BoardSpec>
}

export type PinMode = 'required' | 'optional' | 'none'

/** How ports of a kind carry their pin. */
export function pinModeOf(spec: CatalogKind): PinMode {
  if (spec.pin === true) return 'required'
  if (spec.pin === 'optional') return 'optional'
  return 'none'
}

/** The DMX profile of a moving head, if the catalog knows it. */
export function movingHeadProfile(id: unknown, outputCatalog: OutputCatalog = catalog): FixtureProfile | undefined {
  return typeof id === 'string' ? outputCatalog.profiles?.moving_head?.[id] : undefined
}

/** The model of a measured sensor, if the catalog knows it. */
export function sensorProfile(id: unknown, outputCatalog: OutputCatalog = catalog): SensorProfile | undefined {
  return typeof id === 'string' ? outputCatalog.profiles?.sensor?.[id] : undefined
}

export const DEFAULT_BOARD = 'rpi4b'

export const catalog = catalogJson as unknown as OutputCatalog

export const OUTPUT_KINDS = Object.keys(catalog.kinds) as OutputKind[]

export function isOutputKind(value: unknown): value is OutputKind {
  return typeof value === 'string' && value in catalog.kinds
}

/**
 * Parameters an action accepts. For `animate`, the common ones plus those of `animation` when it
 * is known, or the union of every animation's parameters when it is not fixed.
 */
export function actionParams(action: CatalogAction, animation?: string | null): Record<string, CatalogParam> {
  const out: Record<string, CatalogParam> = { ...action.params }
  if (!action.animations) return out
  if (animation != null) {
    const anim = action.animations[animation]
    if (anim) Object.assign(out, anim.params)
    return out
  }
  for (const anim of Object.values(action.animations)) Object.assign(out, anim.params)
  return out
}

/** Parameters that must be present: the common required ones plus the fixed animation's. */
export function requiredParams(action: CatalogAction, animation?: string | null): string[] {
  const out = Object.entries(action.params).filter(([, p]) => p.required).map(([n]) => n)
  const anim = animation != null ? action.animations?.[animation] : undefined
  if (anim) out.push(...Object.entries(anim.params).filter(([, p]) => p.required).map(([n]) => n))
  return out
}

/** Name of the parameter that receives the clip length, if the action has one. */
export function durationParamOf(action: CatalogAction): string | undefined {
  return Object.entries(action.params).find(([, p]) => p.duration)?.[0]
}
