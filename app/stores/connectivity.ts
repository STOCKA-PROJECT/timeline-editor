import { defineStore } from 'pinia'

/**
 * Whether the editor can reach Stocka right now. `navigator.onLine` alone lies (a Wi-Fi without
 * Internet, such as the Pi's own network, counts as online), so every request reports its outcome:
 * a read served from the local copy or a save that could not go up means "offline".
 */
export const useConnectivityStore = defineStore('connectivity', () => {
  const browserOnline = ref(typeof navigator === 'undefined' ? true : navigator.onLine)
  const serverReachable = ref(true)
  const lastContactAt = ref<number | null>(null)

  const online = computed(() => browserOnline.value && serverReachable.value)

  function reportNetwork() {
    serverReachable.value = true
    lastContactAt.value = Date.now()
  }

  function reportUnreachable() {
    serverReachable.value = false
  }

  function report(outcome: 'network' | 'cache') {
    if (outcome === 'network') reportNetwork()
    else reportUnreachable()
  }

  let listening = false
  /** Follows the browser's online/offline events (once per page). */
  function listen(onBack?: () => void) {
    if (listening || typeof window === 'undefined') return
    listening = true
    window.addEventListener('online', () => {
      browserOnline.value = true
      // Optimistic: the next request confirms it.
      serverReachable.value = true
      onBack?.()
    })
    window.addEventListener('offline', () => {
      browserOnline.value = false
    })
  }

  return { browserOnline, serverReachable, online, lastContactAt, report, reportNetwork, reportUnreachable, listen }
})
