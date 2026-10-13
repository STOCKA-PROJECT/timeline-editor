<script setup lang="ts">
import type { ActionParameterDto } from '~/types/api'
import { catalog as outputCatalog, actionParams, isOutputKind, type CatalogType } from '~/types/catalog'
import { assetNameFor, audioFileWindow, formatClock } from '~/utils/audioAssets'
import { LED_PATH_PRESET_LABELS, ledPathOf, presetOfPath, presetPath, reverseLedPath, type LedPathPreset } from '~/utils/ledPath'
import { layoutStrip } from '~/utils/stripLayout'
import { getAudioContext, loadDecodedAudio } from '~/utils/audioCache'
import { parseRgb } from '~/utils/showCoerce'

const scene = useSceneStore()
const selection = useSelectionStore()
const catalog = useCatalogStore()
const config = useRuntimeConfig()
const { audioClipOf } = useAudioClips()
const { ledClipOf } = useLedClips()

const clip = computed(() => (selection.selectedClipId ? scene.clipById(selection.selectedClipId) : null) ?? null)
const item = computed(() => {
  if (clip.value) {
    const track = scene.trackById(clip.value.trackId)
    return track ? scene.itemById(track.itemId) : null
  }
  return selection.selectedItemId ? scene.itemById(selection.selectedItemId) : null
})
const piece = computed(() => catalog.pieceById(item.value?.pieceId ?? -1))
const actions = computed(() => catalog.actionsForPiece(piece.value))
const selectedAction = computed(() => actions.value.find(a => a.id === clip.value?.pieceTypeActionId) ?? null)

// The action's duration parameter (if any) IS the clip length, so it is shown as the single
// "Duración" field below — never as a normal param input or a fixed value.
const durationParam = computed(() => selectedAction.value?.parameters.find(p => p.isDuration) ?? null)
// Only dynamic params are editable per clip; static ones use the value fixed on the action.
// An audio clip edits its file and in-point in the dedicated block below, not as plain inputs.
// For `animate`, only the parameters of the chosen animation are shown (a type may declare the
// parameters of every animation on the same action).
const AUDIO_BLOCK_PARAMS = new Set(['audio_name', 'start'])
const dynamicParams = computed(() =>
  selectedAction.value?.parameters.filter(p =>
    p.dynamic && !p.isDuration
    && !(audioInfo.value && AUDIO_BLOCK_PARAMS.has(p.name))
    && (applicableParamNames.value === null || applicableParamNames.value.has(p.name))) ?? [])
/** Names the catalog allows for the action with the clip's animation, or null when the action is not in the catalog. */
const applicableParamNames = computed<Set<string> | null>(() => {
  const action = selectedAction.value
  const spec = actionKind.value && action ? outputCatalog.kinds[actionKind.value].actions[action.name] : undefined
  if (!spec || !action) return null
  return new Set(Object.keys(actionParams(spec, selectedAnimation.value)))
})

// ---- audio clips (audio.play): file, window of the file, listen ----
const audioInfo = computed(() => (clip.value ? audioClipOf(clip.value) : null))
const audioFiles = computed(() => (piece.value ? catalog.audioForPiece(piece.value.id) : []))
const audioLoaded = computed(() => !!piece.value && catalog.audioLoadedForPiece(piece.value.id))
const fileSec = computed(() => (audioInfo.value?.fileDurationMs != null ? audioInfo.value.fileDurationMs / 1000 : null))
/** Seconds of the file that will sound (cut at the end of the file when its length is known). */
const audioWindow = computed(() => {
  const info = audioInfo.value
  if (!info) return null
  const w = audioFileWindow(info.range, info.fileDurationMs)
  return { fromSec: w.fromSec, toSec: w.toSec ?? (fileSec.value ?? w.fromSec), beyondEndSec: w.beyondEndSec }
})
/** End of the clip's window as the user asked for it (may run past the end of the file). */
const audioEndSec = computed(() => {
  const info = audioInfo.value
  if (!info) return 0
  return info.range.startSec + (info.range.durationSec ?? Math.max(0, (fileSec.value ?? 0) - info.range.startSec))
})
const pieceUrl = computed(() => {
  const base = (config.public.stockaUrl as string).replace(/\/+$/, '')
  return piece.value && scene.orgSlug ? `${base}/dashboard/${scene.orgSlug}/articulos/${piece.value.id}` : base
})

/** Points the clip at one of the piece's files: whole file by default (in-point 0, clip as long as the file). */
function setAudioFile(attachmentId: number) {
  const info = audioInfo.value
  const att = audioFiles.value.find(a => a.id === attachmentId)
  if (!clip.value || !info || !att) return
  const paramValues: Record<string, unknown> = { ...clip.value.paramValues, audio_name: assetNameFor(att) }
  if (info.startEditable) paramValues.start = 0
  const durationMs = info.durationEditable && att.durationMs ? Math.max(100, att.durationMs) : clip.value.durationMs
  scene.updateClip(clip.value.id, { paramValues, durationMs })
}

/** In-point of the file; the clip keeps its length unless that would run past the end of the file. */
function setAudioStart(sec: number) {
  const info = audioInfo.value
  if (!clip.value || !info || !info.startEditable) return
  const start = Math.max(0, Math.round((Number.isFinite(sec) ? sec : 0) * 1000) / 1000)
  const bounded = fileSec.value != null ? Math.min(start, fileSec.value) : start
  const partial: Partial<typeof clip.value> = { paramValues: { ...clip.value.paramValues, start: bounded } }
  if (info.durationEditable && fileSec.value != null) {
    partial.durationMs = Math.max(100, Math.min(clip.value.durationMs, Math.round((fileSec.value - bounded) * 1000)))
  }
  scene.updateClip(clip.value.id, partial)
}

/** Out-point of the file: sets the clip length (its play time) from the in-point. */
function setAudioEnd(sec: number) {
  const info = audioInfo.value
  if (!clip.value || !info || !info.durationEditable) return
  const end = fileSec.value != null ? Math.min(sec, fileSec.value) : sec
  scene.updateClip(clip.value.id, { durationMs: Math.max(100, Math.round((end - info.range.startSec) * 1000)) })
}

function useWholeFile() {
  const info = audioInfo.value
  if (!clip.value || !info) return
  const partial: Partial<typeof clip.value> = {}
  if (info.startEditable) partial.paramValues = { ...clip.value.paramValues, start: 0 }
  if (info.durationEditable && info.fileDurationMs) partial.durationMs = Math.max(100, info.fileDurationMs)
  scene.updateClip(clip.value.id, partial)
}

// Listen to the selected window (independent from the timeline preview).
let previewSource: AudioBufferSourceNode | null = null
const previewPlaying = ref(false)
function stopPreviewAudio() {
  try { previewSource?.stop() } catch { /* already ended */ }
  previewSource = null
  previewPlaying.value = false
}
async function togglePreviewAudio() {
  if (previewPlaying.value) {
    stopPreviewAudio()
    return
  }
  const info = audioInfo.value
  if (!info?.url) return
  const ctx = getAudioContext()
  await ctx.resume()
  const decoded = await loadDecodedAudio(info.url)
  const w = audioFileWindow(info.range, decoded.durationMs)
  const length = (w.toSec ?? decoded.buffer.duration) - w.fromSec
  if (length <= 0) return
  const src = ctx.createBufferSource()
  src.buffer = decoded.buffer
  src.connect(ctx.destination)
  src.onended = () => {
    if (previewSource === src) stopPreviewAudio()
  }
  src.start(0, w.fromSec, length)
  previewSource = src
  previewPlaying.value = true
}
watch(clip, stopPreviewAudio)
onBeforeUnmount(stopPreviewAudio)

// The waveform fills the panel width.
const waveBox = ref<HTMLElement | null>(null)
const waveWidth = ref(240)
let waveObserver: ResizeObserver | null = null
watch(waveBox, (el) => {
  waveObserver?.disconnect()
  waveObserver = null
  if (!el || typeof ResizeObserver === 'undefined') return
  waveObserver = new ResizeObserver(([entry]) => {
    if (entry) waveWidth.value = Math.max(1, Math.floor(entry.contentRect.width))
  })
  waveObserver.observe(el as Element)
})
onBeforeUnmount(() => waveObserver?.disconnect())
const staticParams = computed(() =>
  selectedAction.value?.parameters.filter(p => !p.dynamic && !p.isDuration) ?? [])

// ---- catalog-aware inputs ----
/** Output kind of the piece type that owns the selected action, when it drives hardware. */
const actionKind = computed(() => {
  if (!selectedAction.value || !piece.value) return null
  const typeId = catalog.typeIdOfAction(selectedAction.value.id)
  const kind = piece.value.pieceTypes.find(t => t.id === typeId)?.kind
  return isOutputKind(kind) ? kind : null
})
/** Catalog type of each parameter of the selected action (empty for actions outside the catalog). */
const catalogParamTypes = computed<Record<string, CatalogType>>(() => {
  const action = selectedAction.value
  const spec = actionKind.value && action ? outputCatalog.kinds[actionKind.value].actions[action.name] : undefined
  if (!spec || !action) return {}
  // For `animate`, the extra parameters depend on the animation: fixed on the type or set per clip.
  return Object.fromEntries(Object.entries(actionParams(spec, selectedAnimation.value)).map(([name, p]) => [name, p.type]))
})
// ---- LED preview ----
/** Animation the clip will run: fixed on the action or chosen on the clip (null when unknown). */
const selectedAnimation = computed<string | null>(() => {
  const animParam = selectedAction.value?.parameters.find(p => p.name === 'animation_type')
  if (!animParam) return null
  const v = animParam.dynamic ? clip.value?.paramValues.animation_type : animParam.staticValue
  return typeof v === 'string' && v ? v : null
})
/** The clip as a LED action, its parameters coerced like the export (null for other clips). */
const ledClip = computed(() => (clip.value ? ledClipOf(clip.value) : null))
/** LEDs of the figure according to its own numeric attribute (e.g. «Longitud»), or null. */
const pieceLedCount = computed<number | null>(() => (piece.value ? catalog.ledLengthOf(piece.value.id) : null))
/** LEDs of the port of the action's type assigned to the item (segment range or strip length), or null. */
const portLedCount = computed<number | null>(() => {
  const typeId = selectedAction.value ? catalog.typeIdOfAction(selectedAction.value.id) : undefined
  for (const id of item.value?.ports ?? []) {
    const port = catalog.portById(id)
    if (!port || port.pieceTypeId !== typeId) continue
    const cfg = (port.config ?? {}) as Record<string, unknown>
    if (port.kind === 'led_segment' && typeof cfg.first === 'number' && typeof cfg.last === 'number') return Math.abs(cfg.last - cfg.first) + 1
    if (port.kind === 'led_strip' && typeof cfg.length === 'number') return cfg.length
  }
  return null
})
/**
 * What the preview draws: only the LEDs the clip selects with first/last, otherwise every LED
 * of the figure (its length attribute; the port as a fallback; 44 when nothing is known).
 */
const preview = computed(() => {
  const first = ledClip.value?.first ?? null
  const last = ledClip.value?.last ?? null
  if (first != null || last != null) {
    const a = first ?? 0
    const b = last ?? (pieceLedCount.value ?? portLedCount.value ?? 44) - 1
    return { pixels: Math.abs(b - a) + 1, source: `LED seleccionats del ${Math.min(a, b)} al ${Math.max(a, b)}` }
  }
  if (pieceLedCount.value != null) return { pixels: pieceLedCount.value, source: 'longitud de la figura' }
  if (portLedCount.value != null) return { pixels: portLedCount.value, source: 'segons el port; posa un atribut «Longitud» a la figura' }
  return { pixels: 44, source: 'nombre desconegut; posa un atribut «Longitud» a la figura' }
})
/** `#rrggbb` of a static rgb parameter for a colour swatch, or null when not a colour. */
function staticSwatch(param: ActionParameterDto): string | null {
  if (catalogParamTypes.value[param.name] !== 'rgb') return null
  const rgb = parseRgb(param.staticValue)
  return rgb ? '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('') : null
}

// A static duration fixes the clip length on the type; a dynamic one is edited here per clip.
const durationIsStatic = computed(() => !!durationParam.value && !durationParam.value.dynamic)
const staticDurationSeconds = computed(() => {
  const raw = durationParam.value?.staticValue
  const n = raw == null ? NaN : Number(raw)
  return Number.isFinite(n) && n > 0 ? n : null
})
const durationLabel = computed(() =>
  durationParam.value ? `${durationParam.value.displayName} (s)` : 'Durada (s)')

// Keep the clip length in sync with a static duration parameter (fixed by the type).
watch([clip, staticDurationSeconds, durationIsStatic], () => {
  if (!clip.value || !durationIsStatic.value || staticDurationSeconds.value == null) return
  const ms = Math.round(staticDurationSeconds.value * 1000)
  if (clip.value.durationMs !== ms) scene.updateClip(clip.value.id, { durationMs: ms })
}, { immediate: true })

/** Renders a static value for read-only display (booleans and multi-select arrays made friendly). */
function formatStatic(param: ActionParameterDto): string {
  const raw = param.staticValue
  if (raw == null || raw === '') return '—'
  if (param.type === 'BOOLEAN') return raw === 'true' ? 'Sí' : 'No'
  if (param.type === 'MULTI_SELECT') {
    const trimmed = raw.trim()
    if (trimmed.startsWith('[')) {
      try {
        const parsed = JSON.parse(trimmed) as unknown
        if (Array.isArray(parsed)) return parsed.map(String).join(', ')
      } catch { /* fall through to raw */ }
    }
  }
  return raw
}

watch(piece, p => {
  if (p) {
    catalog.ensureActionsForPiece(p)
    catalog.ensurePieceDetail(p.id)
    if (catalog.isAudioPiece(p)) catalog.ensureAudioForPiece(p.id)
  }
}, { immediate: true })

function setAction(id: number) {
  if (!clip.value || !actions.value.some(a => a.id === id)) return
  // Reset param values when switching action.
  scene.updateClip(clip.value.id, { pieceTypeActionId: id, paramValues: {} })
}

function setParam(param: ActionParameterDto, value: unknown) {
  if (!clip.value) return
  scene.updateClip(clip.value.id, { paramValues: { ...clip.value.paramValues, [param.name]: value } })
}

function setStartSec(sec: number) {
  if (clip.value) scene.updateClip(clip.value.id, { startMs: Math.max(0, Math.round(sec * 1000)) })
}
function setDurationSec(sec: number) {
  if (clip.value) scene.updateClip(clip.value.id, { durationMs: Math.max(100, Math.round(sec * 1000)) })
}

// Item size is shown/edited in centimetres; the board scale keeps px and cm in sync.
function cmValue(px: number): string {
  return scene.pxToCm(px).toFixed(1)
}
function setWidthCm(cm: number) {
  if (item.value) scene.updateItem(item.value.id, { width: scene.cmToPx(Math.max(0.1, cm)) })
}
function setHeightCm(cm: number) {
  if (item.value) scene.updateItem(item.value.id, { height: scene.cmToPx(Math.max(0.1, cm)) })
}
function setXCm(cm: number) {
  if (item.value) scene.updateItem(item.value.id, { x: scene.cmToPx(cm) })
}
function setYCm(cm: number) {
  if (item.value) scene.updateItem(item.value.id, { y: scene.cmToPx(cm) })
}
function setRotation(deg: number) {
  // Normalise to [0, 360).
  if (item.value) scene.updateItem(item.value.id, { rotation: ((Math.round(deg) % 360) + 360) % 360 })
}

// ----- bind width/height to a numeric piece attribute -----
const NUMERIC_TYPES = new Set(['INTEGER', 'DECIMAL', 'PRICE'])
const detail = computed(() => catalog.pieceDetailById(item.value?.pieceId ?? -1))
/** Numeric attribute values of the piece, usable as a dimension (cm). */
const numericAttrs = computed(() =>
  (detail.value?.attributeValues ?? []).filter(
    a => NUMERIC_TYPES.has(a.type) && a.value != null && Number.isFinite(Number(a.value))
  ))

/** Centimetre value of the attribute bound by `attrName`, or null if unavailable. */
function attrCm(attrName: string | null | undefined): number | null {
  if (!attrName) return null
  const a = numericAttrs.value.find(x => x.attributeName === attrName)
  if (!a || a.value == null) return null
  const n = Number(a.value)
  return Number.isFinite(n) && n > 0 ? n : null
}

function setWidthAttr(attrName: string) {
  if (!item.value) return
  scene.updateItem(item.value.id, { widthAttr: attrName || null })
}
function setHeightAttr(attrName: string) {
  if (!item.value) return
  scene.updateItem(item.value.id, { heightAttr: attrName || null })
}

// Keep the bound dimensions in sync with their attribute value (when the detail loads / changes).
watch([item, detail], () => {
  if (!item.value) return
  const wCm = attrCm(item.value.widthAttr)
  if (wCm != null) {
    const px = scene.cmToPx(wCm)
    if (item.value.width !== px) scene.updateItem(item.value.id, { width: px })
  }
  const hCm = attrCm(item.value.heightAttr)
  if (hCm != null) {
    const px = scene.cmToPx(hCm)
    if (item.value.height !== px) scene.updateItem(item.value.id, { height: px })
  }
}, { immediate: true })

// ----- LEDs on the board: the path the LEDs of the piece follow -----
const isLedPiece = computed(() => catalog.isLedPiece(piece.value))
const ledPreset = computed(() => (item.value ? presetOfPath(ledPathOf(item.value)) : null))
const drawingLed = computed(() => !!item.value && selection.drawingLedPathFor === item.value.id)

function setLedPreset(name: string) {
  if (item.value && name in LED_PATH_PRESET_LABELS) scene.updateItem(item.value.id, { ledPath: presetPath(name as LedPathPreset) })
}
function reverseLed() {
  if (item.value) scene.updateItem(item.value.id, { ledPath: reverseLedPath(ledPathOf(item.value)) })
}
/** Starts an empty path: the board adds a point per click until the user finishes. */
function startDrawingLed() {
  if (!item.value) return
  scene.updateItem(item.value.id, { ledPath: [] })
  selection.startLedPath(item.value.id)
}

// ----- ports (hardware outputs assigned to the item) -----
/** Ports assignable to the selected item = those whose piece type matches its piece. */
const compatiblePorts = computed(() => catalog.portsForPiece(piece.value))

/**
 * Port ids still assigned to the item that no longer exist in the organization (deleted after the
 * scene was saved). Only computed once the ports request succeeded, so a failed load never shows
 * every assignment as stale. Export refuses the scene until they are removed.
 */
const stalePortIds = computed(() =>
  catalog.portsLoaded ? (item.value?.ports ?? []).filter(id => !catalog.portById(id)) : [])

function isPortSelected(portId: number): boolean {
  return (item.value?.ports ?? []).includes(portId)
}

function removePort(portId: number) {
  togglePort(portId, false)
}

/** Adds or removes a port id from the item, keeping zero/one/many assignments. */
function togglePort(portId: number, checked: boolean) {
  if (!item.value) return
  const current = item.value.ports ?? []
  const next = checked
    ? (current.includes(portId) ? current : [...current, portId])
    : current.filter(id => id !== portId)
  scene.updateItem(item.value.id, { ports: next })
}

// ----- pieces along a LED strip: order and LED ranges -----
/** Strip ports assigned to the item: each lists the pieces on it in LED order, with their ranges. */
const stripsOfItem = computed(() => {
  if (!item.value) return []
  return (item.value.ports ?? [])
    .map(id => catalog.portById(id))
    .filter((p): p is NonNullable<typeof p> => !!p && p.kind === 'led_strip')
    .map((port) => {
      const mates = scene.itemsOnPort(port.id)
      const stripLength = typeof port.config?.length === 'number' ? port.config.length : null
      const layout = layoutStrip(mates.map(m => m.id), id => catalog.ledLengthOf(mates.find(m => m.id === id)!.pieceId), stripLength)
      return {
        port,
        stripLength,
        rows: mates.map((m, index) => {
          const slot = layout.get(m.id)!
          return {
            itemId: m.id,
            name: catalog.pieceById(m.pieceId)?.name ?? `#${m.pieceId}`,
            length: slot.length,
            explicit: slot.explicit,
            first: slot.offset,
            last: slot.offset + slot.length - 1,
            overflow: stripLength != null && slot.offset + slot.length > stripLength,
            needsLength: !slot.explicit && index < mates.length - 1
          }
        })
      }
    })
})
// Lengths come from the piece details: load them for every piece sharing a strip with this item.
watch(stripsOfItem, (strips) => {
  for (const s of strips) for (const row of s.rows) {
    const mate = scene.itemById(row.itemId)
    if (mate) catalog.ensurePieceDetail(mate.pieceId)
  }
}, { immediate: true })
</script>

<template>
  <!-- Clip selected -->
  <section v-if="clip" class="panel p-3">
    <div class="flex items-center justify-between">
      <h2 class="text-[13px] font-semibold text-ink">Clip</h2>
      <button class="btn btn-danger !h-7 !px-2 !text-[12px]" @click="scene.removeClip(clip.id); selection.selectClip(null)">
        Elimina
      </button>
    </div>
    <p class="mt-0.5 text-[12px] text-ink-muted">{{ piece?.name ?? 'Article' }}</p>

    <div class="mt-3 flex flex-col gap-3">
      <div class="flex flex-col gap-1">
        <label class="text-[12px] font-medium text-ink-soft">Acció</label>
        <select class="field" :value="clip.pieceTypeActionId ?? ''"
          @change="setAction(Number(($event.target as HTMLSelectElement).value))">
          <!-- Clips saved without an action keep a blank value until a real action is picked. -->
          <option v-if="clip.pieceTypeActionId == null" value="" disabled>Selecciona una acció</option>
          <option v-for="a in actions" :key="a.id" :value="a.id">{{ a.displayName }}</option>
        </select>
        <p v-if="actions.length === 0" class="text-[11.5px] text-ink-muted">
          Aquest article no té cap acció disponible.
        </p>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-ink-soft">Inici (s)</label>
          <input class="field" type="number" step="0.05" min="0" :value="(clip.startMs / 1000).toFixed(2)"
            @change="setStartSec(Number(($event.target as HTMLInputElement).value))">
        </div>
        <div class="flex flex-col gap-1">
          <label class="text-[12px] font-medium text-ink-soft">{{ durationLabel }}</label>
          <input class="field" type="number" step="0.05" min="0.1"
            :value="(clip.durationMs / 1000).toFixed(2)"
            :readonly="durationIsStatic" :disabled="durationIsStatic"
            @change="setDurationSec(Number(($event.target as HTMLInputElement).value))">
        </div>
      </div>
      <p v-if="durationParam" class="-mt-1 text-[11px] text-ink-muted">
        {{ durationIsStatic
          ? 'Durada fixa definida al tipus d\'article.'
          : 'Aquest temps defineix la longitud del clip.' }}
      </p>

      <!-- Audio clip: which file and which part of it -->
      <div v-if="audioInfo" class="flex flex-col gap-2 border-t border-line pt-3">
        <span class="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Fitxer d'àudio</span>
        <select class="field" :value="audioInfo.attachment?.id ?? ''"
          @change="setAudioFile(Number(($event.target as HTMLSelectElement).value))">
          <option value="" disabled>{{ audioFiles.length ? 'Tria un fitxer' : 'Cap fitxer d\'àudio' }}</option>
          <option v-for="a in audioFiles" :key="a.id" :value="a.id">{{ a.originalFilename }} · {{ formatClock(a.durationMs) }}</option>
        </select>
        <p v-if="!audioFiles.length && audioLoaded" class="text-[11.5px] text-ink-muted">
          Aquest article no té cap fitxer d'àudio.
          <a class="underline" :href="pieceUrl" target="_blank" rel="noopener">Puja'n un a la fitxa de l'article</a>.
        </p>
        <p v-else-if="audioInfo.assetName && !audioInfo.attachment && audioLoaded" class="text-[11.5px] text-danger">
          El fitxer «{{ audioInfo.assetName }}» ja no és entre els àudios de l'article. Tria'n un altre.
        </p>
        <template v-if="audioInfo.attachment">
          <div ref="waveBox" class="h-10 w-full overflow-hidden rounded-[6px] border border-line bg-bg-soft">
            <EditorAudioWave :url="audioInfo.url" :from-sec="0" :to-sec="null" :width="waveWidth" :height="40" :highlight="audioWindow" />
          </div>
          <div class="grid grid-cols-2 gap-2">
            <div class="flex flex-col gap-1">
              <label class="text-[12px] font-medium text-ink-soft">Des del segon</label>
              <input class="field" type="number" step="0.05" min="0" :max="fileSec ?? undefined"
                :value="audioInfo.range.startSec.toFixed(2)"
                :disabled="!audioInfo.startEditable"
                @change="setAudioStart(Number(($event.target as HTMLInputElement).value))">
            </div>
            <div class="flex flex-col gap-1">
              <label class="text-[12px] font-medium text-ink-soft">Fins al segon</label>
              <input class="field" type="number" step="0.05" min="0" :max="fileSec ?? undefined"
                :value="audioEndSec.toFixed(2)"
                :disabled="!audioInfo.durationEditable"
                @change="setAudioEnd(Number(($event.target as HTMLInputElement).value))">
            </div>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <button class="btn !h-7 !px-2 !text-[12px]" :disabled="!audioInfo.durationEditable && !audioInfo.startEditable" @click="useWholeFile">Tot el fitxer</button>
            <button class="btn !h-7 !px-2 !text-[12px]" @click="togglePreviewAudio">{{ previewPlaying ? 'Atura' : 'Escolta el tram' }}</button>
            <span class="text-[11px] text-ink-muted">Fitxer de {{ formatClock(audioInfo.fileDurationMs) }}</span>
          </div>
          <p v-if="audioWindow && audioWindow.beyondEndSec > 0.05" class="text-[11px] text-danger">
            El clip s'allarga {{ audioWindow.beyondEndSec.toFixed(1) }} s més enllà del final del fitxer: aquesta part no sonarà.
          </p>
          <p v-if="!audioInfo.startEditable || !audioInfo.durationEditable" class="text-[11px] text-ink-muted">
            {{ !audioInfo.startEditable ? 'El segon d\'inici és fix al tipus d\'article.' : '' }}
            {{ !audioInfo.durationEditable ? 'La durada no depèn del clip: afegeix el paràmetre «time» com a durada a l\'acció.' : '' }}
          </p>
          <p v-else class="text-[11px] text-ink-muted">Arrossega les vores del clip a la línia de temps per retallar el tram.</p>
        </template>
      </div>

      <div v-if="dynamicParams.length" class="flex flex-col gap-3 border-t border-line pt-3">
        <span class="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Paràmetres</span>
        <EditorActionParameterInput
          v-for="param in dynamicParams"
          :key="param.name"
          :param="param"
          :catalog-type="catalogParamTypes[param.name] ?? null"
          :model-value="clip.paramValues[param.name]"
          @update:model-value="setParam(param, $event)" />
      </div>

      <div v-if="ledClip" class="border-t border-line pt-3">
        <EditorLedPreview
          :action="ledClip.action"
          :animation="ledClip.animation"
          :params="ledClip.params"
          :pixels="preview.pixels"
          :source="preview.source"
          :duration-sec="ledClip.durationSec" />
      </div>

      <div v-if="staticParams.length" class="flex flex-col gap-2 border-t border-line pt-3">
        <span class="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Valors fixos</span>
        <dl class="flex flex-col gap-1 text-[12px]">
          <div v-for="param in staticParams" :key="param.name" class="flex items-center justify-between gap-2">
            <dt class="text-ink-soft">{{ param.displayName }}</dt>
            <dd class="flex min-w-0 items-center justify-end gap-1.5 text-ink" :title="formatStatic(param)">
              <span v-if="staticSwatch(param)" class="h-3.5 w-3.5 flex-shrink-0 rounded-[3px] border border-line" :style="{ background: staticSwatch(param)! }" />
              <span class="truncate">{{ formatStatic(param) }}</span>
            </dd>
          </div>
        </dl>
        <p class="text-[11px] text-ink-muted">Aquests valors es defineixen al tipus d'article.</p>
      </div>
    </div>
  </section>

  <!-- Item selected (no clip) -->
  <section v-else-if="item" class="panel p-3">
    <div class="flex items-center justify-between">
      <h2 class="text-[13px] font-semibold text-ink">Article</h2>
      <button class="btn btn-danger !h-7 !px-2 !text-[12px]" @click="scene.removeItem(item.id); selection.selectItem(null)">
        Treu
      </button>
    </div>
    <p class="mt-0.5 text-[12px] text-ink">{{ piece?.name ?? ('#' + item.pieceId) }}</p>

    <!-- Width: manual cm or driven by a numeric attribute -->
    <div class="mt-3 flex flex-col gap-1">
      <label class="text-[12px] font-medium text-ink-soft">Amplada (cm)</label>
      <div class="flex gap-2">
        <select class="field min-w-0 flex-1"
          :value="item.widthAttr ?? ''"
          @change="setWidthAttr(($event.target as HTMLSelectElement).value)">
          <option value="">Manual</option>
          <option v-for="a in numericAttrs" :key="'w' + a.scope + a.attributeId" :value="a.attributeName">
            {{ a.displayName }}
          </option>
        </select>
        <input class="field w-24 flex-shrink-0" type="number" step="0.1" min="0.1"
          :value="cmValue(item.width)"
          :readonly="!!item.widthAttr" :disabled="!!item.widthAttr"
          @change="setWidthCm(Number(($event.target as HTMLInputElement).value))">
      </div>
    </div>

    <!-- Height: manual cm or driven by a numeric attribute -->
    <div class="mt-2 flex flex-col gap-1">
      <label class="text-[12px] font-medium text-ink-soft">Alçada (cm)</label>
      <div class="flex gap-2">
        <select class="field min-w-0 flex-1"
          :value="item.heightAttr ?? ''"
          @change="setHeightAttr(($event.target as HTMLSelectElement).value)">
          <option value="">Manual</option>
          <option v-for="a in numericAttrs" :key="'h' + a.scope + a.attributeId" :value="a.attributeName">
            {{ a.displayName }}
          </option>
        </select>
        <input class="field w-24 flex-shrink-0" type="number" step="0.1" min="0.1"
          :value="cmValue(item.height)"
          :readonly="!!item.heightAttr" :disabled="!!item.heightAttr"
          @change="setHeightCm(Number(($event.target as HTMLInputElement).value))">
      </div>
    </div>
    <p v-if="item.widthAttr || item.heightAttr" class="mt-1 text-[11px] text-ink-muted">
      Les dimensions marcades es prenen de l'atribut de l'article.
    </p>
    <div class="mt-2 grid grid-cols-2 gap-2">
      <div class="flex flex-col gap-1">
        <label class="text-[12px] font-medium text-ink-soft">X (cm)</label>
        <input class="field" type="number" step="0.1"
          :value="cmValue(item.x)"
          @change="setXCm(Number(($event.target as HTMLInputElement).value))">
      </div>
      <div class="flex flex-col gap-1">
        <label class="text-[12px] font-medium text-ink-soft">Y (cm)</label>
        <input class="field" type="number" step="0.1"
          :value="cmValue(item.y)"
          @change="setYCm(Number(($event.target as HTMLInputElement).value))">
      </div>
    </div>
    <div class="mt-2 flex flex-col gap-1">
      <label class="text-[12px] font-medium text-ink-soft">Rotació (°)</label>
      <input class="field" type="number" step="1"
        :value="item.rotation"
        @change="setRotation(Number(($event.target as HTMLInputElement).value))">
    </div>

    <!-- Ports: sortides de maquinari assignades (cap, una o diverses) compatibles amb el tipus de l'article -->
    <div class="mt-3 flex flex-col gap-1 border-t border-line pt-3">
      <span class="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Ports</span>
      <div v-if="compatiblePorts.length" class="flex flex-col gap-1">
        <label v-for="p in compatiblePorts" :key="p.id" class="flex items-center gap-2 text-[12.5px] text-ink">
          <input type="checkbox" :checked="isPortSelected(p.id)"
            @change="togglePort(p.id, ($event.target as HTMLInputElement).checked)">
          <span class="min-w-0 flex-1 truncate" :title="p.name">{{ p.name }}</span>
          <span v-if="p.pin != null" class="flex-shrink-0 text-[11px] text-ink-muted">pin {{ p.pin }}</span>
        </label>
      </div>
      <p v-else class="text-[11.5px] text-ink-muted">
        Aquest article no té cap port compatible.
      </p>

      <!-- Pieces sharing a LED strip: their order along the strip decides which LEDs each one gets -->
      <div v-for="s in stripsOfItem" :key="'strip' + s.port.id" class="mt-2 flex flex-col gap-1 rounded-[6px] border border-line bg-bg-soft p-2">
        <span class="text-[11px] font-semibold text-ink-soft">
          Ordre a «{{ s.port.name }}»<span v-if="s.stripLength != null" class="font-normal text-ink-muted"> · {{ s.stripLength }} LED</span>
        </span>
        <div v-for="(row, index) in s.rows" :key="row.itemId"
          class="flex items-center gap-1.5 text-[12px]"
          :class="row.itemId === item.id ? 'font-medium text-ink' : 'text-ink-soft'">
          <span class="w-4 flex-shrink-0 text-right text-[11px] text-ink-muted">{{ index + 1 }}.</span>
          <span class="min-w-0 flex-1 truncate" :title="row.name">{{ row.name }}</span>
          <span class="flex-shrink-0 font-mono text-[11px] tabular-nums" :class="row.overflow || row.needsLength ? 'text-danger' : 'text-ink-muted'">
            <template v-if="row.length > 0">LED {{ row.first }}–{{ row.last }}</template>
            <template v-else>sense LED</template>
            <template v-if="!row.explicit"> (resta)</template>
          </span>
          <button class="btn !h-6 !w-6 !px-0 !text-[11px]" :disabled="index === 0" title="Abans a la tira" @click="scene.moveItemOnPort(s.port.id, row.itemId, -1)">▲</button>
          <button class="btn !h-6 !w-6 !px-0 !text-[11px]" :disabled="index === s.rows.length - 1" title="Després a la tira" @click="scene.moveItemOnPort(s.port.id, row.itemId, 1)">▼</button>
        </div>
        <p class="text-[11px] text-ink-muted">
          Cada peça ocupa tants LED com diu el seu atribut «Longitud», un darrere l'altra en aquest ordre; l'última pot quedar-se la resta. Els «primer/últim LED» dels clips es compten dins de la peça.
        </p>
        <p v-if="s.rows.some(r => r.needsLength)" class="text-[11px] text-danger">Una peça sense longitud només pot anar l'última.</p>
        <p v-if="s.rows.some(r => r.overflow)" class="text-[11px] text-danger">Les peces sumen més LED dels que té la tira.</p>
      </div>

      <!-- Assignments to ports deleted after the scene was saved: export refuses them until removed -->
      <div v-if="stalePortIds.length" class="mt-1 flex flex-col gap-1 rounded-[6px] border border-danger-soft bg-danger-soft p-2">
        <span class="text-[11px] font-semibold text-danger">Ports que ja no existeixen</span>
        <div v-for="id in stalePortIds" :key="'stale' + id" class="flex items-center gap-2 text-[12.5px] text-ink">
          <span class="min-w-0 flex-1 truncate">Port {{ id }} (eliminat)</span>
          <button class="btn btn-danger !h-6 !px-2 !text-[11px]" @click="removePort(id)">Treu</button>
        </div>
        <p class="text-[11px] text-ink-muted">Treu-los i marca el port nou de la llista de dalt.</p>
      </div>
    </div>

    <!-- LEDs on the board: where the LEDs of the piece run, so the preview lights them in place -->
    <div v-if="isLedPiece" class="mt-3 flex flex-col gap-1 border-t border-line pt-3">
      <span class="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">LED al tauler</span>
      <template v-if="pieceLedCount">
        <div class="flex gap-2">
          <select class="field min-w-0 flex-1" :value="ledPreset ?? 'custom'" :disabled="drawingLed"
            @change="setLedPreset(($event.target as HTMLSelectElement).value)">
            <option v-for="(label, key) in LED_PATH_PRESET_LABELS" :key="key" :value="key">{{ label }}</option>
            <option v-if="ledPreset === null" value="custom">Personalitzat</option>
          </select>
          <button class="btn !h-8 !px-2 !text-[12px]" :disabled="drawingLed" title="Posa el LED 0 a l'altre extrem" @click="reverseLed">Inverteix</button>
        </div>
        <button v-if="!drawingLed" class="btn !h-8 !px-2 !text-[12px]" @click="startDrawingLed">Dibuixa el traçat al tauler</button>
        <button v-else class="btn btn-primary !h-8 !px-2 !text-[12px]" @click="selection.stopLedPath()">Acaba el traçat</button>
        <p class="text-[11px] text-ink-muted">
          {{ drawingLed
            ? 'Clica al tauler per on passa la tira, punt a punt; Esc també acaba.'
            : `${pieceLedCount} LED repartits al llarg del traçat; el LED 0 és al primer punt.` }}
        </p>
      </template>
      <p v-else class="text-[11.5px] text-ink-muted">
        Posa un atribut numèric «Longitud» a l'article per veure els seus LED al tauler.
      </p>
    </div>

    <p class="mt-3 text-[11.5px] text-ink-muted">
      Fes doble clic a la seva pista (a baix) per afegir una acció.
    </p>
  </section>

  <!-- Nothing selected -->
  <section v-else class="panel p-4 text-center text-[12.5px] text-ink-muted">
    Selecciona un article del tauler o un clip de la línia de temps per editar-lo.
  </section>
</template>
