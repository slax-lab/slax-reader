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
  token: '' as string | undefined
}))

const token = (id: string) => `header.${btoa(JSON.stringify({ id, exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`

mockNuxtImport('useAppConfig', () => () => ({ lcp: { anonymousPublicStartup: false } }))
mockNuxtImport('useRuntimeConfig', () => () => ({ public: { DWEB_API_BASE_URL: 'https://api.test', COOKIE_TOKEN_NAME: 'token' } }))
mockNuxtImport('useState', () => (_key: string, init: () => unknown) => ({ value: init() }))
mockNuxtImport('useRouter', () => () => ({ afterEach: vi.fn(), beforeEach: vi.fn() }))
mockNuxtImport('useCookie', () => () => ({ value: undefined }))
mockNuxtImport('watch', () => vi.fn())
vi.mock('~/utils/request', () => ({ getUserToken: () => state.token, getClientEventHeaders: () => ({}) }))
vi.mock('~/utils/analytics', () => ({ eventLog: state.events }))
vi.mock('~/utils/clientErrorLog', () => ({ useClientErrorLog: () => ({ enabled: true, capture: state.capture, flush: async () => {} }) }))
vi.mock('~/composables/useUpdateNotice', () => ({ useUpdateNotice: () => ({ report: vi.fn() }) }))
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
