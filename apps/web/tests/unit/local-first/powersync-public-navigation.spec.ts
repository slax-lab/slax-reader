// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { createMemoryHistory, createRouter } from 'vue-router'

const state = vi.hoisted(() => ({
  token: vi.fn(),
  navigate: vi.fn(),
  app: {} as Record<string, unknown>,
  router: {} as Record<string, unknown>
}))
mockNuxtImport('useNuxtApp', () => () => state.app)
mockNuxtImport('navigateTo', () => state.navigate)
mockNuxtImport('useRouter', () => () => state.router)
vi.mock('~/utils/request', () => ({ getUserToken: state.token }))

let dispose: () => void
let guard: (path: string) => Promise<false>
let route: { fullPath: string }
let inContext = false
const show = (persisted: boolean) => { const event = new Event('pageshow') as PageTransitionEvent; Object.defineProperty(event, 'persisted', { value: persisted }); window.dispatchEvent(event) }
const hide = () => window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
const settle = async () => { await Promise.resolve(); await Promise.resolve() }
async function setup(bypassed = true) {
  state.app.$powersyncPublicBypass = bypassed
  const plugin = (await import('~~/app/plugins/powersync-public-restore.client')).default
  const result = await plugin(state.app as never)
  guard = result!.provide!.powersyncPublicNavigate
  state.app.$powersyncPublicNavigate = guard
}
async function exit(path: string, fullPath = path) {
  const middleware = (await import('~~/app/middleware/powersync-public-exit.global')).default
  return middleware({ path, fullPath } as never, {} as never)
}

beforeEach(() => {
  vi.clearAllMocks()
  state.token.mockReset().mockReturnValue(undefined)
  state.navigate.mockReset().mockImplementation(() => {
    expect(inContext).toBe(true)
    return Promise.resolve()
  })
  route = { fullPath: '/guide?campaign=x#top' }
  state.router = {
    currentRoute: { value: route },
    resolve: (fullPath: string) => ({ fullPath })
  }
  dispose = () => {}
  state.app = {
    $powersyncPublicBypass: true,
    runWithContext: (callback: () => unknown) => {
      inContext = true
      try { return callback() } finally { inContext = false }
    },
    vueApp: { onUnmount: (callback: () => void) => { dispose = callback } }
  }
})
afterEach(() => { dispose(); vi.restoreAllMocks() })

describe('public document navigation and BFCache lifecycle', () => {
  it('preserves fullPath on document exit and aborts old SPA destination mounting', async () => {
    await setup()
    expect(await exit('/bookmarks', '/bookmarks?campaign=x#top')).toBe(false)
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/bookmarks?campaign=x#top', { external: true })
  })
  it.each(['/login', '/login/', '/guide', '/guide/'])('keeps %s query/hash navigation in the SPA', async path => {
    await setup()
    expect(await exit(path, `${path}?campaign=x#next`)).toBeUndefined()
    expect(state.navigate).not.toHaveBeenCalled()
  })
  it('keeps ordinary authenticated documents inert', async () => {
    const listen = vi.spyOn(window, 'addEventListener')
    await setup(false)
    state.token.mockReturnValue('present')
    show(true)
    expect(await exit('/bookmarks')).toBeUndefined()
    expect(state.navigate).not.toHaveBeenCalled()
    expect(listen.mock.calls.filter(([name]) => name === 'pageshow' || name === 'pagehide')).toEqual([])
  })
  it('ignores non-persisted events and unchanged anonymous restores', async () => {
    await setup()
    show(false)
    expect(state.token).not.toHaveBeenCalled()
    show(true)
    await settle()
    expect(state.navigate).not.toHaveBeenCalled()
    expect(await exit('/')).toBe(false)
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/', { external: true })
  })
  it.each(['present', 'error'])('reloads current path/query/hash on persisted restore with token state %s', async tokenState => {
    await setup()
    state.token.mockImplementation(() => {
      expect(inContext).toBe(true)
      if (tokenState === 'error') throw new Error('synthetic unreadable cookie')
      return 'present'
    })
    show(true)
    await settle()
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/guide?campaign=x#top', { external: true })
  })
  it('dispatches once for simultaneous restore and exit and blocks duplicate destination mounts', async () => {
    await setup()
    state.token.mockReturnValue('present')
    show(true)
    expect(await exit('/bookmarks')).toBe(false)
    expect(state.navigate).toHaveBeenCalledOnce()
    expect(state.navigate).toHaveBeenCalledWith('/guide?campaign=x#top', { external: true })
  })
  it('keeps the latch after Nuxt returns false for successful external middleware navigation', async () => {
    await setup()
    state.navigate.mockReturnValue(false)
    expect(await exit('/bookmarks')).toBe(false)
    expect(await exit('/b/example')).toBe(false)
    expect(state.navigate).toHaveBeenCalledOnce()
  })
  it('supports leave/back/leave and never traps the restored anonymous document', async () => {
    await setup()
    expect(await exit('/bookmarks')).toBe(false)
    hide()
    show(true)
    expect(await exit('/b/example', '/b/example?visit=2#read')).toBe(false)
    expect(state.navigate).toHaveBeenCalledTimes(2)
    expect(state.navigate).toHaveBeenLastCalledWith('/b/example?visit=2#read', { external: true })
  })
  it.each(['sync', 'async'])('releases the latch after %s failure and keeps old SPA aborted', async mode => {
    await setup()
    if (mode === 'sync') state.navigate.mockImplementationOnce(() => { throw new Error('synthetic navigation failed') })
    else state.navigate.mockRejectedValueOnce(new Error('synthetic navigation failed'))
    expect(await exit('/bookmarks')).toBe(false)
    expect(await exit('/b/example')).toBe(false)
    expect(state.navigate).toHaveBeenCalledTimes(2)
  })
  it('releases the latch after an actual cancelled Vue Router navigation', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes: [{ path: '/cancel', component: {} }] })
    router.beforeEach(() => false)
    const cancellation = await router.push('/cancel')
    await setup()
    state.navigate.mockResolvedValueOnce(cancellation)
    expect(await exit('/bookmarks')).toBe(false)
    expect(await exit('/b/example')).toBe(false)
    expect(state.navigate).toHaveBeenCalledTimes(2)
  })
  it('does not let an old rejected request clear the new activation latch', async () => {
    await setup()
    let rejectOld: (error: Error) => void = () => {}
    state.navigate.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject }))
    const old = exit('/bookmarks')
    await settle()
    hide()
    await exit('/b/example')
    rejectOld(new Error('old request failed'))
    await old
    await exit('/s/example')
    expect(state.navigate).toHaveBeenCalledTimes(2)
  })
  it('removes listeners on app teardown and makes retained navigation closures inert', async () => {
    const remove = vi.spyOn(window, 'removeEventListener')
    await setup()
    dispose()
    state.token.mockReturnValue('present')
    show(true)
    hide()
    expect(await guard('/bookmarks')).toBe(false)
    expect(state.navigate).not.toHaveBeenCalled()
    expect(remove.mock.calls.filter(([name]) => name === 'pageshow')).toHaveLength(1)
    expect(remove.mock.calls.filter(([name]) => name === 'pagehide')).toHaveLength(1)
  })
  it.each(['https://outside.invalid', '//outside.invalid', '/\\outside.invalid'])('refuses non-internal navigation destination %s', async target => {
    await setup()
    expect(await guard(target)).toBe(false)
    expect(state.navigate).not.toHaveBeenCalled()
    expect(await exit('/bookmarks')).toBe(false)
    expect(state.navigate).toHaveBeenCalledOnce()
  })
})
