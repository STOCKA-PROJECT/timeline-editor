/** While edits wait on the laptop (no connection), how often the editor tries to upload them. */
const RETRY_OFFLINE_MS = 15000

/**
 * Debounced autosave: watches the scene's dirty revision and persists ~1.2s after the last edit.
 * Edits that could not go up (offline) are retried every {@link RETRY_OFFLINE_MS} and as soon as the
 * browser reports the connection is back.
 * Also flushes immediately when the page is hidden/unloaded (e.g. reload, tab close, navigation), so
 * the last edit is not lost to the debounce window. Returns a manual `saveNow` for explicit saves.
 */
export function useAutosave(delayMs = 1200) {
  const scene = useSceneStore()
  let timer: ReturnType<typeof setTimeout> | null = null

  function flush(opts?: { keepalive?: boolean }) {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (scene.dirty && !scene.conflict) {
      scene.save(opts).catch(() => { /* error surfaced via scene.error */ })
    }
  }

  // Persist any pending edit before the page goes away: the laptop's copy first (it survives a
  // closed window without connection), then the server. `keepalive` lets the request finish even as
  // the document unloads (a plain fetch would be cancelled by the reload/navigation).
  function flushOnExit() {
    void scene.persistLocalNow()
    flush({ keepalive: true })
  }

  let retry: ReturnType<typeof setInterval> | null = null
  function retryPending() {
    if (scene.dirty && !scene.saving && !scene.conflict && !scene.loading) flush()
  }
  function onVisibilityChange() {
    if (document.visibilityState === 'hidden') flushOnExit()
  }

  const stop = watch(
    () => scene.dirtyRevision,
    () => {
      if (scene.conflict) return
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, delayMs)
    }
  )

  onMounted(() => {
    // `pagehide` is the reliable unload signal across browsers (incl. bfcache); visibilitychange
    // covers tab switches and mobile backgrounding.
    window.addEventListener('pagehide', flushOnExit)
    document.addEventListener('visibilitychange', onVisibilityChange)
    window.addEventListener('online', retryPending)
    retry = setInterval(() => {
      if (scene.offline) retryPending()
    }, RETRY_OFFLINE_MS)
  })

  onBeforeUnmount(() => {
    if (timer) clearTimeout(timer)
    window.removeEventListener('pagehide', flushOnExit)
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('online', retryPending)
    if (retry) clearInterval(retry)
    flushOnExit()
    stop()
  })

  return { saveNow: flush }
}
