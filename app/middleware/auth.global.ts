/**
 * Guards every route except the handoff entry point. The editor has no login form: if there is no
 * session, send the user to /open (which explains how to reopen from Stocka).
 */
export default defineNuxtRouteMiddleware((to) => {
  if (to.path === '/open' || to.path.startsWith('/open')) return
  const auth = useAuthStore()
  if (!auth.isAuthenticated) {
    return navigateTo('/open')
  }
})
