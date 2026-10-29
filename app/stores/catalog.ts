import { defineStore } from 'pinia'
import type { Page, PieceAttachmentResponseDto, PieceListItemDto, PieceResponseDto, PieceTypeActionResponseDto, PortResponseDto } from '~/types/api'
import { isOutputKind, type OutputKind } from '~/types/catalog'
import { ledLengthFromAttributes } from '~/utils/stripLayout'

/**
 * Read-only catalog of the organization's articles (pieces), its hardware ports and, lazily, the
 * actions available for each piece type. Backs the piece palette and the clip inspector.
 */
export const useCatalogStore = defineStore('catalog', () => {
  const orgSlug = ref<string | null>(null)
  const pieces = ref<PieceListItemDto[]>([])
  const loading = ref(false)
  const actionsByType = ref<Record<number, PieceTypeActionResponseDto[]>>({})
  // Full piece details (with attribute values), loaded lazily when a piece is inspected.
  const pieceDetails = ref<Record<number, PieceResponseDto>>({})
  // Organization ports (a flat list); empty when the org does not expose the gated ports feature.
  const ports = ref<PortResponseDto[]>([])
  // True once the ports request succeeded: only then can a missing port id be called stale.
  const portsLoaded = ref(false)
  // AUDIO attachments per piece (what `audio.play` clips can choose from), loaded lazily. A piece
  // present with an empty list has been loaded and simply has no audio.
  const audioByPiece = ref<Record<number, PieceAttachmentResponseDto[]>>({})

  async function load(slug: string) {
    orgSlug.value = slug
    loading.value = true
    try {
      const cached = useCachedApi()
      const [page] = await Promise.all([
        cached.get<Page<PieceListItemDto>>(`/organizations/${slug}/pieces`, { size: 200, sort: 'name,asc' }),
        loadPorts(slug)
      ])
      pieces.value = page.content ?? []
    } finally {
      loading.value = false
    }
  }

  /** Loads the org's ports; tolerates the gated-feature 403/404 (orgs without it just get an empty list). */
  async function loadPorts(slug: string): Promise<void> {
    try {
      ports.value = await useCachedApi().get<PortResponseDto[]>(`/organizations/${slug}/ports`)
      portsLoaded.value = true
    } catch {
      ports.value = []
      portsLoaded.value = false
    }
  }

  function portById(id: number): PortResponseDto | undefined {
    return ports.value.find(p => p.id === id)
  }

  /** Ports assignable to a piece = those whose piece type is one of the piece's types. */
  function portsForPiece(piece: PieceListItemDto | undefined): PortResponseDto[] {
    if (!piece) return []
    const typeIds = new Set(piece.pieceTypes.map(t => t.id))
    return ports.value.filter(p => p.pieceTypeId != null && typeIds.has(p.pieceTypeId))
  }

  /** Piece type that owns an action (actions are cached per type once loaded). */
  function typeIdOfAction(actionId: number): number | undefined {
    for (const [typeId, actions] of Object.entries(actionsByType.value)) {
      if (actions.some(a => a.id === actionId)) return Number(typeId)
    }
    return undefined
  }

  /** Output kind of the piece type (of this piece) that owns an action, or null for inventory-only types. */
  function kindOfAction(piece: PieceListItemDto | undefined, actionId: number): OutputKind | null {
    const typeId = typeIdOfAction(actionId)
    const kind = piece?.pieceTypes.find(t => t.id === typeId)?.kind
    return isOutputKind(kind) ? kind : null
  }

  /** Pieces whose types drive LEDs: with a length attribute they show their LEDs on the board. */
  function isLedPiece(piece: PieceListItemDto | undefined): boolean {
    return !!piece?.pieceTypes.some(t => t.kind === 'led_strip' || t.kind === 'led_segment')
  }

  /** Pieces on the board whose types drive an audio output (they may carry audio files). */
  function isAudioPiece(piece: PieceListItemDto | undefined): boolean {
    return !!piece?.pieceTypes.some(t => t.kind === 'audio')
  }

  /** Lazily loads (and caches) the AUDIO attachments of a piece. A failed request leaves it unloaded. */
  async function ensureAudioForPiece(pieceId: number): Promise<PieceAttachmentResponseDto[]> {
    if (audioByPiece.value[pieceId]) return audioByPiece.value[pieceId]!
    if (!orgSlug.value) return []
    try {
      const list = await useCachedApi().get<PieceAttachmentResponseDto[]>(
        `/organizations/${orgSlug.value}/pieces/${pieceId}/attachments`,
        { kind: 'AUDIO' }
      )
      audioByPiece.value = { ...audioByPiece.value, [pieceId]: list }
      return list
    } catch {
      return []
    }
  }

  function audioForPiece(pieceId: number): PieceAttachmentResponseDto[] {
    return audioByPiece.value[pieceId] ?? []
  }

  function audioLoadedForPiece(pieceId: number): boolean {
    return audioByPiece.value[pieceId] !== undefined
  }

  /** Same-origin URL of an attachment's bytes (the backend streams them; no bucket CORS involved). */
  function attachmentContentUrl(pieceId: number, attachmentId: number): string | null {
    if (!orgSlug.value) return null
    return `/api/organizations/${orgSlug.value}/pieces/${pieceId}/attachments/${attachmentId}/content`
  }

  function pieceById(id: number): PieceListItemDto | undefined {
    return pieces.value.find(p => p.id === id)
  }

  /**
   * Same-origin URL of the 512 px JPEG thumbnail of a piece's cover: what the catalog rows and
   * the board draw. The backend streams it with a one-year immutable cache, so the browser asks
   * for it once; nothing goes to R2 (whose hosts Spanish ISPs block during LaLiga matches).
   */
  function coverUrl(piece: PieceListItemDto | undefined): string | null {
    if (!piece || !piece.coverAttachmentId || !orgSlug.value) return null
    return `/api/organizations/${orgSlug.value}/pieces/${piece.id}/attachments/${piece.coverAttachmentId}/thumbnail`
  }

  /** The original of a piece's cover, for the lightbox. */
  function coverFullUrl(piece: PieceListItemDto | undefined): string | null {
    if (!piece || !piece.coverAttachmentId) return null
    return attachmentContentUrl(piece.id, piece.coverAttachmentId)
  }

  /** Lazily loads (and caches) the actions of a piece type. Tolerates the gated-feature 403/404. */
  async function loadActionsForType(typeId: number): Promise<PieceTypeActionResponseDto[]> {
    if (actionsByType.value[typeId]) return actionsByType.value[typeId]!
    if (!orgSlug.value) return []
    try {
      const actions = await useCachedApi().get<PieceTypeActionResponseDto[]>(
        `/organizations/${orgSlug.value}/piece-types/${typeId}/actions`
      )
      actionsByType.value = { ...actionsByType.value, [typeId]: actions }
      return actions
    } catch {
      actionsByType.value = { ...actionsByType.value, [typeId]: [] }
      return []
    }
  }

  /** Actions available for a piece = union across its piece types (must be pre-loaded). */
  function actionsForPiece(piece: PieceListItemDto | undefined): PieceTypeActionResponseDto[] {
    if (!piece) return []
    const out: PieceTypeActionResponseDto[] = []
    const seen = new Set<number>()
    for (const t of piece.pieceTypes) {
      for (const a of actionsByType.value[t.id] ?? []) {
        if (!seen.has(a.id)) {
          seen.add(a.id)
          out.push(a)
        }
      }
    }
    return out
  }

  async function ensureActionsForPiece(piece: PieceListItemDto | undefined): Promise<void> {
    if (!piece) return
    await Promise.all(piece.pieceTypes.map(t => loadActionsForType(t.id)))
  }

  function pieceDetailById(id: number): PieceResponseDto | undefined {
    return pieceDetails.value[id]
  }

  /** LEDs of a piece from its length attribute (detail must be loaded), or null when unknown. */
  function ledLengthOf(pieceId: number): number | null {
    return ledLengthFromAttributes(pieceDetails.value[pieceId]?.attributeValues)
  }

  /** Lazily loads (and caches) a piece's full detail, including its attribute values. */
  async function ensurePieceDetail(id: number): Promise<PieceResponseDto | undefined> {
    if (pieceDetails.value[id]) return pieceDetails.value[id]
    if (!orgSlug.value) return undefined
    try {
      const detail = await useCachedApi().get<PieceResponseDto>(`/organizations/${orgSlug.value}/pieces/${id}`)
      pieceDetails.value = { ...pieceDetails.value, [id]: detail }
      return detail
    } catch {
      return undefined
    }
  }

  /**
   * Downloads now everything the board needs to work and to build the bundle without a connection:
   * actions and details of every placed piece, and the audio files of the audio pieces. Failures are
   * ignored (whatever was cached before stays).
   */
  async function prepareOffline(pieceIds: number[]): Promise<void> {
    const ids = [...new Set(pieceIds)]
    await Promise.all(ids.map(id => ensureActionsForPiece(pieceById(id))))
    await Promise.all(ids.map(id => ensurePieceDetail(id)))
    const audioIds = ids.filter(id => isAudioPiece(pieceById(id)))
    const lists = await Promise.all(audioIds.map(id => ensureAudioForPiece(id)))
    const cached = useCachedApi()
    await Promise.all(audioIds.flatMap((pieceId, i) => (lists[i] ?? []).map((a) => {
      const url = attachmentContentUrl(pieceId, a.id)
      return url ? cached.bytes(url).catch(() => undefined) : undefined
    })))
  }

  function reset() {
    orgSlug.value = null
    pieces.value = []
    actionsByType.value = {}
    pieceDetails.value = {}
    ports.value = []
    portsLoaded.value = false
    audioByPiece.value = {}
  }

  return {
    orgSlug,
    pieces,
    loading,
    actionsByType,
    ports,
    portsLoaded,
    load,
    pieceById,
    coverUrl,
    coverFullUrl,
    loadActionsForType,
    actionsForPiece,
    ensureActionsForPiece,
    pieceDetailById,
    ensurePieceDetail,
    ledLengthOf,
    portById,
    portsForPiece,
    typeIdOfAction,
    kindOfAction,
    isLedPiece,
    isAudioPiece,
    audioByPiece,
    ensureAudioForPiece,
    audioForPiece,
    audioLoadedForPiece,
    attachmentContentUrl,
    prepareOffline,
    reset
  }
})
