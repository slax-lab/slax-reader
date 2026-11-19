// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { POWER_SYNC_DATABASE_GENERATION, POWER_SYNC_LOCAL_DATA_VERSION } from '~~/app/local-first/version'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Guard = (to: { path: string; fullPath: string }, from: { path: string; fullPath: string }) => unknown

const state = vi.hoisted(() => ({
  cookie: vi.fn(),
  session: vi.fn(),
  navigate: vi.fn(),
  guards: [] as Guard[],
  removed: 0,
  ready: null as null | { promise: Promise<boolean>; settle: (value: boolean) => void },
  pendingMode: 'shared' as string | null
}))
mockNuxtImport('navigateTo', () => state.navigate)
mockNuxtImport('refreshNuxtData', () => vi.fn())
mockNuxtImport('useAppConfig', () => () => ({ lcp: { anonymousPublicStartup: false } }))
mockNuxtImport('useRuntimeConfig', () => () => ({
  public: { DWEB_API_BASE_URL: 'https://api.test', COOKIE_TOKEN_NAME: 'token', EXTENSION_BRIDGE_IDS: 'allowed-id', slaxEnv: 'production' }
}))
const values = new Map<string, { value: unknown }>()
mockNuxtImport('useState', () => (key: string) => {
  if (!values.has(key)) values.set(key, { value: null })
  return values.get(key)
})
mockNuxtImport('useRouter', () => () => ({
  afterEach: vi.fn(),
  beforeEach: (guard: Guard) => {
    state.guards.push(guard)
    return () => {
      state.removed += 1
      state.guards = state.guards.filter(item => item !== guard)
    }
  }
}))
mockNuxtImport('useAuth', () => () => ({ clearAuth: vi.fn() }))
vi.mock('~/utils/request', () => ({ getUserToken: state.cookie, getClientEventHeaders: () => ({}) }))
vi.mock('~/utils/extensionBridgeSession', () => ({ requestExtensionBridgeSession: state.session }))
vi.mock('~/local-first/schema', () => ({ AppSchema: {} }))
vi.mock('@powersync/vue', () => ({ createPowerSyncPlugin: () => ({}) }))
vi.mock('@powersync/web', () => ({ SyncStreamConnectionMethod: { HTTP: 'http' }, PowerSyncDatabase: class {} }))
vi.mock('~/local-first/powersync-recovery', () => ({
  initializePowerSyncWithFallback: async () => ({
    database: null,
    mode: 'rest',
    ...(state.pendingMode && state.ready ? { pending: { mode: state.pendingMode, ready: state.ready.promise } } : {})
  })
}))

const token = (id: string) => `header.${btoa(JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`
const app = { vueApp: { use: vi.fn() }, runWithContext: (callback: () => unknown) => callback() }
const deferred = () => {
  let settle!: (value: boolean) => void
  const promise = new Promise<boolean>(resolve => { settle = resolve })
  return { promise, settle }
}
const start = async () => {
  const plugin = (await import('~~/app/plugins/powersync.client')).default
  return plugin(app as never)
}
const flush = async () => {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}
const route = (fullPath: string) => ({ path: new URL(fullPath, 'https://r.test').pathname, fullPath })

beforeEach(() => {
  vi.clearAllMocks()
  values.clear()
  state.guards = []
  state.removed = 0
  state.ready = deferred()
  state.pendingMode = 'shared'
  state.navigate.mockReset().mockResolvedValue(false)
  localStorage.clear()
  localStorage.setItem(`slax:powersync:${POWER_SYNC_DATABASE_GENERATION}:dataVersion`, String(POWER_SYNC_LOCAL_DATA_VERSION))
  state.cookie.mockReturnValue(token('user-a'))
  state.session.mockResolvedValue(token('user-a'))
  vi.spyOn(window, 'parent', 'get').mockReturnValue(window)
  window.history.replaceState(null, '', '/bookmarks')
})
afterEach(() => vi.restoreAllMocks())

describe('resuming local mode after a timed-out initialization', () => {
  it('keeps the current document on REST until a different path is visited', async () => {
    const result = await start()
    expect(result?.provide?.powersync).toBeNull()
    await flush()
    expect(state.guards).toHaveLength(0)

    state.ready!.settle(true)
    await flush()
    expect(state.guards).toHaveLength(1)
    expect(state.navigate).not.toHaveBeenCalled()

    const guard = state.guards[0]!
    expect(guard(route('/bookmarks?filter=starred#top'), route('/bookmarks'))).toBeUndefined()
    expect(state.navigate).not.toHaveBeenCalled()

    expect(guard(route('/b/abc?highlight=1#p'), route('/bookmarks'))).toBe(false)
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/b/abc?highlight=1#p', { external: true })
    expect(state.removed).toBe(1)
    expect(state.guards).toHaveLength(0)
  })

  it('installs no guard when the retained initialization fails', async () => {
    await start()
    state.ready!.settle(false)
    await flush()
    expect(state.guards).toHaveLength(0)
  })

  it('installs no guard without a retained initialization', async () => {
    state.pendingMode = null
    await start()
    await flush()
    expect(state.guards).toHaveLength(0)
  })

  it('never reloads the hosted extension bridge', async () => {
    window.history.replaceState(null, '', '/x/ext-bridge')
    sessionStorage.setItem('slax:ext-bridge-client-id', 'allowed-id')
    vi.spyOn(window, 'parent', 'get').mockReturnValue({ postMessage: vi.fn() } as unknown as Window)
    await start()
    state.ready!.settle(true)
    await flush()
    expect(state.guards).toHaveLength(0)
    expect(state.navigate).not.toHaveBeenCalled()
  })
})
