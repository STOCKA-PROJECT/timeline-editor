import { defineStore } from 'pinia'
import type { User } from '~/types/api'

interface SessionResponse {
  user: User
  expiresIn: number
}

/**
 * Minimal session store for the editor. There is no login form here: a session is established by
 * exchanging a handoff ticket (see pages/open.vue). `stocka_user` mirrors the main app's reactive
 * user cookie (not httpOnly) for fast auth checks.
 */
export const useAuthStore = defineStore('auth', () => {
  const userCookie = useCookie<User | null>('stocka_user', {
    sameSite: 'lax',
    secure: !import.meta.dev
  })

  const isAuthenticated = computed(() => !!userCookie.value)

  function setSession(payload: SessionResponse) {
    userCookie.value = payload.user
  }

  function clearLocalSession() {
    userCookie.value = null
  }

  /** Exchanges a handoff ticket for a session via the BFF; on a phone the session lasts 30 days. */
  async function exchangeTicket(ticket: string): Promise<void> {
    const api = useApi()
    const data = await api<SessionResponse>('/auth/exchange', {
      method: 'POST',
      body: { ticket, rememberMe: isMobileDevice() }
    })
    setSession(data)
  }

  async function logout() {
    const api = useApi()
    try {
      await api('/auth/logout', { method: 'POST' })
    } catch {
      // fire-and-forget
    }
    clearLocalSession()
  }

  return { user: userCookie, isAuthenticated, setSession, clearLocalSession, exchangeTicket, logout }
})
