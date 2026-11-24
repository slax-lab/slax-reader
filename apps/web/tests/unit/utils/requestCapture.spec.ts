// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ capture: vi.fn() }))

mockNuxtImport('useRuntimeConfig', () => () => ({ app: { baseURL: '/' }, public: { DWEB_API_BASE_URL: 'https://api.test', COOKIE_TOKEN_NAME: 'token' } }))
mockNuxtImport('navigateTo', () => vi.fn())
vi.mock('~/utils/clientErrorLog', () => ({ useClientErrorLog: () => ({ enabled: true, capture: state.capture, flush: async () => {} }) }))
vi.mock('~/components/Toast', () => ({ default: { showToast: vi.fn() }, ToastType: { Error: 'error' } }))

const originalFetch = globalThis.fetch
beforeEach(() => {
  state.capture.mockReset()
})
afterEach(() => {
  globalThis.fetch = originalFetch
})

describe('API failure capture', () => {
  it('names a non-JSON 5xx by its request instead of the body parse error', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response('<html>500</html>', { status: 500, headers: { 'cf-ray': '9a1b-SIN' } }))
    const { request } = await import('~~/app/utils/request')
    await request()
      .get({ url: '/v1/user/labs?secret=1' })
      .catch(() => undefined)
    expect(state.capture).toHaveBeenCalledTimes(1)
    const [kind, error, properties] = state.capture.mock.calls[0]!
    expect(kind).toBe('network')
    expect({ name: error.name, message: error.message }).toEqual({ name: 'ApiRequestError', message: 'GET /v1/user/labs failed (500)' })
    expect(properties).toMatchObject({ source: 'api', method: 'get', path: '/v1/user/labs', status: 500, ray: '9a1b-SIN', phase: 'request' })
    expect(JSON.stringify(properties)).not.toContain('secret')
  })

  it('keeps the browser error for a network failure', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const { request } = await import('~~/app/utils/request')
    await request()
      .get({ url: '/v1/user/labs' })
      .catch(() => undefined)
    const [, error, properties] = state.capture.mock.calls.at(-1)!
    expect({ name: error.name, message: error.message }).toEqual({ name: 'TypeError', message: 'Failed to fetch' })
    expect(properties.status).toBeUndefined()
  })

  it('does not capture a 4xx response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ code: 40001, message: 'bad', data: 'ERROR_PARAM' }), { status: 400 }))
    const { request } = await import('~~/app/utils/request')
    await request()
      .get({ url: '/v1/user/labs' })
      .catch(() => undefined)
    expect(state.capture).not.toHaveBeenCalled()
  })
})
