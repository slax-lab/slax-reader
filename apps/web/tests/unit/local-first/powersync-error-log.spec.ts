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
  afterEach: vi.fn()
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
    registerListener = (listener: { statusChanged?: (status: unknown) => void }) => {
      state.listeners.push(listener)
      return () => {}
    }
    connected = false
    connecting = false
  }
}))

const start = async () => (await import('~~/app/plugins/powersync.client')).default({ vueApp: { use: vi.fn() } } as never)
const sources = () => state.capture.mock.calls.map(([kind, , props]) => `${kind}:${(props as { source: string }).source}`)
const status = (dataFlowStatus: Record<string, unknown>) => ({ connected: false, dataFlowStatus })
const logger = () => (state.construct.mock.calls[0][0] as { logger: { log: (record: { level: number; message: string; error?: unknown }) => void } }).logger

beforeEach(() => {
  vi.clearAllMocks()
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
      const counted = state.capture.mock.calls.map(([, , , options]) => (options as { countOccurrence: boolean }).countOccurrence)
      expect(counted).toEqual([true, false, true])
      // Distinct non-Error payloads inside the window are separate failures.
      logger().log({ level: 50, message: 'worker message A', error: 'string payload A' })
      logger().log({ level: 50, message: 'worker message B', error: { reason: 'payload B' } })
      const tail = state.capture.mock.calls.slice(-2).map(([, , , options]) => (options as { countOccurrence: boolean }).countOccurrence)
      expect(tail).toEqual([true, true])
    } finally {
      vi.useRealTimers()
    }
  })

  it('records each changed download and upload error once, including cloned shared-worker errors', async () => {
    await start()
    const [listener] = state.listeners
    const upload = new Error('[powersync] upload changes failed: 500')
    listener.statusChanged?.(status({ uploadError: upload }))
    listener.statusChanged?.(status({ uploadError: Object.assign(new Error(upload.message)) }))
    listener.statusChanged?.(status({ downloadError: new TypeError('network error') }))
    listener.statusChanged?.(status({ downloadError: new TypeError('network error') }))
    listener.statusChanged?.(status({}))
    listener.statusChanged?.(status({ downloadError: new TypeError('network error') }))
    expect(sources()).toEqual(['powersync:status.uploadError', 'powersync:status.downloadError', 'powersync:status.downloadError'])
    // Status observations tag failures the SDK logger or connector already count.
    expect(state.capture.mock.calls.every(([, , , options]) => (options as { countOccurrence?: boolean }).countOccurrence === false)).toBe(true)
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
    expect(state.capture.mock.calls[0][3]).toEqual({ countOccurrence: true })
    expect(console.error).toHaveBeenCalledWith('[powersync] uploadData failed:', failure)
  })

  it('keeps the SDK logger, status listener, and connector working when capture throws', async () => {
    state.capture.mockImplementation(() => {
      throw new Error('collector broken')
    })
    const result = await start()
    expect(result?.provide?.powersync).toBeTruthy()
    // The SDK calls the logger inside its retry loop; it must still print and must not throw.
    expect(() => logger().log({ level: 50, message: 'Sync error', error: new Error('HTTP 503') })).not.toThrow()
    expect(state.sdkConsole).toHaveBeenCalledWith(expect.objectContaining({ message: 'Sync error' }))
    expect(() => state.listeners[0].statusChanged?.(status({ downloadError: new Error('HTTP 503'), uploadError: new Error('500') }))).not.toThrow()
    const failure = new Error('[powersync] upload changes failed: 500')
    expect(() => state.connectorOptions[0].onError?.(failure)).not.toThrow()
    expect(console.error).toHaveBeenCalledWith('[powersync] uploadData failed:', failure)
    expect(state.capture).toHaveBeenCalled()
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
    state.listeners[0].statusChanged?.(status({}))
    expect(state.capture).not.toHaveBeenCalled()
  })
})
