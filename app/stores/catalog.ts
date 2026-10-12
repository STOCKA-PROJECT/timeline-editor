import { defineStore } from 'pinia'
import type { Page, PieceAttachmentResponseDto, PieceListItemDto, PieceResponseDto, PieceTypeActionResponseDto, PortResponseDto } from '~/types/api'
import { isOutputKind, type OutputKind } from '~/types/catalog'

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
      const api = useApi()
      const [page] = await Promise.all([
        api<Page<PieceListItemDto>>(`/organizations/${slug}/pieces`, {
          query: { size: 200, sort: 'name,asc' }
        }),
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
      const api = useApi()
      ports.value = await api<PortResponseDto[]>(`/organizations/${slug}/ports`)
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

  /** Pieces on the board whose types drive an audio output (they may carry audio files). */
  function isAudioPiece(piece: PieceListItemDto | undefined): boolean {
    return !!piece?.pieceTypes.some(t => t.kind === 'audio')
  }

  /** Lazily loads (and caches) the AUDIO attachments of a piece. A failed request leaves it unloaded. */
  async function ensureAudioForPiece(pieceId: number): Promise<PieceAttachmentResponseDto[]> {
    if (audioByPiece.value[pieceId]) return audioByPiece.value[pieceId]!
    if (!orgSlug.value) return []
    try {
      const api = useApi()
      const list = await api<PieceAttachmentResponseDto[]>(
        `/organizations/${orgSlug.value}/pieces/${pieceId}/attachments`,
        { query: { kind: 'AUDIO' } }
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

  /** Builds the proxied cover-image URL for a piece (browser follows the 302 to R2). */
  function coverUrl(piece: PieceListItemDto | undefined): string | null {
    if (!piece || !piece.coverAttachmentId || !orgSlug.value) return null
    return `/api/organizations/${orgSlug.value}/pieces/${piece.id}/attachments/${piece.coverAttachmentId}/download`
  }

  /** Lazily loads (and caches) the actions of a piece type. Tolerates the gated-feature 403/404. */
  async function loadActionsForType(typeId: number): Promise<PieceTypeActionResponseDto[]> {
    if (actionsByType.value[typeId]) return actionsByType.value[typeId]!
    if (!orgSlug.value) return []
    try {
      const api = useApi()
      const actions = await api<PieceTypeActionResponseDto[]>(
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

  /** Lazily loads (and caches) a piece's full detail, including its attribute values. */
  async function ensurePieceDetail(id: number): Promise<PieceResponseDto | undefined> {
    if (pieceDetails.value[id]) return pieceDetails.value[id]
    if (!orgSlug.value) return undefined
    try {
      const api = useApi()
      const detail = await api<PieceResponseDto>(`/organizations/${orgSlug.value}/pieces/${id}`)
      pieceDetails.value = { ...pieceDetails.value, [id]: detail }
      return detail
    } catch {
      return undefined
    }
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
    loadActionsForType,
    actionsForPiece,
    ensureActionsForPiece,
    pieceDetailById,
    ensurePieceDetail,
    portById,
    portsForPiece,
    typeIdOfAction,
    kindOfAction,
    isAudioPiece,
    audioByPiece,
    ensureAudioForPiece,
    audioForPiece,
    audioLoadedForPiece,
    attachmentContentUrl,
    reset
  }
})
