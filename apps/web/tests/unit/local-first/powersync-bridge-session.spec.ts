// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { POWER_SYNC_DATABASE_GENERATION, POWER_SYNC_LOCAL_DATA_VERSION } from '~~/app/local-first/version'
import { afterEach, assert, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  cookie: vi.fn(),
  session: vi.fn(),
  connect: vi.fn(),
  clear: vi.fn(),
  init: vi.fn(),
  afterEach: vi.fn(),
  clearAuth: vi.fn()
}))
mockNuxtImport('useRuntimeConfig', () => () => ({
  public: { DWEB_API_BASE_URL: 'https://api.test', COOKIE_TOKEN_NAME: 'token', EXTENSION_BRIDGE_IDS: 'allowed-id', slaxEnv: 'production' }
}))
mockNuxtImport('useRouter', () => () => ({ afterEach: state.afterEach }))
mockNuxtImport('useAuth', () => () => ({ clearAuth: state.clearAuth }))
vi.mock('~/utils/request', () => ({ getUserToken: state.cookie, getClientEventHeaders: () => ({}) }))
vi.mock('~/utils/extensionBridgeSession', () => ({ requestExtensionBridgeSession: state.session }))
vi.mock('~/local-first/schema', () => ({ AppSchema: {} }))
vi.mock('@powersync/vue', () => ({ createPowerSyncPlugin: () => ({}) }))
vi.mock('@powersync/web', () => ({
  SyncStreamConnectionMethod: { HTTP: 'http' },
  PowerSyncDatabase: class {
    init = state.init
    connect = state.connect
    disconnectAndClear = state.clear
    connected = false
    connecting = false
  }
}))
vi.mock('~/local-first/powersync-recovery', () => ({
  initializePowerSyncWithFallback: async ({ createDatabase }: { createDatabase: (mode: string) => unknown }) => ({ database: createDatabase('shared'), mode: 'shared' })
}))

const token = (id: string, revision = 1) => `header.${btoa(JSON.stringify({ id, revision, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`
const app = { vueApp: { use: vi.fn() } }
const start = async () => {
  const plugin = (await import('~~/app/plugins/powersync.client')).default
  const result = await plugin(app as never)
  await Promise.resolve()
  return result
}
const getConnector = () => {
  const call = state.connect.mock.calls[0]
  assert.isDefined(call, 'PowerSync must connect before its connector is used')
  return call[0]
}

beforeEach(() => {
  vi.clearAllMocks()
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
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ data: { token: 'sync-token', endpoint: 'https://sync.test' } })))
})
afterEach(() => vi.restoreAllMocks())

describe('PowerSync in an authenticated extension iframe with no page cookie', () => {
  it('starts syncing and authenticates the sync-token request using the extension session', async () => {
    const sessionToken = token('user-a')
    state.session.mockResolvedValue(sessionToken)
    await start()
    expect(state.cookie).not.toHaveBeenCalled()
    expect(state.connect).toHaveBeenCalledOnce()
    const connector = getConnector()
    await expect(connector.fetchCredentials()).resolves.toEqual({ token: 'sync-token', endpoint: 'https://sync.test' })
    expect(fetch).toHaveBeenCalledWith('https://api.test/v1/sync/token', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${sessionToken}` })
    }))
  })

  it('reads renewed credentials for uploads and refuses a different account', async () => {
    await start()
    const connector = getConnector()
    const complete = vi.fn()
    const database = { getCrudBatch: async () => ({ crud: [], complete }) }
    const renewed = token('user-a', 2)
    state.session.mockResolvedValue(renewed)
    await connector.uploadData(database)
    expect(fetch).toHaveBeenLastCalledWith(expect.stringContaining('/v1/sync/changes'), expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${renewed}` })
    }))
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
