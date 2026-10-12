<script setup lang="ts">
import type { ActionParameterDto } from '~/types/api'
import type { CatalogType } from '~/types/catalog'
import { parseRgb, parseRgbList, type Rgb } from '~/utils/showCoerce'

const props = defineProps<{
  param: ActionParameterDto
  modelValue: unknown
  /**
   * Type of the parameter in the output catalog, when the action comes from it. An `rgb`
   * parameter is edited with a colour picker (stored as `#rrggbb`, which the export understands).
   */
  catalogType?: CatalogType | null
}>()
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

function set(value: unknown) {
  emit('update:modelValue', value)
}

/** Numeric inputs: an emptied field unsets the parameter instead of turning it into 0. */
function setNumber(raw: string) {
  set(raw.trim() === '' ? null : Number(raw))
}

const options = computed(() => props.param.validators?.options ?? [])
const asString = computed(() => (props.modelValue == null ? '' : String(props.modelValue)))

// ---- colour (catalog rgb) ----
const isColor = computed(() => props.catalogType === 'rgb')
const colorUnset = computed(() => props.modelValue == null || props.modelValue === '')
/** Stored value as `#rrggbb`, whatever format it was typed in; null when it is not a colour. */
const asHex = computed(() => {
  const rgb = parseRgb(props.modelValue)
  return rgb ? '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('') : null
})
// A value that is neither empty nor a parseable colour keeps the text field so nothing is lost.
const colorPickable = computed(() => isColor.value && (colorUnset.value || asHex.value !== null))

/** Optional colours can be left unset (e.g. a fade without from_color continues from the previous colour). */
function setColorUnset(unset: boolean) {
  set(unset ? null : (asHex.value ?? '#ffffff'))
}

// ---- colour list (catalog rgb_list, e.g. fade waypoints) ----
const toHex = (rgb: Rgb) => '#' + rgb.map(c => c.toString(16).padStart(2, '0')).join('')
const isColorList = computed(() => props.catalogType === 'rgb_list')
const parsedColorList = computed(() => parseRgbList(props.modelValue))
/** Stored colours as `#rrggbb`; empty when unset or not a list of colours. */
const colorList = computed<string[]>(() => (parsedColorList.value ?? []).map(toHex))
const colorListInvalid = computed(() => isColorList.value && props.modelValue != null && props.modelValue !== '' && parsedColorList.value === null)

/** Stores the list as `#rrggbb` strings; an empty list is stored as unset. */
function setColorList(list: string[]) {
  set(list.length ? list : null)
}
function addColor() {
  setColorList([...colorList.value, colorList.value[colorList.value.length - 1] ?? '#ffffff'])
}
function updateColor(index: number, hex: string) {
  setColorList(colorList.value.map((c, i) => (i === index ? hex : c)))
}
function removeColor(index: number) {
  setColorList(colorList.value.filter((_, i) => i !== index))
}
function moveColor(index: number, dir: -1 | 1) {
  const next = [...colorList.value]
  const target = index + dir
  if (target < 0 || target >= next.length) return
  ;[next[index], next[target]] = [next[target]!, next[index]!]
  setColorList(next)
}
const asBool = computed(() => props.modelValue === true)
const asArray = computed(() => (Array.isArray(props.modelValue) ? props.modelValue as string[] : []))

function toggleMulti(opt: string, checked: boolean) {
  const set_ = new Set(asArray.value)
  if (checked) set_.add(opt)
  else set_.delete(opt)
  set([...set_])
}
</script>

<template>
  <div class="flex flex-col gap-1">
    <label class="text-[12px] font-medium text-ink-soft">
      {{ param.displayName }}<span v-if="param.required" class="text-danger"> *</span>
    </label>

    <div v-if="colorPickable" class="flex items-center gap-2">
      <!-- Always enabled: picking a colour is how an unset parameter gets its first value. -->
      <input
        type="color"
        class="h-8 w-10 flex-shrink-0 cursor-pointer rounded-[6px] border border-line bg-bg-card p-0.5"
        :class="colorUnset ? 'opacity-40' : ''"
        :value="asHex ?? '#ffffff'"
        title="Tria un color"
        @input="set(($event.target as HTMLInputElement).value)">
      <span class="font-mono text-[12px] text-ink-soft">{{ colorUnset ? '—' : asHex }}</span>
      <label v-if="!param.required" class="ml-auto flex cursor-pointer items-center gap-1.5 text-[11.5px] text-ink-muted">
        <input type="checkbox" :checked="colorUnset" @change="setColorUnset(($event.target as HTMLInputElement).checked)">
        Sense valor
      </label>
    </div>

    <div v-else-if="isColorList" class="flex flex-col gap-1.5">
      <div v-for="(hex, i) in colorList" :key="i" class="flex items-center gap-2">
        <span class="w-4 flex-shrink-0 text-right text-[11px] text-ink-muted">{{ i + 1 }}</span>
        <input
          type="color"
          class="h-8 w-10 flex-shrink-0 cursor-pointer rounded-[6px] border border-line bg-bg-card p-0.5"
          :value="hex"
          @input="updateColor(i, ($event.target as HTMLInputElement).value)">
        <span class="font-mono text-[12px] text-ink-soft">{{ hex }}</span>
        <div class="ml-auto flex items-center gap-0.5 text-ink-muted">
          <button type="button" class="px-1 text-[11px] disabled:opacity-30" title="Puja" :disabled="i === 0" @click="moveColor(i, -1)">▲</button>
          <button type="button" class="px-1 text-[11px] disabled:opacity-30" title="Baixa" :disabled="i === colorList.length - 1" @click="moveColor(i, 1)">▼</button>
          <button type="button" class="px-1 text-[11px] text-danger" title="Treu" @click="removeColor(i)">✕</button>
        </div>
      </div>
      <p v-if="!colorList.length" class="text-[11.5px] text-ink-muted">Cap color intermedi: el fos va directe del color inicial al final.</p>
      <p v-if="colorListInvalid" class="text-[11px] text-danger">El valor desat no és una llista de colors; en afegir-ne un es reemplaçarà.</p>
      <button type="button" class="btn !h-7 self-start !px-2 !text-[12px]" @click="addColor">+ Afegeix un color</button>
    </div>

    <textarea
      v-else-if="param.type === 'LONGTEXT'"
      class="field !h-auto py-1.5" rows="3" :value="asString"
      @input="set(($event.target as HTMLTextAreaElement).value)" />

    <input
      v-else-if="param.type === 'INTEGER'"
      class="field" type="number" step="1" :value="asString"
      @input="setNumber(($event.target as HTMLInputElement).value)">

    <input
      v-else-if="param.type === 'DECIMAL' || param.type === 'PRICE'"
      class="field" type="number" step="any" :value="asString"
      @input="setNumber(($event.target as HTMLInputElement).value)">

    <label v-else-if="param.type === 'BOOLEAN'" class="flex items-center gap-2 text-[13px] text-ink">
      <input type="checkbox" :checked="asBool" @change="set(($event.target as HTMLInputElement).checked)">
      {{ asBool ? 'Sí' : 'No' }}
    </label>

    <input
      v-else-if="param.type === 'DATE'"
      class="field" type="date" :value="asString"
      @input="set(($event.target as HTMLInputElement).value)">

    <input
      v-else-if="param.type === 'DATETIME'"
      class="field" type="datetime-local" :value="asString"
      @input="set(($event.target as HTMLInputElement).value)">

    <select
      v-else-if="param.type === 'SELECT'"
      class="field" :value="asString"
      @change="set(($event.target as HTMLSelectElement).value)">
      <option value="">—</option>
      <option v-for="opt in options" :key="opt" :value="opt">{{ opt }}</option>
    </select>

    <div v-else-if="param.type === 'MULTI_SELECT'" class="flex flex-col gap-1">
      <label v-for="opt in options" :key="opt" class="flex items-center gap-2 text-[12.5px] text-ink">
        <input type="checkbox" :checked="asArray.includes(opt)"
          @change="toggleMulti(opt, ($event.target as HTMLInputElement).checked)">
        {{ opt }}
      </label>
    </div>

    <input
      v-else
      class="field" type="text" :value="asString"
      @input="set(($event.target as HTMLInputElement).value)">
    <p v-if="isColor && !colorPickable" class="text-[11px] text-danger">
      No és un color vàlid. Format: #rrggbb o r,g,b.
    </p>
  </div>
</template>
