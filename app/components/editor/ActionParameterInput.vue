<script setup lang="ts">
import type { ActionParameterDto } from '~/types/api'

const props = defineProps<{ param: ActionParameterDto, modelValue: unknown }>()
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()

function set(value: unknown) {
  emit('update:modelValue', value)
}

const options = computed(() => props.param.validators?.options ?? [])
const asString = computed(() => (props.modelValue == null ? '' : String(props.modelValue)))
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

    <textarea
      v-if="param.type === 'LONGTEXT'"
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
  </div>
</template>
