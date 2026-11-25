// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { POWER_SYNC_DATABASE_GENERATION, POWER_SYNC_LOCAL_DATA_VERSION } from '~~/app/local-first/version'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  cookie: vi.fn(),
  session: vi.fn(),
  connect: vi.fn(),
  clear: vi.fn(),
  disconnect: vi.fn(),
  getCrudBatch: vi.fn(),
  init: vi.fn(),
  afterEach: vi.fn(),
  clearAuth: vi.fn()
}))
const recoveryState = { value: null as string | null }
const navigationState = { value: null as string | null }
const navigation = vi.hoisted(() => ({ refreshContent: vi.fn(), login: vi.fn() }))
mockNuxtImport('refreshNuxtData', () => navigation.refreshContent)
mockNuxtImport('navigateTo', () => navigation.login)
mockNuxtImport('useAppConfig', () => () => ({ lcp: { anonymousPublicStartup: false } }))
mockNuxtImport('useRuntimeConfig', () => () => ({
  public: { DWEB_API_BASE_URL: 'https://api.test', COOKIE_TOKEN_NAME: 'token', EXTENSION_BRIDGE_IDS: 'allowed-id', slaxEnv: 'production' }
}))
const ownership = { value: null as string | null }
mockNuxtImport('useState', () => (key: string) => {
  if (key === 'snapshot-session-recovery-pending') return recoveryState
  if (key === 'snapshot-session-navigation') return navigationState
  return ownership
})
mockNuxtImport('useRouter', () => () => ({ afterEach: state.afterEach, beforeEach: vi.fn() }))
mockNuxtImport('useAuth', () => () => ({ clearAuth: state.clearAuth }))
vi.mock('~/utils/request', () => ({ getUserToken: state.cookie, getClientEventHeaders: () => ({}) }))
vi.mock('~/utils/extensionBridgeSession', () => ({ requestExtensionBridgeSession: state.session }))
vi.mock('~/local-first/schema', () => ({ AppSchema: {} }))
vi.mock('@powersync/vue', () => ({ createPowerSyncPlugin: () => ({}) }))
const gate = vi.hoisted(() => vi.fn())
vi.mock('~/local-first/powersync-visibility-gate', () => ({ deferLiveQueriesWhileHidden: gate }))
vi.mock('@powersync/web', () => ({
  SyncStreamConnectionMethod: { HTTP: 'http' },
  LogLevels: { trace: 10, debug: 20, info: 30, warn: 40, error: 50 },
  createConsoleLogger: () => ({ log: () => {} }),
  PowerSyncDatabase: class {
    init = state.init
    connect = state.connect
    getCrudBatch = state.getCrudBatch
    disconnect = state.disconnect
    disconnectAndClear = state.clear
    onChangeWithCallback = () => () => {}
    resolveTables = async () => []
    registerListener = () => () => {}
    connected = false
    connecting = false
  }
}))
vi.mock('~/local-first/powersync-recovery', () => ({
  initializePowerSyncWithFallback: async ({ createDatabase }: { createDatabase: (mode: string) => unknown }) => ({ database: createDatabase('shared'), mode: 'shared' })
}))

const token = (id: string, revision = 1) => `header.${btoa(JSON.stringify({ id, revision, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`
const app = { vueApp: { use: vi.fn() }, runWithContext: (callback: () => unknown) => callback() }
const start = async () => {
  const plugin = (await import('~~/app/plugins/powersync.client')).default
  const result = await plugin(app as never)
  await Promise.resolve()
  // Snapshot routes start local data in the background; wait until that startup settles.
  await result?.provide?.powersyncWhenReady?.()
  return result
}
const getConnector = () => {
  const call = state.connect.mock.calls[0]
  assert.isDefined(call, 'PowerSync must connect before its connector is used')
  return call[0]
}

beforeEach(() => {
  vi.clearAllMocks()
  recoveryState.value = null
  navigationState.value = null
  localStorage.clear()
  localStorage.setItem(`slax:powersync:${POWER_SYNC_DATABASE_GENERATION}:dataVersion`, String(POWER_SYNC_LOCAL_DATA_VERSION))
  localStorage.setItem('slax:powersync:lastUser', 'user-a')
  sessionStorage.setItem('slax:ext-bridge-client-id', 'allowed-id')
  window.history.replaceState(null, '', '/x/ext-bridge')
  vi.spyOn(window, 'parent', 'get').mockReturnValue({ postMessage: vi.fn() } as unknown as Window)
  state.cookie.mockReturnValue(undefined)
  state.session.mockReset().mockResolvedValue(token('user-a'))
  state.connect.mockResolvedValue(undefined)
  state.clear.mockResolvedValue(undefined)
  state.init.mockResolvedValue(undefined)
  state.getCrudBatch.mockReset().mockResolvedValue(null)
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { token: 'sync-token', endpoint: 'https://sync.test' } })))
})
afterEach(() => vi.restoreAllMocks())

describe('snapshot session expiry coordination', () => {
  const expired = `header.${btoa(JSON.stringify({ id: 'user-a', exp: 1 }))}.signature`
  const topLevel = (path: string) => {
    vi.spyOn(window, 'parent', 'get').mockReturnValue(window)
    window.history.replaceState(null, '', path)
    state.cookie.mockReturnValue(expired)
  }

  it('defers sync expiry while a destination snapshot is still loading', async () => {
    topLevel('/b/source')
    await start()
    navigationState.value = '/b/destination'
    await getConnector().fetchCredentials()
    expect(state.clearAuth).not.toHaveBeenCalled()
    expect(navigation.refreshContent).not.toHaveBeenCalled()
    expect(navigation.login).not.toHaveBeenCalled()
  })

  it('asks an already mounted snapshot to recheck metadata rather than navigating', async () => {
    topLevel('/b/current?highlight=mark#paragraph')
    await start()
    await getConnector().fetchCredentials()
    expect(navigation.refreshContent).toHaveBeenCalledExactlyOnceWith('content-current')
    expect(state.clearAuth).not.toHaveBeenCalled()
    expect(navigation.login).not.toHaveBeenCalled()
  })

  it.each(['current', 'navigating', 'recovering'])('keeps the snapshot URL on upload rejection while %s', async phase => {
    topLevel('/b/current')
    await start()
    if (phase === 'navigating') navigationState.value = '/b/next'
    if (phase === 'recovering') recoveryState.value = 'reader-recovery'
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }))
    await expect(getConnector().uploadData({ getCrudBatch: async () => ({ crud: [], complete: vi.fn() }) })).rejects.toThrow('401')
    expect(localStorage.getItem('slax:powersync:interruptedUpload')).toBe('suspended')
    expect(navigation.refreshContent).toHaveBeenCalledTimes(phase === 'current' ? 1 : 0)
    expect(navigation.login).not.toHaveBeenCalled()
    expect(state.clearAuth).not.toHaveBeenCalled()
  })

  it('retains the login redirect outside snapshot routes', async () => {
    topLevel('/bookmarks')
    await start()
    await getConnector().fetchCredentials()
    expect(state.clearAuth).toHaveBeenCalledOnce()
    expect(navigation.login).toHaveBeenCalledExactlyOnceWith('/login')
  })

  it('skips database startup for a server-confirmed rejected snapshot session', async () => {
    topLevel('/b/current')
    recoveryState.value = 'snapshot-owner'
    const result = await start()
    expect(result?.provide?.powersync).toBeNull()
    expect(state.init).not.toHaveBeenCalled()
    expect(state.connect).not.toHaveBeenCalled()
  })
})

describe('PowerSync in an authenticated extension iframe with no page cookie', () => {
  it('falls back without exposing local data when storage is denied at startup', async () => {
    await import('~~/app/plugins/powersync.client')
    vi.spyOn(window, 'parent', 'get').mockReturnValue(window)
    state.cookie.mockReturnValue(token('user-a'))
    const spy = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('denied', 'SecurityError')
    })
    try {
      const result = await start()
      expect(result?.provide?.powersync).toBeNull()
      expect(state.connect).not.toHaveBeenCalled()
    } finally {
      spy.mockRestore()
    }
  })
  it('does not expose old local data when account cleanup fails', async () => {
    state.session.mockResolvedValue(token('user-b'))
    state.clear.mockRejectedValue(new Error('database busy'))
    const result = await start()
    expect(result?.provide?.powersync).toBeNull()
    expect(state.connect).not.toHaveBeenCalled()
  })

  it('starts syncing and authenticates the sync-token request using the extension session', async () => {
    const sessionToken = token('user-a')
    state.session.mockResolvedValue(sessionToken)
    await start()
    expect(state.cookie).not.toHaveBeenCalled()
    expect(state.connect).toHaveBeenCalledOnce()
    expect(gate).not.toHaveBeenCalled()
    const connector = getConnector()
    await expect(connector.fetchCredentials()).resolves.toEqual({ token: 'sync-token', endpoint: 'https://sync.test' })
    expect(fetch).toHaveBeenCalledWith(
      'https://api.test/v1/sync/token',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${sessionToken}` })
      })
    )
  })

  it('reads renewed credentials for uploads and refuses a different account', async () => {
    await start()
    const connector = getConnector()
    const complete = vi.fn()
    const database = { getCrudBatch: async () => ({ crud: [], complete }) }
    const renewed = token('user-a', 2)
    state.session.mockResolvedValue(renewed)
    await connector.uploadData(database)
    expect(fetch).toHaveBeenLastCalledWith(
      expect.stringContaining('/v1/sync/changes'),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${renewed}` })
      })
    )
    expect(complete).toHaveBeenCalledOnce()

    state.session.mockResolvedValue(token('user-b'))
    await expect(connector.uploadData(database)).rejects.toThrow('account changed')
    expect(fetch).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledOnce()
  })

  it('clears the previous account data before connecting a remounted bridge', async () => {
    state.session.mockResolvedValue(token('user-b'))
    await start()
    expect(state.clear).toHaveBeenCalledOnce()
    const clearOrder = state.clear.mock.invocationCallOrder[0]
    const connectOrder = state.connect.mock.invocationCallOrder[0]
    assert.isDefined(clearOrder, 'Previous account data must be cleared')
    assert.isDefined(connectOrder, 'The remounted bridge must connect')
    expect(clearOrder).toBeLessThan(connectOrder)
    expect(localStorage.getItem('slax:powersync:lastUser')).toBe('user-b')
  })

  it('does not expose a database or fall back to an iframe cookie when the session is gone', async () => {
    state.session.mockResolvedValue(null)
    state.cookie.mockReturnValue(token('stale-user'))
    const result = await start()
    expect(result?.provide?.powersync).toBeNull()
    expect(state.connect).not.toHaveBeenCalled()
    expect(state.cookie).not.toHaveBeenCalled()
  })

  it('stops an upload after logout without completing the pending batch', async () => {
    await start()
    const connector = getConnector()
    state.session.mockResolvedValue(null)
    const complete = vi.fn()
    await expect(connector.uploadData({ getCrudBatch: async () => ({ crud: [], complete }) })).rejects.toThrow('active session')
    expect(fetch).not.toHaveBeenCalled()
    expect(complete).not.toHaveBeenCalled()
    // An old iframe must not adopt another account even after observing an empty session.
    state.session.mockResolvedValue(token('user-b'))
    await expect(connector.uploadData({ getCrudBatch: async () => ({ crud: [], complete }) })).rejects.toThrow('account changed')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('reports unavailable on handshake failure rather than connecting with stale local data', async () => {
    state.session.mockRejectedValue(new Error('session transport timed out'))
    const result = await start()
    expect(result?.provide?.powersync).toBeNull()
    expect(state.connect).not.toHaveBeenCalled()
    expect(window.parent.postMessage).toHaveBeenCalledWith({ type: 'slax-bridge-error', error: 'bridge session unavailable' }, '*')
  })

  it('notifies the extension after sync credentials are rejected', async () => {
    await start()
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }))
    const connector = getConnector()
    await expect(connector.fetchCredentials()).resolves.toBeNull()
    expect(state.clearAuth).toHaveBeenCalledOnce()
    expect(window.parent.postMessage).toHaveBeenCalledWith({ type: 'slax-bridge-auth-expired' }, '*')
  })

  it('leaves ordinary dweb tabs on their existing cookie authentication path', async () => {
    vi.spyOn(window, 'parent', 'get').mockReturnValue(window)
    window.history.replaceState(null, '', '/bookmarks')
    state.cookie.mockReturnValue(token('user-a'))
    await start()
    expect(state.session).not.toHaveBeenCalled()
    expect(state.connect).toHaveBeenCalledOnce()
  })
})

describe('recovering a rejected Web upload', () => {
  const marker = 'slax:powersync:interruptedUpload'
  beforeEach(() => {
    vi.spyOn(window, 'parent', 'get').mockReturnValue(window)
    window.history.replaceState(null, '', '/bookmarks')
    state.cookie.mockReturnValue(token('user-a'))
  })

  it('keeps an incomplete batch on rejection, disconnects, and hides the database on anonymous startup', async () => {
    await start()
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }))
    state.clearAuth.mockImplementationOnce(() => state.cookie.mockReturnValue(undefined))
    const complete = vi.fn()
    await expect(getConnector().uploadData({ getCrudBatch: async () => ({ crud: [], complete }) })).rejects.toThrow('401')
    expect(complete).not.toHaveBeenCalled()
    expect(localStorage.getItem(marker)).toBe('suspended')
    expect(ownership.value).toBeNull()
    await state.afterEach.mock.calls.at(-1)![0]()
    expect(state.disconnect).toHaveBeenCalled()
    expect(state.clear).not.toHaveBeenCalled()
    expect(navigation.login).toHaveBeenCalledWith('/login', { external: true })
    expect((await start())?.provide?.powersync).toBeNull()
  })

  it.each(['server rejection', 'expired JWT'])('retains offline edits on %s before upload begins', async mode => {
    if (mode === 'expired JWT') state.cookie.mockReturnValue('header.' + btoa(JSON.stringify({ id: 'user-a', exp: 1 })) + '.fixture')
    await start()
    state.getCrudBatch.mockResolvedValue({ crud: [{}] })
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }))
    state.clearAuth.mockImplementationOnce(() => state.cookie.mockReturnValue(undefined))
    await expect(getConnector().fetchCredentials()).resolves.toBeNull()
    expect(localStorage.getItem(marker)).toBe('suspended')
    await state.afterEach.mock.calls.at(-1)![0]()
    expect(state.disconnect).toHaveBeenCalled()
    expect(state.clear).not.toHaveBeenCalled()
    expect(fetch).toHaveBeenCalledTimes(mode === 'expired JWT' ? 0 : 1)
  })

  it.each(['user-a', 'user-b'])('verifies returning %s before connecting the queue', async owner => {
    localStorage.setItem(marker, 'suspended')
    state.cookie.mockReturnValue(token(owner))
    await start()
    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/sync/token'), expect.anything())
    expect(state.clear).toHaveBeenCalledTimes(owner === 'user-a' ? 0 : 1)
    expect(state.connect).toHaveBeenCalledOnce()
    expect(ownership.value).toBe(owner)
    expect(localStorage.getItem(marker)).toBeNull()
  })

  it('leaves the interrupted database inaccessible when the server rejects a matching identity', async () => {
    localStorage.setItem(marker, 'suspended')
    vi.mocked(fetch).mockResolvedValue(new Response('', { status: 401 }))
    expect((await start())?.provide?.powersync).toBeNull()
    expect(localStorage.getItem(marker)).toBe('suspended')
    expect(state.connect).not.toHaveBeenCalled()
    expect(state.clear).not.toHaveBeenCalled()
  })

  it('discards a suspended queue explicitly signed out on a database-bypassed screen', async () => {
    localStorage.setItem(marker, 'discard')
    await start()
    expect(state.clear).toHaveBeenCalledOnce()
    expect(state.clear.mock.invocationCallOrder[0]).toBeLessThan(state.connect.mock.invocationCallOrder[0]!)
    expect(localStorage.getItem(marker)).toBeNull()
  })

  it('never uploads a previous owner’s batch with a newly switched cookie', async () => {
    await start()
    state.cookie.mockReturnValue(token('user-b'))
    const complete = vi.fn()
    await expect(getConnector().uploadData({ getCrudBatch: async () => ({ crud: [], complete }) })).rejects.toThrow('owner')
    expect(fetch).not.toHaveBeenCalledWith('https://api.test/v1/sync/changes', expect.anything())
    expect(complete).not.toHaveBeenCalled()
  })
})
