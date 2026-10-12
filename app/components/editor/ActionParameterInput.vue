<script setup lang="ts">
import type { ActionParameterDto } from '~/types/api'
import type { CatalogType } from '~/types/catalog'
import { parseRgb } from '~/utils/showCoerce'

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
      <input
        type="color"
        class="h-8 w-10 flex-shrink-0 cursor-pointer rounded-[6px] border border-line bg-bg-card p-0.5 disabled:cursor-not-allowed disabled:opacity-40"
        :value="asHex ?? '#000000'"
        :disabled="colorUnset"
        @input="set(($event.target as HTMLInputElement).value)">
      <span class="font-mono text-[12px] text-ink-soft">{{ colorUnset ? '—' : asHex }}</span>
      <label v-if="!param.required" class="ml-auto flex cursor-pointer items-center gap-1.5 text-[11.5px] text-ink-muted">
        <input type="checkbox" :checked="colorUnset" @change="setColorUnset(($event.target as HTMLInputElement).checked)">
        Sense valor
      </label>
    </div>

    <textarea
      v-else-if="param.type === 'LONGTEXT'"
      class="field !h-auto py-1.5" rows="3" :value="asString"
      @input="set(($event.target as HTMLTextAreaElement).value)" />

    <input
      v-else-if="param.type === 'INTEGER'"
      class="field" type="number" step="1" :value="asString"
      @input="set(Number(($event.target as HTMLInputElement).value))">

    <input
      v-else-if="param.type === 'DECIMAL' || param.type === 'PRICE'"
      class="field" type="number" step="any" :value="asString"
      @input="set(Number(($event.target as HTMLInputElement).value))">

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
