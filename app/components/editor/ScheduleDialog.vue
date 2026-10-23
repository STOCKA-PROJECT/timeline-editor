<script setup lang="ts">
import type { ButtonSchedule, ScheduleDay, ScheduleWindow } from '~/types/show'
import {
  MAX_SCHEDULE_WINDOWS,
  SCHEDULE_DAYS,
  SCHEDULE_DAY_LABELS,
  crossesMidnight,
  scheduleProblems,
  sortDays
} from '~/utils/schedule'

// Button schedule of the show (`mode.schedule`): always, only inside some windows, or never inside
// them. Edits a draft; «Desa» writes it to the scene (and so to the next export).

const emit = defineEmits<{ close: [] }>()
const scene = useSceneStore()

type Mode = 'always' | ButtonSchedule['rule']
interface DraftWindow extends ScheduleWindow { key: number, wholeDay: boolean }

let nextKey = 0
function draftOf(w: ScheduleWindow): DraftWindow {
  return { key: nextKey++, days: [...w.days], from: w.from, to: w.to, wholeDay: w.from === '00:00' && w.to === '24:00' }
}
function newWindow(): DraftWindow {
  return draftOf({ days: ['fri', 'sat', 'sun'], from: '17:00', to: '21:00' })
}

const mode = ref<Mode>(scene.schedule?.rule ?? 'always')
const windows = ref<DraftWindow[]>(scene.schedule?.windows.map(draftOf) ?? [newWindow()])

/** The time inputs cannot type 24:00: an end of 00:00 means midnight. */
function contractWindow(w: DraftWindow): ScheduleWindow {
  if (w.wholeDay) return { days: sortDays(w.days), from: '00:00', to: '24:00' }
  return { days: sortDays(w.days), from: w.from, to: w.to === '00:00' ? '24:00' : w.to }
}

const draft = computed<ButtonSchedule | null>(() =>
  mode.value === 'always' ? null : { rule: mode.value, windows: windows.value.map(contractWindow) })
const problems = computed(() => (draft.value ? scheduleProblems(draft.value) : []))

function toggleDay(w: DraftWindow, day: ScheduleDay) {
  w.days = w.days.includes(day) ? w.days.filter(d => d !== day) : sortDays([...w.days, day])
}
function addWindow() {
  if (windows.value.length < MAX_SCHEDULE_WINDOWS) windows.value.push(newWindow())
}
function removeWindow(key: number) {
  windows.value = windows.value.filter(w => w.key !== key)
}

function save() {
  if (problems.value.length) return
  scene.setSchedule(draft.value)
  emit('close')
}

function onKey(e: KeyboardEvent) {
  if (e.key === 'Escape') emit('close')
}
onMounted(() => window.addEventListener('keydown', onKey))
onBeforeUnmount(() => window.removeEventListener('keydown', onKey))

const MODES: { value: Mode, title: string, help: string }[] = [
  { value: 'always', title: 'Sempre', help: 'El polsador engega el show a qualsevol hora.' },
  { value: 'allow', title: 'Només en aquestes franges', help: 'Fora de les franges, prémer el polsador no fa res.' },
  { value: 'block', title: 'Excepte en aquestes franges', help: 'Dins de les franges, prémer el polsador no fa res.' }
]
</script>

<template>
  <Teleport to="body">
    <div class="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" @click="emit('close')">
      <section
        class="panel flex max-h-[85vh] w-[600px] max-w-full flex-col shadow-overlay"
        role="dialog"
        aria-modal="true"
        aria-labelledby="schedule-title"
        @click.stop>
        <header class="border-b border-line-strong px-4 py-3">
          <h2 id="schedule-title" class="font-display text-[15px] font-semibold leading-5 text-ink">Horari del polsador</h2>
          <p class="mt-1 text-[13px] leading-[18px] text-ink-soft">
            Quan pot engegar el show una pulsació curta del polsador. Aturar, el pànic i les pulsacions llargues funcionen
            sempre. Les hores són les de la Raspberry: si no sap l’hora (després d’un tall de llum, fins que s’hi connecti
            un mòbil o aquest editor), el polsador funciona sempre.
          </p>
        </header>

        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
          <div class="grid grid-cols-3 gap-2" role="radiogroup" aria-label="Quan funciona el polsador">
            <label
              v-for="m in MODES" :key="m.value"
              class="cursor-pointer rounded-[6px] border px-2 py-1.5 text-[12.5px] leading-[17px]"
              :class="mode === m.value ? 'border-accent bg-accent-soft' : 'border-line'">
              <input v-model="mode" type="radio" :value="m.value" class="sr-only">
              <span class="block font-medium text-ink">{{ m.title }}</span>
              <span class="text-ink-soft">{{ m.help }}</span>
            </label>
          </div>

          <template v-if="mode !== 'always'">
            <ul class="space-y-2" aria-label="Franges">
              <li v-for="(w, i) in windows" :key="w.key" class="rounded-[6px] border border-line px-3 py-2">
                <div class="flex items-center gap-2">
                  <span class="text-[11px] font-semibold uppercase tracking-[.08em] text-ink-muted">Franja {{ i + 1 }}</span>
                  <button
                    type="button" class="btn btn-sm btn-quiet ml-auto"
                    :disabled="windows.length === 1"
                    :title="windows.length === 1 ? 'Cal almenys una franja: tria «Sempre» per treure l’horari' : 'Treu aquesta franja'"
                    @click="removeWindow(w.key)">Treu</button>
                </div>
                <div class="mt-1.5 flex flex-wrap gap-1" role="group" :aria-label="`Dies de la franja ${i + 1}`">
                  <button
                    v-for="d in SCHEDULE_DAYS" :key="d"
                    type="button"
                    class="btn btn-sm !min-w-9 !px-2"
                    :class="w.days.includes(d) ? '!border-accent !bg-accent-soft text-ink' : 'btn-quiet'"
                    :aria-pressed="w.days.includes(d)"
                    @click="toggleDay(w, d)">{{ SCHEDULE_DAY_LABELS[d] }}</button>
                </div>
                <div class="mt-2 flex flex-wrap items-center gap-3 text-[12.5px] text-ink">
                  <label class="flex items-center gap-1.5">
                    <input v-model="w.wholeDay" type="checkbox">
                    Tot el dia
                  </label>
                  <label class="flex items-center gap-1.5">
                    De
                    <input v-model="w.from" type="time" class="field field-sm field-code !w-28" :disabled="w.wholeDay" required>
                  </label>
                  <label class="flex items-center gap-1.5">
                    a
                    <input v-model="w.to" type="time" class="field field-sm field-code !w-28" :disabled="w.wholeDay" required>
                  </label>
                  <span v-if="!w.wholeDay && w.to === '00:00'" class="text-ink-muted">fins a mitjanit</span>
                  <span v-else-if="!w.wholeDay && crossesMidnight(contractWindow(w))" class="text-ink-muted">acaba l’endemà</span>
                </div>
              </li>
            </ul>
            <button
              type="button" class="btn btn-sm"
              :disabled="windows.length >= MAX_SCHEDULE_WINDOWS"
              @click="addWindow()">Afegeix una franja</button>
          </template>

          <ul v-if="problems.length" class="space-y-1 text-[13px] leading-[18px] text-danger" role="alert">
            <li v-for="p in problems" :key="p">{{ p.charAt(0).toUpperCase() + p.slice(1) }}.</li>
          </ul>
        </div>

        <footer class="flex items-center gap-2 border-t border-line-strong bg-bg-alt px-4 py-2">
          <button type="button" class="btn btn-sm btn-quiet ml-auto" @click="emit('close')">Cancel·la</button>
          <button type="button" class="btn btn-sm btn-primary" :disabled="problems.length > 0" @click="save()">Desa</button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
