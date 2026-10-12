import type { PortResponseDto } from '~/types/api'
import { catalog as defaultCatalog, isOutputKind, type OutputCatalog } from '~/types/catalog'
import { issue, type ShowHardwareEntry, type ShowIssue } from '~/types/show'

/**
 * Builds the `hardware` section of a show package from the organization's ports: one entry per
 * port, keyed by name, with its kind, its pin (for kinds that have one) and its config keys.
 * Pin and board rules are checked later by `validateShowPackage`.
 */
export function buildHardware(
  ports: PortResponseDto[],
  catalog: OutputCatalog = defaultCatalog
): { hardware: Record<string, ShowHardwareEntry>, issues: ShowIssue[] } {
  const hardware: Record<string, ShowHardwareEntry> = {}
  const issues: ShowIssue[] = []
  for (const port of ports) {
    if (!isOutputKind(port.kind)) {
      issues.push(issue('error', 'E_KIND_UNKNOWN', `El port «${port.name}» té un tipus de sortida desconegut (${String(port.kind)}).`, { port: port.name }))
      continue
    }
    const spec = catalog.kinds[port.kind]
    const entry: ShowHardwareEntry = { kind: port.kind }
    if (spec.pin && port.pin != null) entry.pin = port.pin
    for (const [key, value] of Object.entries(port.config ?? {})) {
      if (key === 'pin' || key === 'kind' || value === null || value === undefined) continue
      entry[key] = value
    }
    hardware[port.name] = entry
  }
  return { hardware, issues }
}
