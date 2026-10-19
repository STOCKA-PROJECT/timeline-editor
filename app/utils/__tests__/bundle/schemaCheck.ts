// A deliberately small JSON Schema checker: just the keywords `bundle.schema.json` uses (type,
// const, enum, pattern, minLength, minimum, minItems, items, required, properties,
// additionalProperties, format date-time). Enough to prove a manifest fits the contract without
// pulling a validator into the dev dependencies.

type Schema = {
  type?: string | string[]
  const?: unknown
  enum?: unknown[]
  pattern?: string
  format?: string
  minLength?: number
  minimum?: number
  minItems?: number
  items?: Schema
  required?: string[]
  properties?: Record<string, Schema>
  additionalProperties?: boolean
}

function hasType(value: unknown, type: string): boolean {
  switch (type) {
    case 'object': return value !== null && typeof value === 'object' && !Array.isArray(value)
    case 'array': return Array.isArray(value)
    case 'integer': return Number.isInteger(value)
    case 'null': return value === null
    default: return typeof value === type
  }
}

export function schemaErrors(value: unknown, schema: Schema, path = '$'): string[] {
  const errors: string[] = []
  if ('const' in schema && value !== schema.const) errors.push(`${path}: expected ${JSON.stringify(schema.const)}`)
  if (schema.enum && !schema.enum.includes(value)) errors.push(`${path}: not one of ${JSON.stringify(schema.enum)}`)
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    if (!types.some(t => hasType(value, t))) errors.push(`${path}: expected type ${types.join('|')}`)
  }
  if (typeof value === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match ${schema.pattern}`)
    if (schema.minLength != null && value.length < schema.minLength) errors.push(`${path}: shorter than ${schema.minLength}`)
    if (schema.format === 'date-time' && (Number.isNaN(Date.parse(value)) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(value))) {
      errors.push(`${path}: not a date-time`)
    }
  }
  if (typeof value === 'number' && schema.minimum != null && value < schema.minimum) errors.push(`${path}: below ${schema.minimum}`)
  if (Array.isArray(value)) {
    if (schema.minItems != null && value.length < schema.minItems) errors.push(`${path}: fewer than ${schema.minItems} items`)
    if (schema.items) value.forEach((item, i) => errors.push(...schemaErrors(item, schema.items!, `${path}[${i}]`)))
  }
  if (hasType(value, 'object')) {
    const record = value as Record<string, unknown>
    for (const key of schema.required ?? []) if (!(key in record)) errors.push(`${path}: missing ${key}`)
    for (const [key, item] of Object.entries(record)) {
      const sub = schema.properties?.[key]
      if (sub) errors.push(...schemaErrors(item, sub, `${path}.${key}`))
      else if (schema.additionalProperties === false) errors.push(`${path}: unexpected ${key}`)
    }
  }
  return errors
}
