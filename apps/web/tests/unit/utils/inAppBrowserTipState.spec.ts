import {
  IN_APP_BROWSER_TIP_COOLDOWN_MS,
  IN_APP_BROWSER_TIP_STATE_KEY,
  isInAppBrowserTipCoolingDown,
  readInAppBrowserTipState,
  recordInAppBrowserTipManualClose
} from '~~/app/utils/inAppBrowserTipState'

import { beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  localStorage.clear()
  vi.restoreAllMocks()
})

describe('in-app browser tip state', () => {
  it('starts empty when storage has no state', () => {
    expect(readInAppBrowserTipState(100)).toEqual({ manualCloseCount: 0, cooldownUntil: 0 })
  })

  it.each([
    'not-json',
    JSON.stringify({ manualCloseCount: -1, cooldownUntil: 0 }),
    JSON.stringify({ manualCloseCount: 1.5, cooldownUntil: 0 }),
    JSON.stringify({ manualCloseCount: 3, cooldownUntil: 0 }),
    JSON.stringify({ manualCloseCount: 1, cooldownUntil: 100 })
  ])('resets malformed state: %s', raw => {
    localStorage.setItem(IN_APP_BROWSER_TIP_STATE_KEY, raw)
    expect(readInAppBrowserTipState(100)).toEqual({ manualCloseCount: 0, cooldownUntil: 0 })
  })

  it('records one close, then starts a one-hour cooldown on the second', () => {
    expect(recordInAppBrowserTipManualClose(100)).toEqual({ manualCloseCount: 1, cooldownUntil: 0 })
    expect(recordInAppBrowserTipManualClose(200)).toEqual({ manualCloseCount: 2, cooldownUntil: 200 + IN_APP_BROWSER_TIP_COOLDOWN_MS })
  })

  it('treats the exact expiry instant as available and resets the state', () => {
    const cooldownUntil = 100 + IN_APP_BROWSER_TIP_COOLDOWN_MS
    localStorage.setItem(IN_APP_BROWSER_TIP_STATE_KEY, JSON.stringify({ manualCloseCount: 2, cooldownUntil }))
    expect(isInAppBrowserTipCoolingDown(cooldownUntil)).toBe(false)
    expect(readInAppBrowserTipState(cooldownUntil)).toEqual({ manualCloseCount: 0, cooldownUntil: 0 })
  })

  it('keeps the current state in memory when storage writes fail', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Unavailable', 'SecurityError') })
    expect(recordInAppBrowserTipManualClose(100)).toEqual({ manualCloseCount: 1, cooldownUntil: 0 })
    expect(recordInAppBrowserTipManualClose(200)).toEqual({ manualCloseCount: 2, cooldownUntil: 200 + IN_APP_BROWSER_TIP_COOLDOWN_MS })
  })

  it('keeps rendering state when storage reads fail', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Unavailable', 'SecurityError') })
    expect(readInAppBrowserTipState(100)).toEqual({ manualCloseCount: 0, cooldownUntil: 0 })
    expect(recordInAppBrowserTipManualClose(200)).toEqual({ manualCloseCount: 1, cooldownUntil: 0 })
  })
})
