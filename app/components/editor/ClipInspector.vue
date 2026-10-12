<script setup lang="ts">
import type { ActionParameterDto } from '~/types/api'

const scene = useSceneStore()
const selection = useSelectionStore()
const catalog = useCatalogStore()

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
const dynamicParams = computed(() =>
  selectedAction.value?.parameters.filter(p => p.dynamic && !p.isDuration) ?? [])
const staticParams = computed(() =>
  selectedAction.value?.parameters.filter(p => !p.dynamic && !p.isDuration) ?? [])

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

      <div v-if="dynamicParams.length" class="flex flex-col gap-3 border-t border-line pt-3">
        <span class="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Paràmetres</span>
        <EditorActionParameterInput
          v-for="param in dynamicParams"
          :key="param.name"
          :param="param"
          :model-value="clip.paramValues[param.name]"
          @update:model-value="setParam(param, $event)" />
      </div>

      <div v-if="staticParams.length" class="flex flex-col gap-2 border-t border-line pt-3">
        <span class="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Valors fixos</span>
        <dl class="flex flex-col gap-1 text-[12px]">
          <div v-for="param in staticParams" :key="param.name" class="flex items-center justify-between gap-2">
            <dt class="text-ink-soft">{{ param.displayName }}</dt>
            <dd class="truncate text-right text-ink" :title="formatStatic(param)">{{ formatStatic(param) }}</dd>
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

    <p class="mt-3 text-[11.5px] text-ink-muted">
      Fes doble clic a la seva pista (a baix) per afegir una acció.
    </p>
  </section>

  <!-- Nothing selected -->
  <section v-else class="panel p-4 text-center text-[12.5px] text-ink-muted">
    Selecciona un article del tauler o un clip de la línia de temps per editar-lo.
  </section>
</template>
