<script setup lang="ts">
import { listRecords, type SceneRecord } from '~/utils/offline/sceneSync'

// The editor is entered via /open (handoff) or a deep link to a timeline. The bare root points
// users back to Stocka and, in the installed editor, lists the timelines kept on this laptop so they
// can be opened (and edited) without a connection.
const config = useRuntimeConfig()
const stockaUrl = config.public.stockaUrl as string

const records = ref<SceneRecord[]>([])
const loaded = ref(false)
const online = ref(true)

function when(ms: number | null): string {
  if (!ms) return 'mai'
  return new Date(ms).toLocaleString('ca', { dateStyle: 'medium', timeStyle: 'short' })
}

onMounted(async () => {
  online.value = navigator.onLine
  records.value = await listRecords(await useOfflineDb())
  loaded.value = true
})
</script>

<template>
  <div class="panel w-full max-w-lg p-6">
    <h1 class="text-center text-[18px] font-semibold text-ink">Stocka · Timeline Editor</h1>
    <p class="mt-2 text-center text-[13.5px] text-ink-soft">
      Abre el editor desde el botón <strong>Modificar</strong> de una timeline en Stocka.
    </p>
    <div class="mt-4 flex justify-center">
      <a :href="stockaUrl" class="btn btn-primary inline-flex">Ir a Stocka</a>
    </div>

    <section v-if="loaded && records.length" class="mt-6" aria-labelledby="offline-list">
      <h2 id="offline-list" class="label">Timelines en aquest portàtil</h2>
      <p v-if="!online" class="mt-1 text-[12.5px] leading-[17px] text-warn">Sense connexió: pots editar-les i es pujaran quan tornis a tenir Internet.</p>
      <ul class="mt-2 space-y-1.5">
        <li v-for="r in records" :key="r.key">
          <NuxtLink
            :to="`/${r.orgSlug}/timelines/${r.timelineId}`"
            class="flex items-center gap-2 rounded-[6px] border border-line px-3 py-2 text-[13px] leading-[18px] hover:border-accent">
            <span class="min-w-0 flex-1 truncate font-medium text-ink">{{ r.timelineName || `Timeline ${r.timelineId}` }}</span>
            <span v-if="r.pending" class="badge badge-warn">Canvis per pujar</span>
            <span class="whitespace-nowrap text-[12px] text-ink-muted">{{ r.pending ? `editada ${when(r.updatedAt)}` : `sincronitzada ${when(r.syncedAt)}` }}</span>
          </NuxtLink>
        </li>
      </ul>
    </section>
  </div>
</template>
