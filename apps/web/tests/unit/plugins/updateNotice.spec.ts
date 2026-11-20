// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  reload: vi.fn(),
  fetch: vi.fn(),
  manifest: vi.fn(),
  beforeEach: [] as Array<() => void>,
  onError: [] as Array<(error: unknown, to: { fullPath: string }) => void>,
  notice: { kind: null as string | null, buildId: null as string | null, dismissedKey: null as string | null }
}))

mockNuxtImport('reloadNuxtApp', () => state.reload)
mockNuxtImport('getAppManifest', () => state.manifest)
mockNuxtImport('useRuntimeConfig', () => () => ({ app: { baseURL: '/', buildAssetsDir: '/_nuxt/' } }))
mockNuxtImport('useRouter', () => () => ({
  beforeEach: (guard: () => void) => state.beforeEach.push(guard),
  onError: (handler: (error: unknown, to: { fullPath: string }) => void) => state.onError.push(handler)
}))
mockNuxtImport('useState', () => () => ({
  get value() {
    return state.notice
  },
  set value(next) {
    state.notice = next
  }
}))

let handlers: Record<string, Array<(...args: unknown[]) => unknown>> = {}
const callHook = async (name: string, ...args: unknown[]) => {
  for (const handler of handlers[name] ?? []) await handler(...args)
}
const hooks = new Proxy({} as Record<string, (...args: unknown[]) => Promise<void>>, { get: (_target, name: string) => (...args: unknown[]) => callHook(name, ...args) })
const documentListeners: Array<[string, EventListenerOrEventListenerObject]> = []
const addDocumentListener = document.addEventListener.bind(document)
let visibility: DocumentVisibilityState = 'visible'
const start = async () => {
  vi.resetModules()
  handlers = {}
  state.beforeEach = []
  state.onError = []
  const plugin = (await import('~~/app/plugins/update-notice.client')).default
  const nuxtApp = {
    hook: (name: string, fn: (...args: unknown[]) => unknown) => void (handlers[name] ??= []).push(fn),
    hooks: { callHook }
  }
  await plugin.setup!(nuxtApp as never)
}
const navigate = (error: unknown, fullPath = '/bookmarks?tab=all') => {
  state.beforeEach.forEach(guard => guard())
  state.onError.forEach(handler => handler(error, { fullPath }))
}
const show = async () => {
  visibility = 'visible'
  document.dispatchEvent(new Event('visibilitychange'))
  await vi.waitFor(() => expect(state.manifest).toHaveBeenCalled())
  await new Promise(resolve => setTimeout(resolve, 0))
}

beforeEach(() => {
  vi.clearAllMocks()
  state.notice = { kind: null, buildId: null, dismissedKey: null }
  state.manifest.mockResolvedValue({ id: 'build-a' })
  state.fetch.mockResolvedValue({ id: 'build-b' })
  vi.stubGlobal('$fetch', state.fetch)
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility)
  vi.spyOn(document, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject) => {
    documentListeners.push([type, listener])
    addDocumentListener(type, listener)
  })
})
afterEach(() => {
  documentListeners.splice(0).forEach(([type, listener]) => document.removeEventListener(type, listener))
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('update notice plugin', () => {
  it('shows the notice for a published build and does not reload, even on the next navigation', async () => {
    await start()
    await hooks['app:manifest:update']({ id: 'build-b', timestamp: 1 })
    expect(state.notice).toMatchObject({ kind: 'available', buildId: 'build-b' })
    navigate(new Error('navigation cancelled'))
    expect(state.reload).not.toHaveBeenCalled()
  })

  it('marks the page outdated on a chunk error and reloads a navigation that failed on it', async () => {
    await start()
    const error = new Error('Failed to fetch dynamically imported module: /_nuxt/page.js')
    state.beforeEach.forEach(guard => guard())
    hooks['app:chunkError']({ error })
    state.onError.forEach(handler => handler(error, { fullPath: '/bookmarks?tab=all' }))
    expect(state.notice.kind).toBe('outdated')
    expect(state.reload).toHaveBeenCalledWith({ path: '/bookmarks?tab=all', persistState: true })
  })

  it('does not reload for an unrelated navigation error or a chunk error from an earlier navigation', async () => {
    await start()
    const error = new Error('Failed to fetch dynamically imported module: /_nuxt/page.js')
    hooks['app:chunkError']({ error })
    navigate(error)
    navigate(new Error('guard rejected'))
    expect(state.reload).not.toHaveBeenCalled()
  })

  it('does not downgrade the outdated wording when a newer build is then found', async () => {
    await start()
    hooks['app:chunkError']({ error: new Error('x') })
    await hooks['app:manifest:update']({ id: 'build-b' })
    expect(state.notice.kind).toBe('outdated')
  })

  it('checks for a newer build when the page becomes visible, at most once a minute', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await start()
    await show()
    expect(state.fetch).toHaveBeenCalledTimes(1)
    expect(state.fetch.mock.calls[0][0]).toMatch(/^\/_nuxt\/builds\/latest\.json\?\d+$/)
    expect(state.notice).toMatchObject({ kind: 'available', buildId: 'build-b' })
    await show()
    expect(state.fetch).toHaveBeenCalledTimes(1)
    vi.setSystemTime(Date.now() + 61_000)
    await show()
    expect(state.fetch).toHaveBeenCalledTimes(2)
  })

  it('ignores hidden transitions, an unchanged build, and a failed check', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    await start()
    visibility = 'hidden'
    document.dispatchEvent(new Event('visibilitychange'))
    expect(state.manifest).not.toHaveBeenCalled()
    state.fetch.mockResolvedValueOnce({ id: 'build-a' })
    await show()
    expect(state.notice.kind).toBeNull()
    vi.setSystemTime(Date.now() + 61_000)
    state.fetch.mockRejectedValueOnce(new Error('offline'))
    await show()
    expect(state.notice.kind).toBeNull()
    vi.setSystemTime(Date.now() + 61_000)
    state.fetch.mockResolvedValueOnce('<!DOCTYPE html>')
    await show()
    expect(state.notice.kind).toBeNull()
  })

  it('keeps checking after the first newer build, so a closed notice returns for a later release', async () => {
    vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] })
    await start()
    await hooks['app:manifest:update']({ id: 'build-b' })
    state.notice = { ...state.notice, dismissedKey: 'available:build-b' }
    state.fetch.mockResolvedValue({ id: 'build-c' })
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(state.fetch).toHaveBeenCalledTimes(1)
    expect(state.notice).toMatchObject({ kind: 'available', buildId: 'build-c' })
    visibility = 'hidden'
    await vi.advanceTimersByTimeAsync(5 * 60_000)
    expect(state.fetch).toHaveBeenCalledTimes(1)
  })

  it('treats a removed manifest for the running build as outdated by a newer one', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    state.manifest.mockRejectedValue(Object.assign(new Error('Not Found'), { status: 404 }))
    await start()
    await show()
    expect(state.notice).toMatchObject({ kind: 'available', buildId: 'build-b' })
  })
})
