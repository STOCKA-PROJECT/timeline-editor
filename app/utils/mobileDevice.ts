/** The bits of `navigator` that tell a phone or a tablet apart. */
export interface NavigatorLike {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
  userAgentData?: { mobile?: boolean }
}

const MOBILE_UA = /Android|iPhone|iPad|iPod|Mobile|IEMobile|Opera Mini/i

/**
 * Whether this browser runs on a phone or a tablet. Their browsers drop session cookies whenever they
 * are closed, so there the session is always kept (30 days) instead of asking every time. iPadOS
 * reports itself as a Mac: a "Mac" with a touch screen is an iPad. False on the server.
 */
export function isMobileDevice(nav: NavigatorLike | undefined = typeof navigator === 'undefined' ? undefined : navigator): boolean {
  if (!nav) return false
  if (nav.userAgentData?.mobile === true) return true
  if (MOBILE_UA.test(nav.userAgent ?? '')) return true
  return nav.platform === 'MacIntel' && (nav.maxTouchPoints ?? 0) > 1
}
