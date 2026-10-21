import { setAudioBytesLoader } from '~/utils/audioCache'

/**
 * Offline plumbing of the installed editor: audio for the waveform and the preview comes from the
 * local copy when there is one, and the service worker (production builds) keeps the app itself
 * available without a connection.
 */
export default defineNuxtPlugin(() => {
  const cached = useCachedApi()
  setAudioBytesLoader(url => cached.bytes(url))

  if (!import.meta.dev && 'serviceWorker' in navigator) {
    const register = () => {
      navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((error) => {
        console.warn('No s’ha pogut registrar el service worker', error)
      })
    }
    if (document.readyState === 'complete') register()
    else window.addEventListener('load', register, { once: true })
  }
})
