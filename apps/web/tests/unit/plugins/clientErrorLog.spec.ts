// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({ endpoint: 'https://stream.ingest.invalid', sent: [] as unknown[][], fetch: vi.fn() }))

mockNuxtImport('useRuntimeConfig', () => () => ({ public: { CLIENT_ERROR_INGEST_URL: state.endpoint, appVersion: '2.1.0', slaxEnv: 'production' } }))
vi.mock('~/utils/request', () => ({ getUserToken: () => `h.${btoa(JSON.stringify({ id: 10001 }))}.s`, getDeviceId: () => 'device-1' }))

let hooks: Record<string, (...args: unknown[]) => void> = {}
const start = async () => {
  vi.resetModules()
  hooks = {}
  const plugin = (await import('~~/app/plugins/client-error-log.client')).default
  await plugin({ hook: (name: string, fn: (...args: unknown[]) => void) => void (hooks[name] = fn) } as never)
  return (await import('~/utils/clientErrorLog')).useClientErrorLog()
}

beforeEach(() => {
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
