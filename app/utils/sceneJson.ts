import { SCENE_SCHEMA_VERSION, type SceneDocument } from '~/types/editor'
import { SHOW_FORMAT } from '~/types/show'
import { TIMELINE_EXPORT_FORMAT, type TimelineExportBundle } from '~/utils/exportBundle'

/**
 * Parses and validates an exported timeline JSON. Accepts both the backup bundle
 * (`{ format: "stocka-timeline", document, execution, … }`) and a bare scene document, and
 * returns the editable scene document. A show package (`stocka-show`) is not importable: it holds
 * no editor document. Throws an `Error` with a user-facing (Catalan) message when the content is
 * not usable.
 */
export function parseSceneDocument(text: string): SceneDocument {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    throw new Error('El fitxer no és un JSON vàlid.')
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('El fitxer no conté cap document de timeline.')
  }
  if ('format' in raw) {
    const bundle = raw as Partial<TimelineExportBundle> & { format?: unknown }
    if (bundle.format === SHOW_FORMAT) {
      throw new Error("Aquest fitxer és un paquet de show per al pessebre, no una còpia de l'editor. Importa la còpia de seguretat.")
    }
    if (bundle.format !== TIMELINE_EXPORT_FORMAT) {
      throw new Error("El fitxer no és una còpia de seguretat de l'editor de Stocka.")
    }
    if (typeof bundle.document !== 'object' || bundle.document === null) {
      throw new Error("La còpia no conté el document de l'editor.")
    }
    raw = bundle.document
  }
  const doc = raw as Partial<SceneDocument>
  if (typeof doc.schemaVersion !== 'number') {
    throw new Error('El fitxer no conté cap document de timeline (falta schemaVersion).')
  }
  if (doc.schemaVersion > SCENE_SCHEMA_VERSION) {
    throw new Error(`El fitxer usa una versió d'esquema (${doc.schemaVersion}) més recent que la suportada (${SCENE_SCHEMA_VERSION}).`)
  }
  const board = doc.board
  if (
    typeof board !== 'object' || board === null
    || typeof board.width !== 'number' || board.width <= 0
    || typeof board.height !== 'number' || board.height <= 0
  ) {
    throw new Error('El document no té una configuració de tauler vàlida.')
  }
  for (const key of ['layers', 'items', 'tracks', 'clips'] as const) {
    if (doc[key] !== undefined && !Array.isArray(doc[key])) {
      throw new Error(`El document té un camp «${key}» invàlid.`)
    }
  }
  if (doc.durationMs !== undefined && (typeof doc.durationMs !== 'number' || doc.durationMs <= 0)) {
    throw new Error('El document té una durada invàlida.')
  }
  return doc as SceneDocument
}
