// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ endpoint: 'https://stream.ingest.invalid', sent: [] as unknown[][], fetch: vi.fn() }))

mockNuxtImport('useRuntimeConfig', () => () => ({ public: { CLIENT_ERROR_INGEST_URL: state.endpoint, appVersion: '2.1.0', slaxEnv: 'production', COOKIE_TOKEN_NAME: 'token' } }))
// The shared cookie helpers register change listeners; the collector must not call them.
vi.mock('~/utils/request', () => ({
  getUserToken: () => {
    throw new Error('getUserToken must not be used by the collector')
  },
  getDeviceId: () => {
    throw new Error('getDeviceId must not be used by the collector')
  }
}))

let hooks: Record<string, (...args: unknown[]) => void> = {}
const start = async () => {
  vi.resetModules()
  hooks = {}
  const plugin = (await import('~~/app/plugins/client-error-log.client')).default
  await plugin({ hook: (name: string, fn: (...args: unknown[]) => void) => void (hooks[name] = fn) } as never)
  return (await import('~/utils/clientErrorLog')).useClientErrorLog()
}

const setCookie = (name: string, value: string) => (document.cookie = `${name}=${encodeURIComponent(value)}; path=/`)

beforeEach(() => {
  setCookie('token', `h.${btoa(JSON.stringify({ id: 10001 }))}.s`)
  setCookie('_su', 'device-1')
  state.endpoint = 'https://stream.ingest.invalid'
  state.sent = []
  state.fetch.mockReset().mockImplementation(async (_url: string, init: { body: string }) => {
    state.sent.push(JSON.parse(init.body))
    return new Response('{}')
  })
  vi.stubGlobal('fetch', state.fetch)
  window.history.replaceState(null, '', '/b/abc?token=secret')
})
afterEach(() => vi.unstubAllGlobals())

describe('client error log plugin', () => {
  it('captures failed scripts, ignores failed images, and records Vue errors with identity', async () => {
    const collector = await start()
    // Dispatch on detached elements: the capture-phase listener sees them through the window, without a real load.
    const script = document.createElement('script')
    script.src = 'https://r.slax.com/_nuxt/chunk.js?v=1'
    window.dispatchEvent(Object.defineProperty(new Event('error'), 'target', { value: script }))
    const img = document.createElement('img')
    img.src = 'https://r.slax.com/a.png'
    window.dispatchEvent(Object.defineProperty(new Event('error'), 'target', { value: img }))
    hooks['vue:error'](new TypeError('render failed'), { $options: { __name: 'ReaderView' } }, 'render function')
    await collector.flush()
    const records = state.sent.flat() as Array<Record<string, unknown>>
    expect(records.map(record => record.kind)).toEqual(['resource', 'vue'])
    expect(records[0]).toMatchObject({ message: 'Script failed to load: https://r.slax.com/_nuxt/chunk.js', page_url: 'http://localhost:3000/b/abc' })
    expect(records[1]).toMatchObject({ error_name: 'TypeError', user_id: '10001', device_id: 'device-1', env: 'production', release: '2.1.0' })
    expect(records[1].properties).toMatchObject({ info: 'render function', component: 'ReaderView', sources: ['vue'] })
  })

  it('ignores intentional 4xx Nuxt errors and keeps 5xx ones', async () => {
    const collector = await start()
    hooks['app:error'](Object.assign(new Error('Page not found'), { statusCode: 404 }))
    hooks['vue:error'](Object.assign(new Error('Forbidden'), { statusCode: 403 }), null, 'setup function')
    hooks['app:error'](Object.assign(new Error('collection service unavailable'), { statusCode: 502 }))
    await collector.flush()
    const records = state.sent.flat() as Array<Record<string, unknown>>
    expect(records.map(record => record.message)).toEqual(['collection service unavailable'])
    expect(records[0].properties).toMatchObject({ status_code: 502, sources: ['app'] })
  })

  it('records a fatal component error once although Nuxt reports it through both hooks', async () => {
    const collector = await start()
    const original = new Error('fatal render failure')
    hooks['vue:error'](original, null, 'render function')
    hooks['app:error'](Object.assign(new Error('fatal render failure'), { statusCode: 500, cause: original }))
    hooks['app:error'](original)
    expect(() => hooks['app:error'](null)).not.toThrow()
    // A thrown primitive reaches app:error wrapped with the primitive as its cause.
    hooks['vue:error']('primitive boom', null, 'render function')
    hooks['app:error'](Object.assign(new Error('primitive boom'), { statusCode: 500, cause: 'primitive boom' }))
    await collector.flush()
    const records = state.sent.flat() as Array<Record<string, unknown>>
    expect(records.filter(record => record.message === 'fatal render failure')).toEqual([expect.objectContaining({ count: 1 })])
    expect(records.filter(record => record.message === 'primitive boom')).toEqual([expect.objectContaining({ count: 1 })])
  })

  it('never lets capture failures reach the page or Nuxt error handling', async () => {
    const collector = await start()
    const capture = vi.spyOn(collector, 'capture').mockImplementation(() => {
      throw new Error('collector broken')
    })
    const pageErrors: unknown[] = []
    const onError = (event: ErrorEvent) => pageErrors.push(event.error)
    window.addEventListener('error', onError)
    try {
      expect(() => window.dispatchEvent(new ErrorEvent('error', { error: new Error('app failure') }))).not.toThrow()
      expect(() => window.dispatchEvent(Object.assign(new Event('unhandledrejection'), { reason: new Error('rejected') }))).not.toThrow()
      expect(() => hooks['vue:error'](new Error('render failed'), null, 'render function')).not.toThrow()
      expect(() => hooks['app:error'](new Error('fatal'))).not.toThrow()
      expect(capture).toHaveBeenCalled()
      // Only the dispatched application error reached page listeners; the collector raised none of its own.
      expect(pageErrors.map(error => (error as Error)?.message)).toEqual(['app failure'])
    } finally {
      window.removeEventListener('error', onError)
    }
  })

  it('starts the app even when the collector cannot be created', async () => {
    vi.resetModules()
    vi.doMock('~/utils/clientErrorLog', () => ({
      useClientErrorLog: () => {
        throw new Error('runtime config unavailable')
      }
    }))
    try {
      const plugin = (await import('~~/app/plugins/client-error-log.client')).default
      await expect(Promise.resolve(plugin({ hook: vi.fn() } as never))).resolves.toBeUndefined()
    } finally {
      vi.doUnmock('~/utils/clientErrorLog')
    }
  })

  it('swallows delivery failures on page hide', async () => {
    const collector = await start()
    state.fetch.mockRejectedValue(new TypeError('Failed to fetch'))
    vi.stubGlobal('navigator', { ...navigator, sendBeacon: () => false })
    collector.capture('error', new Error('before hide'))
    const rejections: unknown[] = []
    const onRejection = (event: PromiseRejectionEvent) => rejections.push(event.reason)
    window.addEventListener('unhandledrejection', onRejection)
    try {
      window.dispatchEvent(new Event('pagehide'))
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(rejections).toEqual([])
    } finally {
      window.removeEventListener('unhandledrejection', onRejection)
    }
  })

  it('reads identity from document.cookie without registering cookie listeners', async () => {
    const collector = await start()
    const addEventListener = vi.fn()
    vi.stubGlobal('cookieStore', { addEventListener, removeEventListener: vi.fn() })
    const setInterval = vi.spyOn(globalThis, 'setInterval')
    for (let i = 0; i < 5; i++) {
      collector.capture('error', new Error(`batch ${i}`))
      await collector.flush()
    }
    expect(addEventListener).not.toHaveBeenCalled()
    expect(setInterval).not.toHaveBeenCalled()
    const records = state.sent.flat() as Array<Record<string, unknown>>
    expect(records).toHaveLength(5)
    expect(records.every(record => record.user_id === '10001' && record.device_id === 'device-1')).toBe(true)
    // A later sign-in is picked up by the next capture.
    setCookie('token', `h.${btoa(JSON.stringify({ id: 20002 }))}.s`)
    collector.capture('error', new Error('after sign-in'))
    await collector.flush()
    expect((state.sent.flat().at(-1) as Record<string, unknown>).user_id).toBe('20002')
  })

  it('stays inert without an endpoint', async () => {
    state.endpoint = ''
    const collector = await start()
    expect(collector.enabled).toBe(false)
    expect(hooks['vue:error']).toBeUndefined()
    window.dispatchEvent(new ErrorEvent('error', { error: new Error('x') }))
    await collector.flush()
    expect(state.fetch).not.toHaveBeenCalled()
  })
})
