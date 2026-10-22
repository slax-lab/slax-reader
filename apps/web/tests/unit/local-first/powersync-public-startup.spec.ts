// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { POWER_SYNC_DATABASE_GENERATION, POWER_SYNC_LOCAL_DATA_VERSION } from '~/local-first/version'

const state = vi.hoisted(() => ({
  enabled: true,
  token: vi.fn(),
  construct: vi.fn(),
  connector: vi.fn(),
  init: vi.fn(),
  connect: vi.fn(),
  clear: vi.fn(),
  close: vi.fn(),
  batch: vi.fn(),
  owner: { value: null as string | null },
  afterEach: vi.fn()
}))
mockNuxtImport('useAppConfig', () => () => ({ lcp: { anonymousPublicStartup: state.enabled } }))
mockNuxtImport('useRuntimeConfig', () => () => ({ public: { DWEB_API_BASE_URL: 'https://fixtures.invalid', COOKIE_TOKEN_NAME: 'synthetic_token' } }))
mockNuxtImport('useState', () => () => state.owner)
mockNuxtImport('useRouter', () => () => ({ afterEach: state.afterEach }))
mockNuxtImport('useCookie', () => () => ({ value: undefined }))
mockNuxtImport('watch', () => vi.fn())
vi.mock('~/utils/request', () => ({ getUserToken: state.token, getClientEventHeaders: () => ({}) }))
vi.mock('~/local-first/schema', () => ({ AppSchema: {} }))
vi.mock('~/local-first/connector', () => ({ createConnector: state.connector, clearSyncCredsCache: vi.fn() }))
vi.mock('@powersync/vue', () => ({ createPowerSyncPlugin: () => ({}) }))
vi.mock('@powersync/web', () => ({
  SyncStreamConnectionMethod: { HTTP: 'http' },
  PowerSyncDatabase: class {
    constructor(options: unknown) { state.construct(options) }
    init = state.init
    connect = state.connect
    disconnectAndClear = state.clear
    close = state.close
    getCrudBatch = state.batch
    connected = false
    connecting = false
  }
}))
const start = async () => (await import('~~/app/plugins/powersync.client')).default({ vueApp: { use: vi.fn() } } as never)

beforeEach(() => {
  vi.clearAllMocks()
  state.enabled = true
  state.owner.value = null
  state.token.mockReset().mockReturnValue(undefined)
  state.init.mockReset().mockResolvedValue(undefined)
  state.clear.mockResolvedValue(undefined)
  state.connect.mockResolvedValue(undefined)
  state.close.mockResolvedValue(undefined)
  state.batch.mockResolvedValue(null)
  state.connector.mockReturnValue({})
  window.history.replaceState(null, '', '/login')
  localStorage.clear()
  localStorage.setItem('slax:powersync:lastUser', 'old-account')
  localStorage.setItem(`slax:powersync:${POWER_SYNC_DATABASE_GENERATION}:dataVersion`, String(POWER_SYNC_LOCAL_DATA_VERSION))
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => { vi.restoreAllMocks(); localStorage.clear() })

describe('real PowerSync plugin public bypass', () => {
  it.each(['/login', '/login/', '/guide?campaign=synthetic#intro', '/guide/'])('mounts %s while database init would never settle, leaving stored data and ownership untouched', async path => {
    window.history.replaceState(null, '', path)
    state.init.mockImplementation(() => new Promise(() => {}))
    localStorage.setItem(`slax:powersync:${POWER_SYNC_DATABASE_GENERATION}:dataVersion`, '0')
    const result = await start()
    expect(result?.provide).toMatchObject({ powersync: null, powersyncPublicBypass: true })
    await result?.provide?.powersyncConnect()
    await result?.provide?.powersyncReset()
    expect(state.connector).not.toHaveBeenCalled()
    expect(state.construct).not.toHaveBeenCalled()
    expect(state.init).not.toHaveBeenCalled()
    expect(state.connect).not.toHaveBeenCalled()
    expect(state.clear).not.toHaveBeenCalled()
    expect(state.batch).not.toHaveBeenCalled()
    expect(state.owner.value).toBeNull()
    expect(localStorage.getItem('slax:powersync:lastUser')).toBe('old-account')
    expect(localStorage.getItem(`slax:powersync:${POWER_SYNC_DATABASE_GENERATION}:dataVersion`)).toBe('0')
  })
  it.each(['/bookmarks', '/', '/auth', '/b/example', '/s/example', '/login/extra', '/guide/extra', '/x/ext-bridge', '/pricing?next=/login'])('keeps normal startup for %s', async path => {
    window.history.replaceState(null, '', path)
    const result = await start()
    expect(result?.provide?.powersyncPublicBypass).toBe(false)
    expect(state.construct).toHaveBeenCalledOnce()
    expect(state.init).toHaveBeenCalledOnce()
    expect(result?.provide?.powersync).not.toBeNull()
  })
  it('keeps database startup when the switch is disabled', async () => {
    state.enabled = false
    const result = await start()
    expect(result?.provide?.powersyncPublicBypass).toBe(false)
    expect(state.construct).toHaveBeenCalledOnce()
  })
  it('keeps authenticated guide startup and ownership guards', async () => {
    const token = `header.${btoa(JSON.stringify({ id: 'old-account', exp: 9999999999 }))}.signature`
    state.token.mockReturnValue(token)
    window.history.replaceState(null, '', '/guide')
    const result = await start()
    expect(result?.provide?.powersyncPublicBypass).toBe(false)
    expect(state.owner.value).toBe('old-account')
    expect(state.construct).toHaveBeenCalledOnce()
  })
  it('does not classify unreadable tokens as absent and preserves unavailable fallback', async () => {
    state.token.mockImplementation(() => { throw new Error('synthetic denied cookie access') })
    const result = await start()
    expect(result?.provide).toMatchObject({ powersyncPublicBypass: false, powersync: null })
    expect(state.construct).toHaveBeenCalledOnce()
    expect(state.close).toHaveBeenCalledOnce()
    expect(state.owner.value).toBeNull()
  })
  it('does not bypass an iframe even on a public path', async () => {
    vi.spyOn(window, 'parent', 'get').mockReturnValue({} as Window)
    const result = await start()
    expect(result?.provide?.powersyncPublicBypass).toBe(false)
    expect(state.construct).toHaveBeenCalledOnce()
  })
})
