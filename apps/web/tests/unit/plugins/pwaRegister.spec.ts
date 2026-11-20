// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  registerSW: vi.fn(),
  fetch: vi.fn(),
  notice: { kind: null as string | null, buildId: null as string | null, dismissedKey: null as string | null },
  standalone: false,
  changeListeners: [] as Array<(event: { matches: boolean }) => void>
}))

vi.mock('virtual:pwa-register', () => ({ registerSW: state.registerSW }))
mockNuxtImport('useRuntimeConfig', () => () => ({ app: { baseURL: '/', buildAssetsDir: '/_nuxt/' } }))
mockNuxtImport('useState', () => () => ({
  get value() {
    return state.notice
  },
  set value(next) {
    state.notice = next
  }
}))

const start = async () => {
  vi.resetModules()
  const plugin = (await import('~~/app/plugins/pwa-register.client')).default
  return (await plugin.setup!({} as never)) as { provide: { pwa: { isPWAInstalled: boolean } } }
}
const options = () => state.registerSW.mock.calls[0][0] as { immediate: boolean; onNeedReload: () => void; onRegisterError: (error: unknown) => void }

beforeEach(() => {
  vi.clearAllMocks()
  state.notice = { kind: null, buildId: null, dismissedKey: null }
  state.standalone = false
  state.changeListeners = []
  state.fetch.mockReset().mockResolvedValue({ id: 'build-b', timestamp: 1 })
  vi.stubGlobal('$fetch', state.fetch)
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query === '(display-mode: standalone)' && state.standalone,
    addEventListener: (_type: string, listener: (event: { matches: boolean }) => void) => state.changeListeners.push(listener)
  }))
  if (!('serviceWorker' in navigator)) Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: {} })
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('PWA registration plugin', () => {
  it('registers the worker immediately and shows the notice instead of reloading when a new worker takes over', async () => {
    const reload = vi.fn()
    vi.stubGlobal('location', { ...window.location, reload })
    await start()
    expect(state.registerSW).toHaveBeenCalledOnce()
    expect(options().immediate).toBe(true)
    options().onNeedReload()
    await vi.waitFor(() => expect(state.notice.kind).toBe('available'))
    expect(state.notice.buildId).toBe('build-b')
    expect(state.fetch.mock.calls[0][0]).toMatch(/^\/_nuxt\/builds\/latest\.json\?\d+$/)
    expect(reload).not.toHaveBeenCalled()
    expect(() => options().onRegisterError(new Error('blocked'))).not.toThrow()
  })

  it('keeps a notice closed for the build the new worker brought, and still shows one when the build check fails', async () => {
    await start()
    options().onNeedReload()
    await vi.waitFor(() => expect(state.notice.buildId).toBe('build-b'))
    state.notice = { ...state.notice, dismissedKey: 'available:build-b' }
    options().onNeedReload()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(state.notice.dismissedKey).toBe('available:build-b')
    state.notice = { kind: null, buildId: null, dismissedKey: null }
    state.fetch.mockRejectedValueOnce(new Error('offline'))
    options().onNeedReload()
    await vi.waitFor(() => expect(state.notice.kind).toBe('available'))
  })

  it('provides isPWAInstalled from display-mode standalone and follows a later switch to it', async () => {
    const { provide } = await start()
    expect(provide.pwa.isPWAInstalled).toBe(false)
    state.changeListeners.forEach(listener => listener({ matches: true }))
    expect(provide.pwa.isPWAInstalled).toBe(true)
    state.standalone = true
    expect((await start()).provide.pwa.isPWAInstalled).toBe(true)
  })

  it('treats iOS home-screen launches as installed', async () => {
    Object.defineProperty(navigator, 'standalone', { configurable: true, value: true })
    try {
      expect((await start()).provide.pwa.isPWAInstalled).toBe(true)
    } finally {
      Reflect.deleteProperty(navigator, 'standalone')
    }
  })

  it('still provides $pwa when registration throws', async () => {
    state.registerSW.mockImplementationOnce(() => {
      throw new Error('unsupported')
    })
    expect((await start()).provide.pwa.isPWAInstalled).toBe(false)
  })
})
