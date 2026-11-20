// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { POWER_SYNC_DATABASE_GENERATION, POWER_SYNC_LOCAL_DATA_VERSION } from '~/local-first/version'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  construct: vi.fn(),
  init: vi.fn(),
  connect: vi.fn(),
  clear: vi.fn(),
  capture: vi.fn(),
  sdkConsole: vi.fn(),
  connectorOptions: [] as Array<{ onError?: (error: unknown) => void }>,
  listeners: [] as Array<{ statusChanged?: (status: unknown) => void }>,
  afterEach: vi.fn(),
  report: vi.fn()
}))

mockNuxtImport('useAppConfig', () => () => ({ lcp: { anonymousPublicStartup: false } }))
mockNuxtImport('useRuntimeConfig', () => () => ({ public: { DWEB_API_BASE_URL: 'https://api.test', COOKIE_TOKEN_NAME: 'token' } }))
mockNuxtImport('useState', () => (_key: string, init: () => unknown) => ({ value: init() }))
mockNuxtImport('useRouter', () => () => ({ afterEach: state.afterEach }))
mockNuxtImport('useCookie', () => () => ({ value: undefined }))
mockNuxtImport('watch', () => vi.fn())
vi.mock('~/utils/request', () => ({ getUserToken: () => undefined, getClientEventHeaders: () => ({}) }))
vi.mock('~/utils/clientErrorLog', () => ({ useClientErrorLog: () => ({ enabled: true, capture: state.capture, flush: async () => {} }) }))
vi.mock('~/local-first/connector', async importOriginal => {
  const actual = await importOriginal<typeof import('~/local-first/connector')>()
  return {
    ...actual,
    createConnector: (options: Parameters<typeof actual.createConnector>[0]) => {
      state.connectorOptions.push(options)
      return actual.createConnector(options)
    }
  }
})
vi.mock('~/composables/useUpdateNotice', () => ({ useUpdateNotice: () => ({ report: state.report }) }))
vi.mock('~/local-first/schema', () => ({ AppSchema: {} }))
vi.mock('@powersync/vue', () => ({ createPowerSyncPlugin: () => ({}) }))
vi.mock('@powersync/web', () => ({
  SyncStreamConnectionMethod: { HTTP: 'http' },
  LogLevels: { trace: 10, debug: 20, info: 30, warn: 40, error: 50 },
  createConsoleLogger: () => ({ log: state.sdkConsole }),
  PowerSyncDatabase: class {
    constructor(options: unknown) { state.construct(options) }
    init = state.init
    connect = state.connect
    disconnectAndClear = state.clear
    onChangeWithCallback = () => () => {}
    resolveTables = async () => []
    registerListener = (listener: { statusChanged?: (status: unknown) => void }) => {
      state.listeners.push(listener)
      return () => {}
    }
    connected = false
    connecting = false
  }
}))

// The reporter lock state is module-level, so each test loads the plugin fresh.
const start = async () => {
  vi.resetModules()
  return (await import('~~/app/plugins/powersync.client')).default({ vueApp: { use: vi.fn() } } as never)
}
const sources = () => state.capture.mock.calls.map(([kind, , props]) => `${kind}:${(props as { source: string }).source}`)
const status = (dataFlowStatus: Record<string, unknown>) => ({ connected: false, dataFlowStatus })
const logger = () => (state.construct.mock.calls[0][0] as { logger: { log: (record: { level: number; message: string; error?: unknown }) => void } }).logger

beforeEach(() => {
  vi.clearAllMocks()
  state.report.mockReset()
  state.listeners = []
  state.connectorOptions = []
  state.init.mockResolvedValue(undefined)
  vi.stubGlobal('SharedWorker', class {})
  window.history.replaceState(null, '', '/bookmarks')
  localStorage.clear()
  localStorage.setItem(`slax:powersync:${POWER_SYNC_DATABASE_GENERATION}:dataVersion`, String(POWER_SYNC_LOCAL_DATA_VERSION))
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {})
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('PowerSync error capture', () => {
  it('records SDK error-level logs only and passes every record to the SDK console logger unchanged', async () => {
    await start()
    logger().log({ level: 20, message: 'Upload complete, no write checkpoint needed.' })
    logger().log({ level: 30, message: 'sync connected' })
    logger().log({ level: 40, message: 'Initial connect attempt did not successfully connect' })
    logger().log({ level: 50, message: 'Sync error', error: new Error('HTTP Service Unavailable') })
    logger().log({ level: 50, message: 'Error in database or sync worker, this likely disrupts PowerSync.' })
    expect(sources()).toEqual(['powersync:sdk.logger', 'powersync:sdk.logger'])
    expect(state.capture.mock.calls[0][1]).toMatchObject({ message: 'HTTP Service Unavailable' })
    expect(state.capture.mock.calls[1][1]).toMatchObject({ name: 'PowerSyncLog', message: 'Error in database or sync worker, this likely disrupts PowerSync.' })
    expect(state.capture.mock.calls[0][2]).not.toHaveProperty('sdk_message')
    expect(state.sdkConsole.mock.calls.map(([record]) => (record as { level: number }).level)).toEqual([20, 30, 40, 50, 50])
    expect(state.sdkConsole).toHaveBeenCalledWith({ level: 20, message: 'Upload complete, no write checkpoint needed.' })
  })

  it('counts one SDK failure logged twice in a row once, and later retries again', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await start()
      const failure = () => new Error('HTTP Service Unavailable: {"error":{"code":"PSYNC_S2001"}}')
      logger().log({ level: 50, message: 'Could not POST streaming to /sync/stream - 503', error: failure() })
      logger().log({ level: 50, message: 'Sync error', error: failure() })
      vi.setSystemTime(Date.now() + 5000)
      logger().log({ level: 50, message: 'Could not POST streaming to /sync/stream - 503', error: failure() })
      expect(state.capture).toHaveBeenCalledTimes(2)
      // Distinct non-Error payloads inside the window are separate failures.
      logger().log({ level: 50, message: 'worker message A', error: 'string payload A' })
      logger().log({ level: 50, message: 'worker message B', error: { reason: 'payload B' } })
      expect(state.capture).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('measures the duplicate window from the first log, so a fast repeating failure is counted each window', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    try {
      await start()
      // The same SDK error every 400 ms for 4 seconds.
      for (let i = 0; i < 10; i++) {
        logger().log({ level: 50, message: 'Sync error', error: new Error('HTTP 503') })
        vi.setSystemTime(Date.now() + 400)
      }
      expect(state.capture).toHaveBeenCalledTimes(4)
    } finally {
      vi.useRealTimers()
    }
  })

  it('counts each failure from one source: the status listener does not record the same failure again', async () => {
    await start()
    const [listener] = state.listeners
    logger().log({ level: 50, message: 'Sync error', error: new TypeError('network error') })
    listener?.statusChanged?.(status({ downloadError: new TypeError('network error') }))
    listener?.statusChanged?.(status({ uploadError: new Error('[powersync] upload changes failed: 500') }))
    expect(sources()).toEqual(['powersync:sdk.logger'])
  })

  it('records shared-worker log records only in the tab holding the reporter lock', async () => {
    const granted: Array<() => void> = []
    vi.stubGlobal('navigator', {
      ...navigator,
      locks: { request: (_name: string, callback: () => Promise<void>) => new Promise<void>(resolve => granted.push(() => void callback().then(resolve))) }
    })
    await start()
    logger().log({ level: 50, message: 'Sync error', error: new Error('HTTP 503 before lock') })
    expect(state.capture).not.toHaveBeenCalled()
    granted[0]?.()
    await Promise.resolve()
    logger().log({ level: 50, message: 'Sync error', error: new Error('HTTP 503 after lock') })
    expect(state.capture).toHaveBeenCalledOnce()
    expect(state.capture.mock.calls[0][1]).toMatchObject({ message: 'HTTP 503 after lock' })
  })

  it('records a local database initialization failure', async () => {
    state.init.mockRejectedValue(new Error('Aborted(CompileError: WebAssembly.instantiate())'))
    const result = await start()
    expect(result?.provide?.powersync).toBeNull()
    expect(sources().some(source => source === 'powersync:init' || source === 'powersync:recovery.attempt')).toBe(true)
    expect(state.capture.mock.calls.find(([, , props]) => ['init', 'recovery.attempt'].includes((props as { source: string }).source))?.[1]).toMatchObject({
      message: 'Aborted(CompileError: WebAssembly.instantiate())'
    })
  })

  it('records a rejected upload from the connector and keeps the original console line', async () => {
    await start()
    const [options] = state.connectorOptions
    const failure = new Error('[powersync] upload changes failed: 500')
    options.onError?.(failure)
    expect(sources()).toEqual(['powersync:connector.upload'])
    expect(state.capture.mock.calls[0][1]).toBe(failure)
    expect(console.error).toHaveBeenCalledWith('[powersync] uploadData failed:', failure)
  })

  it('keeps the SDK logger and connector working when capture throws', async () => {
    state.capture.mockImplementation(() => {
      throw new Error('collector broken')
    })
    const result = await start()
    expect(result?.provide?.powersync).toBeTruthy()
    // The SDK calls the logger inside its retry loop; it must still print and must not throw.
    expect(() => logger().log({ level: 50, message: 'Sync error', error: new Error('HTTP 503') })).not.toThrow()
    expect(state.sdkConsole).toHaveBeenCalledWith(expect.objectContaining({ message: 'Sync error' }))
    const failure = new Error('[powersync] upload changes failed: 500')
    expect(() => state.connectorOptions[0].onError?.(failure)).not.toThrow()
    expect(console.error).toHaveBeenCalledWith('[powersync] uploadData failed:', failure)
    expect(state.capture).toHaveBeenCalled()
  })

  it('asks for a refresh when the database WASM or worker script was replaced by an HTML page', async () => {
    state.init.mockRejectedValue(new Error('WebAssembly.instantiate(): expected magic word 00 61 73 6d, found 3c 21 44 4f @+0'))
    const result = await start()
    expect(result?.provide?.powersync).toBeNull()
    expect(state.report).toHaveBeenCalledWith('outdated')
    expect(state.capture).toHaveBeenCalled()
  })

  it.each([
    new DOMException('The operation is insecure.', 'SecurityError'),
    new DOMException('Encountered full disk while opening backing store', 'QuotaExceededError'),
    new Error('Timeout while acquiring lock'),
    new Error('Aborted(CompileError: WebAssembly.instantiate())')
  ])('does not ask for a refresh for %s', async error => {
    state.init.mockRejectedValue(error)
    await start()
    expect(state.report).not.toHaveBeenCalled()
  })

  it('keeps recovery, fallback, and capture unchanged when the notice throws', async () => {
    state.report.mockImplementation(() => {
      throw new Error('notice broken')
    })
    state.init.mockRejectedValue(new Error("Unexpected token '<'"))
    const result = await start()
    expect(result?.provide?.powersync).toBeNull()
    expect(state.report).toHaveBeenCalled()
    expect(sources().some(source => source === 'powersync:init' || source === 'powersync:recovery.attempt')).toBe(true)
  })

  it('initializes PowerSync even when the notice cannot be created', async () => {
    vi.resetModules()
    vi.doMock('~/composables/useUpdateNotice', () => ({
      useUpdateNotice: () => {
        throw new Error('no nuxt context')
      }
    }))
    try {
      expect((await start())?.provide?.powersync).toBeTruthy()
    } finally {
      vi.doMock('~/composables/useUpdateNotice', () => ({ useUpdateNotice: () => ({ report: state.report }) }))
    }
  })

  it('initializes PowerSync even when the collector cannot be created', async () => {
    vi.resetModules()
    vi.doMock('~/utils/clientErrorLog', () => ({
      useClientErrorLog: () => {
        throw new Error('runtime config unavailable')
      }
    }))
    try {
      const result = await start()
      expect(result?.provide?.powersync).toBeTruthy()
      expect(() => logger().log({ level: 50, message: 'Sync error', error: new Error('HTTP 503') })).not.toThrow()
    } finally {
      vi.doUnmock('~/utils/clientErrorLog')
    }
  })

  it('does not record anything for a healthy startup', async () => {
    await start()
    state.listeners[0]?.statusChanged?.(status({}))
    logger().log({ level: 30, message: 'sync connected' })
    expect(state.capture).not.toHaveBeenCalled()
  })

})
