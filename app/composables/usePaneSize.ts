interface PaneOptions {
  min: number
  max: number
  axis: 'x' | 'y'
  /** +1 when dragging towards positive axis grows the pane, -1 when it shrinks it. */
  dir: 1 | -1
}

/**
 * Reactive, draggable pane size with min/max clamping and localStorage persistence.
 * Returns the size (px) and a `startDrag` pointer handler to wire onto a splitter element.
 */
export function usePaneSize(name: string, initial: number, opts: PaneOptions) {
  const key = `tle:pane:${name}`
  const size = ref(initial)

  const clamp = (v: number) => Math.min(opts.max, Math.max(opts.min, v))

  onMounted(() => {
    const saved = localStorage.getItem(key)
    if (saved != null) {
      const n = Number(saved)
      if (Number.isFinite(n)) size.value = clamp(n)
    }
  })

  function startDrag(e: PointerEvent) {
    e.preventDefault()
    const startPos = opts.axis === 'x' ? e.clientX : e.clientY
    const startSize = size.value

    function onMove(ev: PointerEvent) {
      const cur = opts.axis === 'x' ? ev.clientX : ev.clientY
      size.value = clamp(startSize + (cur - startPos) * opts.dir)
    }
    function onUp() {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.userSelect = ''
      document.body.style.cursor = ''
      localStorage.setItem(key, String(Math.round(size.value)))
    }
    document.body.style.userSelect = 'none'
    document.body.style.cursor = opts.axis === 'x' ? 'col-resize' : 'row-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }

  return { size, startDrag }
}
