// @vitest-environment happy-dom
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { POWER_SYNC_DATABASE_GENERATION, POWER_SYNC_LOCAL_DATA_VERSION } from '~/local-first/version'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Guard = (to: { path: string; fullPath: string }, from: { path: string; fullPath: string }) => unknown

const state = vi.hoisted(() => ({
  token: vi.fn(),
  init: vi.fn(),
  connect: vi.fn(),
  clear: vi.fn(),
  close: vi.fn(),
  use: vi.fn(),
  navigate: vi.fn(),
  guards: [] as Guard[],
  afterEach: vi.fn(),
  owner: { value: null as string | null }
}))
mockNuxtImport('useAppConfig', () => () => ({ lcp: { anonymousPublicStartup: true } }))
mockNuxtImport('useRuntimeConfig', () => () => ({ public: { DWEB_API_BASE_URL: 'https://fixtures.invalid', COOKIE_TOKEN_NAME: 'synthetic_token' } }))
const states = new Map<string, { value: unknown }>()
mockNuxtImport('useState', () => (key: string) => {
  if (key === 'powersync-owner') return state.owner
  if (!states.has(key)) states.set(key, { value: null })
  return states.get(key)
})
mockNuxtImport('useRouter', () => () => ({ afterEach: state.afterEach, beforeEach: (guard: Guard) => { state.guards.push(guard); return () => {} } }))
mockNuxtImport('useCookie', () => () => ({ value: undefined }))
mockNuxtImport('navigateTo', () => state.navigate)
vi.mock('~/utils/request', () => ({ getUserToken: state.token, getClientEventHeaders: () => ({}) }))
vi.mock('~/local-first/schema', () => ({ AppSchema: {} }))
vi.mock('~/local-first/connector', () => ({ createConnector: () => ({}), clearSyncCredsCache: vi.fn(), fetchSyncCredentials: vi.fn() }))
vi.mock('@powersync/vue', () => ({ createPowerSyncPlugin: () => ({}) }))
vi.mock('@powersync/web', () => ({
  SyncStreamConnectionMethod: { HTTP: 'http' },
  LogLevels: { trace: 10, debug: 20, info: 30, warn: 40, error: 50 },
  createConsoleLogger: () => ({ log: () => {} }),
  PowerSyncDatabase: class {
    init = state.init
    connect = state.connect
    disconnectAndClear = state.clear
    onChangeWithCallback = () => () => {}
    resolveTables = async () => []
    registerListener = () => () => {}
    close = state.close
    getCrudBatch = async () => null
    connected = false
    connecting = false
  }
}))

const token = (id: string) => `header.${btoa(JSON.stringify({ id, exp: 9999999999 }))}.signature`
const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(settle => { resolve = settle })
  return { promise, resolve }
}
const app = { vueApp: { use: state.use }, runWithContext: (callback: () => unknown) => callback() }
const start = async () => (await import('~~/app/plugins/powersync.client')).default(app as never)
const route = (fullPath: string) => ({ path: new URL(fullPath, 'https://r.test').pathname, fullPath })

beforeEach(() => {
  vi.clearAllMocks()
  states.clear()
  state.guards = []
  state.owner.value = null
  state.token.mockReset().mockReturnValue(token('user-a'))
  state.init.mockReset().mockResolvedValue(undefined)
  state.connect.mockResolvedValue(undefined)
  state.clear.mockResolvedValue(undefined)
  state.close.mockResolvedValue(undefined)
  state.navigate.mockReset().mockResolvedValue(false)
  localStorage.clear()
  localStorage.setItem('slax:powersync:lastUser', 'user-a')
  localStorage.setItem(`slax:powersync:${POWER_SYNC_DATABASE_GENERATION}:dataVersion`, String(POWER_SYNC_LOCAL_DATA_VERSION))
  window.history.replaceState(null, '', '/b/article')
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
})
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); localStorage.clear() })

describe('deferred local startup on reader documents', () => {
  it.each(['/b/article', '/user', '/collection/manage'])('returns before local startup finishes on %s', async path => {
    window.history.replaceState(null, '', path)
    const hold = deferred()
    state.init.mockImplementation(() => hold.promise)
    const result = await start()
    expect(result?.provide).toMatchObject({ powersync: null, powersyncDeferred: true, powersyncPublicBypass: false })
    expect(result?.provide?.powersyncReady.value).toBeNull()
    expect(state.use).not.toHaveBeenCalled()
    expect(state.owner.value).toBeNull()

    hold.resolve()
    const database = await result?.provide?.powersyncWhenReady()
    expect(database).not.toBeNull()
    expect(result?.provide?.powersyncReady.value).toBe(database)
    // Local queries become possible only after the ownership guard ran on this document.
    expect(state.owner.value).toBe('user-a')
    expect(state.use).toHaveBeenCalledOnce()
    // The setup-time value stays null so captured consumers keep their REST branch.
    expect(result?.provide?.powersync).toBeNull()
  })

  it('publishes no database when the account guard cannot verify ownership', async () => {
    state.token.mockReturnValue('not-a-jwt')
    const result = await start()
    await expect(result?.provide?.powersyncWhenReady()).resolves.toBeNull()
    expect(result?.provide?.powersyncReady.value).toBeNull()
    expect(state.owner.value).toBeNull()
    expect(state.use).not.toHaveBeenCalled()
    expect(state.close).toHaveBeenCalledOnce()
  })

  it('publishes no database when the data-version clear fails', async () => {
    localStorage.setItem(`slax:powersync:${POWER_SYNC_DATABASE_GENERATION}:dataVersion`, '0')
    state.clear.mockRejectedValue(new Error('database busy'))
    const result = await start()
    await expect(result?.provide?.powersyncWhenReady()).resolves.toBeNull()
    expect(state.use).not.toHaveBeenCalled()
    expect(localStorage.getItem(`slax:powersync:${POWER_SYNC_DATABASE_GENERATION}:dataVersion`)).toBe('0')
  })

  it('clears the previous account before publishing a database for a new account', async () => {
    state.token.mockReturnValue(token('user-b'))
    const result = await start()
    await result?.provide?.powersyncWhenReady()
    expect(state.clear).toHaveBeenCalledOnce()
    expect(state.owner.value).toBe('user-b')
  })

  it('publishes no database when initialization fails', async () => {
    state.init.mockRejectedValue(new Error('worker gone'))
    const result = await start()
    await expect(result?.provide?.powersyncWhenReady()).resolves.toBeNull()
    expect(state.use).not.toHaveBeenCalled()
  })

  it('publishes a timed-out instance after its background initialization and the startup checks pass', async () => {
    vi.useFakeTimers()
    const hold = deferred()
    state.init.mockImplementation(() => hold.promise)
    const result = await start()
    await vi.advanceTimersByTimeAsync(8_100)
    expect(result?.provide?.powersyncReady.value).toBeNull()
    expect(state.owner.value).toBeNull()
    expect(state.guards).toHaveLength(1)

    hold.resolve()
    await vi.advanceTimersByTimeAsync(1)
    const database = await result?.provide?.powersyncWhenReady()
    expect(database).not.toBeNull()
    expect(state.owner.value).toBe('user-a')
    expect(state.use).toHaveBeenCalledOnce()
    // The deferred document already has its exit guard; no second resume guard is added.
    expect(state.guards).toHaveLength(1)
  })

  it('publishes no database when a timed-out instance later fails', async () => {
    vi.useFakeTimers()
    let fail!: (error: Error) => void
    state.init.mockImplementation(() => new Promise<void>((_, reject) => { fail = reject }))
    const result = await start()
    await vi.advanceTimersByTimeAsync(8_100)
    fail(new Error('worker gone'))
    await vi.advanceTimersByTimeAsync(300)
    await expect(result?.provide?.powersyncWhenReady()).resolves.toBeNull()
    expect(state.use).not.toHaveBeenCalled()
    expect(state.owner.value).toBeNull()
  })

  it.each(['/bookmarks', '/', '/s/article', '/x/ext-bridge'])('keeps blocking startup on %s', async path => {
    window.history.replaceState(null, '', path)
    const result = await start()
    expect(result?.provide?.powersyncDeferred).toBe(false)
    expect(result?.provide?.powersync).not.toBeNull()
    expect(result?.provide?.powersyncReady.value).toBe(result?.provide?.powersync)
    expect(state.guards).toHaveLength(0)
  })

  it('does not defer inside an iframe', async () => {
    vi.spyOn(window, 'parent', 'get').mockReturnValue({ postMessage: vi.fn() } as unknown as Window)
    const result = await start()
    expect(result?.provide?.powersyncDeferred).toBe(false)
  })
})

describe('leaving a deferred reader document', () => {
  it('hands a non-reader destination to a new document after startup is ready', async () => {
    const result = await start()
    await result?.provide?.powersyncWhenReady()
    const guard = state.guards[0]!
    await expect(guard(route('/bookmarks?filter=inbox'), route('/b/article'))).resolves.toBe(false)
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/bookmarks?filter=inbox', { external: true })
  })

  it('keeps navigation among reader routes client-side', async () => {
    await start()
    const guard = state.guards[0]!
    await expect(guard(route('/b/other'), route('/b/article'))).resolves.toBeUndefined()
    await expect(guard(route('/user'), route('/b/article'))).resolves.toBeUndefined()
    await expect(guard(route('/b/article?highlight=1'), route('/b/article'))).resolves.toBeUndefined()
    expect(state.navigate).not.toHaveBeenCalled()
  })

  it('waits a bounded time for startup that has not finished', async () => {
    vi.useFakeTimers()
    state.init.mockImplementation(() => new Promise(() => {}))
    await start()
    const guard = state.guards[0]!
    const leaving = guard(route('/bookmarks'), route('/b/article')) as Promise<unknown>
    await vi.advanceTimersByTimeAsync(1_999)
    expect(state.navigate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    await expect(leaving).resolves.toBe(false)
    expect(state.navigate).toHaveBeenCalledExactlyOnceWith('/bookmarks', { external: true })
  })

  it('re-arms the guard when the document does not unload', async () => {
    vi.useFakeTimers()
    const result = await start()
    await result?.provide?.powersyncWhenReady()
    const guard = state.guards[0]!
    await expect(guard(route('/bookmarks'), route('/b/article'))).resolves.toBe(false)
    // The unload was suppressed: an immediate retry is still treated as the same exit.
    await expect(guard(route('/bookmarks'), route('/b/article'))).resolves.toBe(false)
    expect(state.navigate).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(3_000)
    const retry = guard(route('/bookmarks'), route('/b/article')) as Promise<unknown>
    await vi.advanceTimersByTimeAsync(2_000)
    await expect(retry).resolves.toBe(false)
    expect(state.navigate).toHaveBeenCalledTimes(2)
  })

  it('lets the navigation continue when the document load fails', async () => {
    state.navigate.mockRejectedValueOnce(new Error('blocked'))
    const result = await start()
    await result?.provide?.powersyncWhenReady()
    const guard = state.guards[0]!
    await expect(guard(route('/bookmarks'), route('/b/article'))).resolves.toBeUndefined()
    await expect(guard(route('/bookmarks'), route('/b/article'))).resolves.toBe(false)
  })

  it('ignores destinations that are not internal paths', async () => {
    await start()
    const guard = state.guards[0]!
    await expect(guard({ path: '//evil.example/x', fullPath: '//evil.example/x' }, route('/b/article'))).resolves.toBeUndefined()
    expect(state.navigate).not.toHaveBeenCalled()
  })
})
