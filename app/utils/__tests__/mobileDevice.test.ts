import { describe, expect, it } from 'vitest'
import { isMobileDevice } from '~/utils/mobileDevice'

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Mobile Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1'
const MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36'

describe('isMobileDevice', () => {
  it('is false without a navigator (server side)', () => {
    expect(isMobileDevice(undefined)).toBe(false)
  })

  it('trusts userAgentData.mobile when the browser gives it', () => {
    expect(isMobileDevice({ userAgent: WINDOWS, userAgentData: { mobile: true } })).toBe(true)
  })

  it('falls back to the user agent when userAgentData says false or is missing', () => {
    expect(isMobileDevice({ userAgent: ANDROID, userAgentData: { mobile: false } })).toBe(true)
    expect(isMobileDevice({ userAgent: IPHONE })).toBe(true)
  })

  it('takes a touch "Mac" for an iPad', () => {
    expect(isMobileDevice({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 5 })).toBe(true)
  })

  it('is false on desktops, including a Mac without touch', () => {
    expect(isMobileDevice({ userAgent: MAC, platform: 'MacIntel', maxTouchPoints: 0 })).toBe(false)
    expect(isMobileDevice({ userAgent: WINDOWS, platform: 'Win32', userAgentData: { mobile: false } })).toBe(false)
    expect(isMobileDevice({})).toBe(false)
  })
})
