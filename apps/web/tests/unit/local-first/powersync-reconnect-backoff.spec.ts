// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { POWER_SYNC_DATABASE_GENERATION, POWER_SYNC_LOCAL_DATA_VERSION } from '~/local-first/version'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  connect: vi.fn(),
  disconnect: vi.fn(),
  construct: vi.fn(),
  capture: vi.fn(),
  events: vi.fn(),
  listeners: [] as Array<{ statusChanged?: (status: unknown) => void }>,
  afterEach: vi.fn(),
  connectorOptions: [] as unknown[],
  token: '' as string | undefined
}))

const token = (id: string) => `header.${btoa(JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`

mockNuxtImport('useAppConfig', () => () => ({ lcp: { anonymousPublicStartup: false } }))
mockNuxtImport('useRuntimeConfig', () => () => ({ public: { DWEB_API_BASE_URL: 'https://api.test', COOKIE_TOKEN_NAME: 'token' } }))
mockNuxtImport('useState', () => (_key: string, init: () => unknown) => ({ value: init() }))
mockNuxtImport('useRouter', () => () => ({ afterEach: state.afterEach, beforeEach: vi.fn() }))
mockNuxtImport('useCookie', () => () => ({ value: undefined }))
mockNuxtImport('watch', () => vi.fn())
vi.mock('~/utils/request', () => ({ getUserToken: () => state.token, getClientEventHeaders: () => ({}) }))
vi.mock('~/utils/clientErrorLog', () => ({
  useClientErrorLog: () => ({
    enabled: true,
    capture: state.capture,
    telemetry: (event_name: string, properties: Record<string, unknown>) => state.events({ event_name, properties }),
    flush: async () => {}
  })
}))
vi.mock('~/composables/useUpdateNotice', () => ({ useUpdateNotice: () => ({ report: vi.fn() }) }))
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
  createConsoleLogger: () => ({ log: vi.fn() }),
  PowerSyncDatabase: class {
    constructor(options: unknown) {
      state.construct(options)
    }
    init = vi.fn().mockResolvedValue(undefined)
    connect = state.connect
    disconnect = state.disconnect
    disconnectAndClear = vi.fn().mockResolvedValue(undefined)
    close = vi.fn().mockResolvedValue(undefined)
    getCrudBatch = vi.fn().mockResolvedValue(null)
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

// Each test loads a fresh plugin; remove the window/document listeners it adds so earlier instances do not react.
const added: Array<[EventTarget, string, EventListenerOrEventListenerObject]> = []
const track = (target: EventTarget) => {
  const original = target.addEventListener.bind(target)
  vi.spyOn(target, 'addEventListener').mockImplementation((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
    added.push([target, type, listener])
    original(type, listener, options)
  })
}
const start = async () => {
  vi.resetModules()
  await (await import('~~/app/plugins/powersync.client')).default({ vueApp: { use: vi.fn() }, runWithContext: (fn: () => unknown) => fn() } as never)
  await vi.advanceTimersByTimeAsync(0)
}
const logger = () => (state.construct.mock.calls[0]![0] as { logger: { log: (record: { level: number; message: string; error?: unknown }) => void } }).logger
// A stream failure as the SDK logs it; each call uses a new message so the duplicate window does not merge them.
let failures = 0
const failStream = () => logger().log({ level: 50, message: 'Sync error', error: new Error(`HTTP Service Unavailable ${++failures}`) })
const connectedStatus = () => state.listeners.forEach(listener => listener.statusChanged?.({ connected: true, connecting: false, dataFlowStatus: {} }))
const setOnline = (online: boolean) => {
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => online })
  window.dispatchEvent(new Event(online ? 'online' : 'offline'))
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] })
  vi.clearAllMocks()
  state.listeners = []
  state.connectorOptions = []
  state.token = token('user-a')
  state.connect.mockResolvedValue(undefined)
  state.disconnect.mockResolvedValue(undefined)
  failures = 0
  vi.stubGlobal('SharedWorker', undefined)
  Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => true })
  window.history.replaceState(null, '', '/bookmarks')
  localStorage.clear()
  localStorage.setItem(`slax:powersync:${POWER_SYNC_DATABASE_GENERATION}:dataVersion`, String(POWER_SYNC_LOCAL_DATA_VERSION))
  for (const level of ['info', 'warn', 'error'] as const) vi.spyOn(console, level).mockImplementation(() => {})
  track(window)
  track(document)
})

afterEach(() => {
  for (const [target, type, listener] of added.splice(0)) target.removeEventListener(type, listener)
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

describe('PowerSync reconnect backoff', () => {
  it('waits 5, 10, 20, 40, 80 and then 120 seconds between attempts after consecutive stream failures', async () => {
    await start()
    expect(state.connect).toHaveBeenCalledTimes(1)
    const waits: number[] = []
    for (const expected of [5, 10, 20, 40, 80, 120, 120]) {
      failStream()
      expect(state.disconnect).toHaveBeenCalled()
      const before = state.connect.mock.calls.length
      await vi.advanceTimersByTimeAsync(expected * 1000 - 1)
      expect(state.connect.mock.calls.length).toBe(before)
      await vi.advanceTimersByTimeAsync(1)
      expect(state.connect.mock.calls.length).toBe(before + 1)
      waits.push(expected)
    }
    expect(waits).toEqual([5, 10, 20, 40, 80, 120, 120])
  })

  it('still retries when the first attempt fails before connect() resolves', async () => {
    // The SDK resolves connect() only after its first attempt settles, so the failure log arrives first.
    state.connect.mockImplementationOnce(async () => {
      failStream()
    })
    await start()
    expect(state.connect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(4999)
    expect(state.connect).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(state.connect).toHaveBeenCalledTimes(2)
  })

  it('does not let a route change bypass a pending backoff retry', async () => {
    await start()
    failStream()
    const before = state.connect.mock.calls.length
    const reconcile = state.afterEach.mock.calls.at(-1)![0] as () => void
    reconcile()
    await vi.advanceTimersByTimeAsync(4999)
    expect(state.connect.mock.calls.length).toBe(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(state.connect.mock.calls.length).toBe(before + 1)
  })

  it('counts one episode that logs both stream messages once, so the first retry waits 5 seconds', async () => {
    await start()
    const error = new Error('HTTP Service Unavailable: upstream')
    logger().log({ level: 50, message: 'Could not POST streaming to /sync/stream - 503 - Service Unavailable: upstream', error })
    logger().log({ level: 50, message: 'Sync error', error })
    expect(state.capture).toHaveBeenCalledTimes(1)
    const before = state.connect.mock.calls.length
    await vi.advanceTimersByTimeAsync(4999)
    expect(state.connect.mock.calls.length).toBe(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(state.connect.mock.calls.length).toBe(before + 1)
  })

  it('records a failed token request once as a token failure, and the following SDK sync error only backs off', async () => {
    await start()
    const options = state.connectorOptions.at(-1) as { onCredentialsFailed?: (error: unknown) => void }
    // As in shared-worker mode, the SDK's logged error has lost the connector's tag.
    options.onCredentialsFailed?.(Object.assign(new Error('[powersync] sync token failed: 503'), { phase: 'token', ray: 'tok-1' }))
    logger().log({ level: 50, message: 'Sync error', error: new Error('[powersync] sync token failed: 503') })
    expect(state.capture).toHaveBeenCalledTimes(1)
    expect(state.capture.mock.calls[0]![2]).toMatchObject({ phase: 'token', ray: 'tok-1' })
    const phases = state.events.mock.calls.map(([event]) => (event as { properties: { phase?: string; outcome?: string } }).properties)
    expect(phases.filter(properties => properties.outcome === 'failure')).toEqual([expect.objectContaining({ phase: 'token' })])
    const before = state.connect.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(state.connect.mock.calls.length).toBe(before + 1)
  })

  it('labels a failure before any stream connected as connect, and later ones as stream', async () => {
    await start()
    failStream()
    // As in the SDK, a successful attempt reports the connected status before connect() resolves.
    state.connect.mockImplementation(async () => connectedStatus())
    await vi.advanceTimersByTimeAsync(5000)
    failStream()
    const phases = state.capture.mock.calls.map(call => (call[2] as { phase?: string }).phase)
    expect(phases).toEqual(['connect', 'stream'])
  })

  it('does not count a download that ends without advancing the sync time as a stream success', async () => {
    await start()
    const at = new Date('2026-11-25T00:00:00Z').getTime()
    const emit = (downloading: boolean) =>
      state.listeners.forEach(listener => listener.statusChanged?.({ connected: true, connecting: false, downloading, lastSyncedAt: new Date(at), dataFlowStatus: {} }))
    emit(false)
    emit(true)
    emit(false)
    const successes = state.events.mock.calls
      .map(([event]) => (event as { properties: { phase?: string; outcome?: string } }).properties)
      .filter(properties => properties.phase === 'stream' && properties.outcome === 'success')
    expect(successes).toEqual([])
  })

  it('records other SDK error logs without treating them as stream failures', async () => {
    await start()
    const before = state.connect.mock.calls.length
    logger().log({ level: 50, message: 'Error in watch', error: new Error('query failed') })
    logger().log({ level: 50, message: 'Error in crud upload loop', error: new Error('upload loop') })
    expect(state.disconnect).not.toHaveBeenCalled()
    expect(state.capture).toHaveBeenCalledTimes(2)
    expect(state.capture.mock.calls.every(call => (call[2] as { phase?: string }).phase === undefined)).toBe(true)
    await vi.advanceTimersByTimeAsync(130_000)
    expect(state.connect.mock.calls.length).toBe(before)
  })

  it('labels the first connection initial and later ones reconnections', async () => {
    // As in the SDK, the connected status arrives before connect() resolves.
    state.connect.mockImplementation(async () => connectedStatus())
    await start()
    failStream()
    await vi.advanceTimersByTimeAsync(5000)
    const kinds = state.events.mock.calls
      .map(([event]) => event as { event_name: string; properties: { phase?: string; outcome?: string; connection_kind?: string } })
      .filter(event => event.event_name === 'powersync_phase' && event.properties.phase === 'connect' && event.properties.outcome === 'success')
      .map(event => event.properties.connection_kind)
    expect(kinds).toEqual(['initial', 'reconnect'])
  })

  describe('powersync_connection_lost', () => {
    const lost = () => state.events.mock.calls.filter(([event]) => (event as { event_name: string }).event_name === 'powersync_connection_lost').length
    const connectSuccesses = () => state.events.mock.calls.filter(([event]) => { const e = event as { event_name: string; properties: { phase?: string; outcome?: string } }; return e.event_name === 'powersync_phase' && e.properties.phase === 'connect' && e.properties.outcome === 'success' }).length
    const disconnectedStatus = () => state.listeners.forEach(listener => listener.statusChanged?.({ connected: false, connecting: false, dataFlowStatus: {} }))
    const setHidden = (hidden: boolean) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') })
    afterEach(() => setHidden(false))

    it('is recorded once when an established stream drops without an SDK error', async () => {
      state.connect.mockImplementation(async () => connectedStatus())
      await start()
      disconnectedStatus()
      disconnectedStatus()
      expect(lost()).toBe(1)
    })

    it('is not recorded when connect() returned but the stream never came up', async () => {
      // connect() resolves after its first attempt; a credential failure inside the SDK loop then ends it
      // without any connected status, as seen on iOS during the auth redirect.
      await start()
      disconnectedStatus()
      expect(lost()).toBe(0)
    })

    it('is not recorded for a stream failure, which is already counted as one', async () => {
      state.connect.mockImplementation(async () => connectedStatus())
      await start()
      failStream()
      disconnectedStatus()
      expect(lost()).toBe(0)
    })

    it('is recorded when the stream connects after connect() already resolved, and that stream drops', async () => {
      await start()
      connectedStatus()
      disconnectedStatus()
      expect(lost()).toBe(1)
      expect(connectSuccesses()).toBe(1)
    })

    it('is not recorded when the browser goes offline', async () => {
      state.connect.mockImplementation(async () => connectedStatus())
      await start()
      setOnline(false)
      disconnectedStatus()
      expect(lost()).toBe(0)
    })

    it('is not recorded when the page is hidden', async () => {
      state.connect.mockImplementation(async () => connectedStatus())
      await start()
      setHidden(true)
      disconnectedStatus()
      expect(lost()).toBe(0)
    })

    it('is not recorded when the stream drops while navigator reports offline before its event fires', async () => {
      state.connect.mockImplementation(async () => connectedStatus())
      await start()
      Object.defineProperty(navigator, 'onLine', { configurable: true, get: () => false })
      disconnectedStatus()
      expect(lost()).toBe(0)
    })
  })

  it('resets to 5 seconds after a successful connection', async () => {
    await start()
    failStream()
    await vi.advanceTimersByTimeAsync(5000)
    failStream()
    await vi.advanceTimersByTimeAsync(10000)
    connectedStatus()
    failStream()
    const before = state.connect.mock.calls.length
    await vi.advanceTimersByTimeAsync(4999)
    expect(state.connect.mock.calls.length).toBe(before)
    await vi.advanceTimersByTimeAsync(1)
    expect(state.connect.mock.calls.length).toBe(before + 1)
  })

  it('keeps a single pending retry when several failures arrive before it fires', async () => {
    await start()
    failStream()
    failStream()
    failStream()
    const before = state.connect.mock.calls.length
    await vi.advanceTimersByTimeAsync(130_000)
    expect(state.connect.mock.calls.length).toBe(before + 1)
  })

  it('pauses while offline and reconnects at once when the network returns', async () => {
    await start()
    failStream()
    setOnline(false)
    const paused = state.connect.mock.calls.length
    await vi.advanceTimersByTimeAsync(300_000)
    expect(state.connect.mock.calls.length).toBe(paused)
    setOnline(true)
    await vi.advanceTimersByTimeAsync(0)
    expect(state.connect.mock.calls.length).toBe(paused + 1)
  })

  it('reconnects at once when a disconnected page returns to the foreground', async () => {
    await start()
    failStream()
    const before = state.connect.mock.calls.length
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await vi.advanceTimersByTimeAsync(0)
    expect(state.connect.mock.calls.length).toBe(before + 1)
    await vi.advanceTimersByTimeAsync(130_000)
    expect(state.connect.mock.calls.length).toBe(before + 1)
  })

  it('does not schedule a retry after the session ends', async () => {
    await start()
    state.token = undefined
    failStream()
    const before = state.connect.mock.calls.length
    await vi.advanceTimersByTimeAsync(300_000)
    expect(state.connect.mock.calls.length).toBe(before)
    expect(state.events).not.toHaveBeenCalled()
  })
})
