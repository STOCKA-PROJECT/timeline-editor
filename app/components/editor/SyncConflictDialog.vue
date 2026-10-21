<script setup lang="ts">
import type { BoardConfig, SceneClip, SceneDocument, SceneItem, SceneLayer, SceneTrack } from '~/types/editor'
import type { MergeConflict, MergeSide } from '~/utils/sceneMerge'

// Shown when this laptop's edits and another session's (the web, the assistant, another laptop)
// touched the same things. Everything else is already merged; here the user picks, for each clash,
// their version or the other one. Their own version is preselected: it is usually what they want.

const scene = useSceneStore()
const catalog = useCatalogStore()

const conflicts = computed<MergeConflict[]>(() => scene.pendingMerge?.merge.conflicts ?? [])
const inputs = computed(() => scene.pendingMerge?.merge.inputs)
const choices = ref<Record<string, MergeSide>>({})
const saving = ref(false)
const error = ref<string | null>(null)

watch(conflicts, (list) => {
  choices.value = Object.fromEntries(list.map(c => [c.id, 'local' as const]))
}, { immediate: true })

function docs(): SceneDocument[] {
  const i = inputs.value
  return i ? [i.local, i.remote, ...(i.base ? [i.base] : [])] : []
}

function find<T extends { id: string }>(key: 'items' | 'tracks' | 'layers', id: string): T | undefined {
  for (const d of docs()) {
    const hit = (d[key] as unknown as T[]).find(e => e.id === id)
    if (hit) return hit
  }
  return undefined
}

function pieceName(itemId: string | undefined): string {
  const item = itemId ? find<SceneItem>('items', itemId) : undefined
  return item ? (catalog.pieceById(item.pieceId)?.name ?? `article ${item.pieceId}`) : 'element'
}

function seconds(ms: number): string {
  return `${(ms / 1000).toLocaleString('ca', { maximumFractionDigits: 2 })} s`
}

function title(c: MergeConflict): string {
  switch (c.kind) {
    case 'clip': {
      const clip = (c.local ?? c.remote ?? c.base) as SceneClip
      const track = find<SceneTrack>('tracks', clip.trackId)
      const action = clip.pieceTypeActionId != null ? catalog.actionsForPiece(catalog.pieceById(find<SceneItem>('items', track?.itemId ?? '')?.pieceId ?? -1)).find(a => a.id === clip.pieceTypeActionId) : undefined
      return `Clip ${action?.displayName ?? clip.label ?? ''} de ${pieceName(track?.itemId)}`.replace(/\s+/g, ' ')
    }
    case 'item': return `Element ${pieceName(c.entityId)}`
    case 'track': return `Pista de ${pieceName(((c.local ?? c.remote ?? c.base) as SceneTrack).itemId)}`
    case 'layer': return `Capa ${((c.local ?? c.remote ?? c.base) as SceneLayer).name}`
    case 'board': return 'Mida del tauler'
    case 'durationMs': return 'Durada del show'
    case 'fps': return 'Fotogrames per segon'
    case 'stripOrder': return `Ordre de les peces a la tira ${catalog.portById(Number(c.entityId))?.name ?? c.entityId}`
  }
}

function describe(c: MergeConflict, value: unknown): string {
  if (value === undefined) return 'Esborrat'
  switch (c.kind) {
    case 'clip': {
      const clip = value as SceneClip
      return `comença a ${seconds(clip.startMs)}, dura ${seconds(clip.durationMs)}`
    }
    case 'item': {
      const item = value as SceneItem
      return `a (${scene.pxToCm(item.x).toFixed(1)}, ${scene.pxToCm(item.y).toFixed(1)}) cm, ${scene.pxToCm(item.width).toFixed(1)}×${scene.pxToCm(item.height).toFixed(1)} cm`
    }
    case 'track': return (value as SceneTrack).name
    case 'layer': {
      const layer = value as SceneLayer
      return `${layer.name}${layer.visible ? '' : ' · amagada'}${layer.locked ? ' · bloquejada' : ''}`
    }
    case 'board': {
      const b = value as BoardConfig
      return `${scene.pxToCm(b.width)}×${scene.pxToCm(b.height)} cm`
    }
    case 'durationMs': return seconds(value as number)
    case 'fps': return String(value)
    case 'stripOrder': return (value as string[]).map(id => pieceName(id)).join(' → ') || 'buit'
  }
}

function chooseAll(side: MergeSide) {
  choices.value = Object.fromEntries(conflicts.value.map(c => [c.id, side]))
}

async function apply() {
  saving.value = true
  error.value = null
  try {
    await scene.resolveMerge(choices.value)
  } catch {
    error.value = 'No s’ha pogut desar. Torna-ho a provar.'
  } finally {
    saving.value = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
      <section
        class="panel flex max-h-[85vh] w-[640px] max-w-full flex-col shadow-overlay"
        role="dialog" aria-modal="true" aria-labelledby="sync-conflict-title">
        <header class="border-b border-line-strong px-4 py-3">
          <h2 id="sync-conflict-title" class="font-display text-[15px] font-semibold leading-5 text-ink">Canvis que xoquen</h2>
          <p class="mt-1 text-[13px] leading-[18px] text-ink-soft">
            Mentre editaves, algú altre ha canviat les mateixes coses d’aquesta timeline. La resta de canvis ja s’han
            ajuntat; tria quina versió vols conservar en cada cas.
          </p>
        </header>

        <ul class="min-h-0 flex-1 space-y-2 overflow-y-auto px-4 py-3">
          <li v-for="c in conflicts" :key="c.id" class="rounded-[6px] border border-line px-3 py-2">
            <p class="text-[13px] font-medium leading-[18px] text-ink">{{ title(c) }}</p>
            <div class="mt-1.5 grid grid-cols-2 gap-2" role="radiogroup" :aria-label="title(c)">
              <label
                class="cursor-pointer rounded-[6px] border px-2 py-1.5 text-[12.5px] leading-[17px]"
                :class="choices[c.id] === 'local' ? 'border-accent bg-accent-soft' : 'border-line'">
                <input v-model="choices[c.id]" type="radio" value="local" class="sr-only">
                <span class="block font-medium text-ink">El meu</span>
                <span class="text-ink-soft">{{ describe(c, c.local) }}</span>
              </label>
              <label
                class="cursor-pointer rounded-[6px] border px-2 py-1.5 text-[12.5px] leading-[17px]"
                :class="choices[c.id] === 'remote' ? 'border-accent bg-accent-soft' : 'border-line'">
                <input v-model="choices[c.id]" type="radio" value="remote" class="sr-only">
                <span class="block font-medium text-ink">L’altra sessió</span>
                <span class="text-ink-soft">{{ describe(c, c.remote) }}</span>
              </label>
            </div>
          </li>
        </ul>

        <p v-if="error" class="px-4 pb-2 text-[13px] leading-[18px] text-danger" role="alert">{{ error }}</p>

        <footer class="flex items-center gap-2 border-t border-line-strong bg-bg-alt px-4 py-2">
          <button type="button" class="btn btn-sm btn-quiet" :disabled="saving" @click="chooseAll('local')">Tots els meus</button>
          <button type="button" class="btn btn-sm btn-quiet" :disabled="saving" @click="chooseAll('remote')">Tots els altres</button>
          <button type="button" class="btn btn-sm btn-primary ml-auto" :disabled="saving" @click="apply()">{{ saving ? 'Desant…' : 'Aplica i desa' }}</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
