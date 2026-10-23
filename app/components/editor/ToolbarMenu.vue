<script setup lang="ts">
// A toolbar button that opens a dropdown. The content comes from the default slot, which receives
// `close`; items are `.menu-item` buttons (role="menuitem"), reachable with the arrow keys. Closes
// on Escape (focus back on the button), on a click outside and when an item calls `close`.

const props = withDefaults(defineProps<{
  label: string
  /** Side of the button the panel lines up with. */
  align?: 'left' | 'right'
  /** Panel width in px. */
  width?: number
  title?: string
}>(), { align: 'left', width: 260, title: undefined })

const emit = defineEmits<{ open: [] }>()

const open = ref(false)
const root = ref<HTMLElement | null>(null)
const trigger = ref<HTMLButtonElement | null>(null)
const panel = ref<HTMLElement | null>(null)
const panelId = `menu-${Math.random().toString(36).slice(2, 9)}`

function items(): HTMLElement[] {
  return [...(panel.value?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([disabled])') ?? [])]
}

async function show(focusFirst = false) {
  open.value = true
  emit('open')
  await nextTick()
  if (focusFirst) items()[0]?.focus()
}

function close(returnFocus = false) {
  open.value = false
  if (returnFocus) trigger.value?.focus()
}

function toggle() {
  if (open.value) close()
  else void show()
}

function onTriggerKey(e: KeyboardEvent) {
  if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
    e.preventDefault()
    void show(true)
  }
}

function onPanelKey(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    e.stopPropagation()
    close(true)
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  // Fields inside the menu (board size) keep their own arrow keys.
  if ((e.target as HTMLElement).closest('input, select, textarea')) return
  const list = items()
  if (!list.length) return
  e.preventDefault()
  const at = list.indexOf(document.activeElement as HTMLElement)
  const next = e.key === 'ArrowDown' ? (at + 1) % list.length : (at <= 0 ? list.length - 1 : at - 1)
  list[next]!.focus()
}

function onDocPointer(e: PointerEvent) {
  if (open.value && root.value && !root.value.contains(e.target as Node)) close()
}

onMounted(() => document.addEventListener('pointerdown', onDocPointer))
onBeforeUnmount(() => document.removeEventListener('pointerdown', onDocPointer))

defineExpose({ close })
</script>

<template>
  <div ref="root" class="relative">
    <button
      ref="trigger"
      type="button"
      class="btn btn-sm btn-quiet inline-flex items-center gap-1.5 !text-ink"
      :class="{ '!bg-bg-alt': open }"
      aria-haspopup="menu"
      :aria-expanded="open"
      :aria-controls="panelId"
      :title="props.title"
      @click="toggle()"
      @keydown="onTriggerKey">
      <slot name="trigger">{{ props.label }}</slot>
      <svg class="h-3 w-3 text-ink-muted transition-transform" :class="{ 'rotate-180': open }" viewBox="0 0 12 12" aria-hidden="true">
        <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
    </button>
    <div
      v-if="open"
      :id="panelId"
      ref="panel"
      role="menu"
      :aria-label="props.label"
      class="panel absolute top-full z-40 mt-1 max-h-[75vh] overflow-y-auto py-1 shadow-overlay"
      :class="props.align === 'right' ? 'right-0' : 'left-0'"
      :style="{ width: `${props.width}px` }"
      @keydown="onPanelKey">
      <slot :close="() => close()" />
    </div>
  </div>
</template>
