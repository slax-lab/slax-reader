import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

let browser: any
let stored: Record<string, unknown>
let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.resetModules()
  stored = {}
  browser = {
    cookies: { get: vi.fn().mockResolvedValue(null) },
    storage: {
      local: {
        get: vi.fn(async () => stored),
        set: vi.fn(async (value: object) => {
          Object.assign(stored, value)
        })
      }
    },
    runtime: { getManifest: () => ({ version: '2.0.11' }), sendMessage: vi.fn().mockResolvedValue({ success: true, token: null, deviceId: 'background-device' }) },
    i18n: { getUILanguage: () => 'zh-CN' }
  }
  fetchMock = vi.fn().mockResolvedValue(new Response('{}'))
  vi.stubGlobal('browser', browser)
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('PUBLIC_BASE_URL', 'https://reader.test')
  vi.stubEnv('EXTENSIONS_API_BASE_URL', 'https://api.test')
  vi.stubEnv('COOKIE_TOKEN_NAME', 'token')
  vi.stubEnv('VERSION', '2.0.11')
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('extension first-party identity', () => {
  test('empty cookie results still generate exactly one persistent fallback for concurrent callers', async () => {
    const { getExtensionDeviceId } = await import('../src/utils/session')
    const ids = await Promise.all(Array.from({ length: 5 }, () => getExtensionDeviceId()))
    expect(new Set(ids).size).toBe(1)
    expect(ids[0]).toMatch(/^[a-f0-9-]{36}$/)
    expect(browser.storage.local.set).toHaveBeenCalledTimes(1)
    expect(stored.deviceId).toBe(ids[0])
  })

  test('reads only the configured web origin and follows a newly available web cookie', async () => {
    const { getExtensionDeviceId } = await import('../src/utils/session')
    await getExtensionDeviceId()
    browser.cookies.get.mockResolvedValue({ value: 'web-device.123' })
    expect(await getExtensionDeviceId()).toBe('web-device.123')
    expect(browser.cookies.get).toHaveBeenLastCalledWith({ url: 'https://reader.test', name: '_su' })
  })

  test('cookie permission failure uses local identity; content scripts use the background identity', async () => {
    const { getExtensionDeviceId } = await import('../src/utils/session')
    browser.cookies.get.mockRejectedValue(new Error('not permitted'))
    expect(await getExtensionDeviceId()).toBeTruthy()
    browser.cookies = undefined
    expect(await getExtensionDeviceId()).toBe('background-device')
  })

  test('posts registered events to the configured API with live token, device and normalized context', async () => {
    browser.cookies.get.mockImplementation(async ({ name }: { name: string }) => ({ value: name === '_su' ? 'web-device' : 'test-token' }))
    const { eventLog } = await import('../src/utils/analytics')
    await eventLog({ event_name: 'screen_viewed', properties: { screen_name: 'extension_save' } })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://api.test/events')
    expect(init.headers).toMatchObject({ Authorization: 'Bearer test-token', 'X-Device-ID': 'web-device', 'X-CLIENT-VERSION': '2.0.11', 'X-CLIENT-LOCALE': 'zh' })
    expect(JSON.parse(init.body).events[0].properties).toMatchObject({ platform: 'extension', screen_name: 'extension_save', client_version: '2.0.11', locale: 'zh' })
  })
})
