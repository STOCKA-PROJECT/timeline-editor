/**
 * Guards every route except the handoff entry point. The editor has no login form: if there is no
 * session, send the user to /open (which explains how to reopen from Stocka). Without a connection
 * the installed editor still opens the home page and the timelines kept on the laptop: the session
 * cookie may be gone, but nothing can reach Stocka anyway and the edits wait locally.
 */
export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/open' || to.path.startsWith('/open')) return
  const auth = useAuthStore()
  if (auth.isAuthenticated) return
  const offline = import.meta.client && typeof navigator !== 'undefined' && !navigator.onLine
  if (offline && (to.path === '/' || /^\/[^/]+\/timelines\/\d+\/?$/.test(to.path))) return
  return navigateTo('/open')
})
