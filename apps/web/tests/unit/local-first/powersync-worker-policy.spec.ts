// @vitest-environment happy-dom
import { shouldUsePowerSyncSharedWorker } from '~/local-first/powersync-worker-policy'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => {
  vi.stubGlobal('SharedWorker', class {})
  vi.stubGlobal('window', {})
  vi.stubGlobal('navigator', { userAgent: 'Mozilla/5.0 (X11; Linux x86_64) Firefox/143.0' })
})

afterEach(() => vi.unstubAllGlobals())

describe('PowerSync shared worker eligibility', () => {
  it.each(['iPhone', 'iPod', 'iPad', 'Android', 'android'])('excludes %s even with SharedWorker support', platform => {
    vi.stubGlobal('navigator', { userAgent: `Mozilla/5.0 (${platform}) AppleWebKit/605.1.15 Safari/604.1` })
    expect(shouldUsePowerSyncSharedWorker()).toBe(false)
  })

  it('excludes desktop Safari by its browser marker', () => {
    vi.stubGlobal('window', { safari: {} })
    expect(shouldUsePowerSyncSharedWorker()).toBe(false)
  })

  it.each([
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0',
    'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0'
  ])('keeps shared mode for an eligible desktop user agent: %s', userAgent => {
    vi.stubGlobal('navigator', { userAgent })
    expect(shouldUsePowerSyncSharedWorker()).toBe(true)
  })

  it.each(['SharedWorker', 'window', 'navigator'])('does not require the %s global to exist', name => {
    vi.stubGlobal(name, undefined)
    expect(shouldUsePowerSyncSharedWorker()).toBe(false)
  })
})
