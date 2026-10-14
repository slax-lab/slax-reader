// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { POWER_SYNC_DATABASE_GENERATION, POWER_SYNC_LOCAL_DATA_VERSION } from '~/local-first/version'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  construct: vi.fn(),
  init: vi.fn(),
  connect: vi.fn(),
  clear: vi.fn(),
  afterEach: vi.fn()
}))

mockNuxtImport('useRuntimeConfig', () => () => ({
  public: { DWEB_API_BASE_URL: 'https://api.test', COOKIE_TOKEN_NAME: 'token' }
}))
mockNuxtImport('useState', () => (_key: string, init: () => unknown) => ({ value: init() }))
mockNuxtImport('useRouter', () => () => ({ afterEach: state.afterEach }))
mockNuxtImport('useCookie', () => () => ({ value: undefined }))
mockNuxtImport('watch', () => vi.fn())
vi.mock('~/utils/request', () => ({ getUserToken: () => undefined, getClientEventHeaders: () => ({}) }))
vi.mock('~/local-first/schema', () => ({ AppSchema: {} }))
vi.mock('@powersync/vue', () => ({ createPowerSyncPlugin: () => ({}) }))
// Keep the real plugin and recovery logic; replace only the browser database boundary.
vi.mock('@powersync/web', () => ({
  SyncStreamConnectionMethod: { HTTP: 'http' },
  PowerSyncDatabase: class {
    constructor(options: unknown) { state.construct(options) }
    init = state.init
    connect = state.connect
    disconnectAndClear = state.clear
    connected = false
    connecting = false
  }
}))

beforeEach(() => {
  vi.clearAllMocks()
  state.init.mockResolvedValue(undefined)
  vi.stubGlobal('SharedWorker', class {})
  vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (X11; Linux x86_64) Firefox/143.0')
  vi.stubGlobal('safari', undefined)
  window.history.replaceState(null, '', '/bookmarks')
  localStorage.clear()
  localStorage.setItem(`slax:powersync:${POWER_SYNC_DATABASE_GENERATION}:dataVersion`, String(POWER_SYNC_LOCAL_DATA_VERSION))
  vi.spyOn(console, 'info').mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

const start = async () => {
  const plugin = (await import('~~/app/plugins/powersync.client')).default
  return plugin({ vueApp: { use: vi.fn() } } as never)
}

const expectDatabaseMode = (mode: 'shared' | 'dedicated' | 'main') => {
  expect(state.construct).toHaveBeenCalledExactlyOnceWith({
    schema: {},
    database: {
      dbFilename: `slax-reader-${POWER_SYNC_DATABASE_GENERATION}.db`,
      useWebWorker: mode !== 'main',
      enableMultiTabs: mode === 'shared',
      disableSSRWarning: true
    }
  })
  expect(state.init).toHaveBeenCalledOnce()
  expect(state.clear).not.toHaveBeenCalled()
  expect(console.info).toHaveBeenCalledWith('[powersync] database ready', expect.objectContaining({ mode }))
}

describe.skipIf(import.meta.dev)('production PowerSync worker selection', () => {
  it.each(['iPhone', 'iPad', 'iPod', 'Android'])('starts directly in dedicated mode on %s', async platform => {
    vi.spyOn(window.navigator, 'userAgent', 'get').mockReturnValue(`Mozilla/5.0 (${platform}) AppleWebKit/605.1.15 Safari/604.1`)
    expect((await start())?.provide?.powersync).not.toBeNull()
    expectDatabaseMode('dedicated')
  })

  it('starts directly in dedicated mode on desktop Safari', async () => {
    vi.stubGlobal('safari', {})
    await start()
    expectDatabaseMode('dedicated')
  })

  it('retains shared mode on eligible desktop browsers', async () => {
    await start()
    expectDatabaseMode('shared')
  })

  it('starts in dedicated mode when SharedWorker is unavailable', async () => {
    vi.stubGlobal('SharedWorker', undefined)
    await start()
    expectDatabaseMode('dedicated')
  })
})

describe.runIf(import.meta.dev)('development PowerSync worker selection', () => {
  it.each([undefined, {}])('retains main-thread initialization with Safari marker %j', async safari => {
    vi.stubGlobal('safari', safari)
    await start()
    expectDatabaseMode('main')
  })
})
