import { LocaleUnauthorizedError } from '../src/entrypoints/background/localeApi'
import { LocaleService, type LocaleSession } from '../src/entrypoints/background/localeService'
import type { ExtensionLocaleSnapshot } from '@commons/frontend-types/locale'
import type { UserInfo } from '@slax-reader/contracts/interface'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
vi.mock('../src/utils/session', () => ({ getExtensionEventHeaders: async () => ({}) }))
const deferred = <T>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const user = (id: string, lang: string) => ({ userId: id, email: `${id}@test`, lang }) as unknown as UserInfo
const session = (id: string, token = id): LocaleSession => ({ token, accountKey: id, identityKeys: new Set([id, `${id}@test`]) })
const fixture = (initial: ExtensionLocaleSnapshot | null = null) => {
  let current: LocaleSession | null = session('A'),
    stored = initial
  const read = vi.fn<(token: string, signal: AbortSignal) => Promise<UserInfo>>(async () => user('A', 'zh')),
    expire = vi.fn(async () => {})
  const applied: ExtensionLocaleSnapshot[] = []
  const service = new LocaleService({
    readSession: async () => current,
    readStored: async () => stored,
    writeStored: async s => {
      stored = s
    },
    readUserInfo: read,
    expireSession: expire,
    onSnapshot: s => applied.push(s),
    browserLocale: () => 'en-US',
    now: () => Date.now()
  })
  return {
    service,
    read,
    expire,
    applied,
    setSession: (s: LocaleSession | null) => {
      current = s
    },
    stored: () => stored,
    setStored: (s: ExtensionLocaleSnapshot | null) => {
      stored = s
    }
  }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
it('keeps same-account cache and generation across restart, makes no anonymous request', async () => {
  const f = fixture({ version: 1, generation: 'old', accountKey: 'A', locale: 'zh', source: 'account', revision: 20, verifiedAt: Date.now() })
  expect(await f.service.initialize()).toMatchObject({ generation: 'old', locale: 'zh', revision: 20 })
  f.setSession(null)
  await f.service.invalidateSession(null)
  await f.service.refresh('session')
  expect(f.read).not.toHaveBeenCalled()
  expect(f.stored()).toMatchObject({ accountKey: null, locale: 'en' })
  f.service.dispose()
})
it('rejects an old account response and settles the new account', async () => {
  const f = fixture(),
    pending = deferred<UserInfo>()
  f.read.mockImplementationOnce(() => pending.promise)
  await f.service.initialize()
  const a = f.service.refresh('user-save')
  await vi.advanceTimersByTimeAsync(0)
  f.setSession(session('B'))
  await f.service.invalidateSession('B')
  f.read.mockResolvedValue(user('B', 'en'))
  const b = f.service.refresh('session')
  pending.resolve(user('A', 'zh'))
  await vi.advanceTimersByTimeAsync(1000)
  await Promise.all([a, b])
  expect(f.stored()).toMatchObject({ accountKey: 'B', locale: 'en' })
  f.service.dispose()
})
it('coalesces invalidations in flight into a trailing authoritative read', async () => {
  const f = fixture(),
    pending = deferred<UserInfo>()
  f.read.mockImplementationOnce(() => pending.promise).mockResolvedValue(user('A', 'en'))
  const a = f.service.refresh('user-save')
  await vi.advanceTimersByTimeAsync(0)
  const b = f.service.refresh('user-save')
  f.service.refresh('user-save')
  pending.resolve(user('A', 'zh'))
  await vi.advanceTimersByTimeAsync(1000)
  await Promise.all([a, b])
  expect(f.read).toHaveBeenCalledTimes(2)
  expect(f.stored()).toMatchObject({ locale: 'en', source: 'account' })
  f.service.dispose()
})
it('does not expire a rotated token after an old 401', async () => {
  const f = fixture(),
    pending = deferred<UserInfo>()
  f.read.mockImplementationOnce(() => pending.promise)
  const run = f.service.refresh('user-save')
  await vi.advanceTimersByTimeAsync(0)
  f.setSession(session('A', 'new'))
  pending.reject(new LocaleUnauthorizedError())
  await run
  expect(f.expire).not.toHaveBeenCalled()
  f.service.dispose()
})
it('aborts after five seconds and backs off automatic retries', async () => {
  const f = fixture()
  let signal: AbortSignal | undefined
  f.read.mockImplementation((_token, s) => {
    signal = s
    return new Promise(() => {})
  })
  const run = f.service.refresh('open')
  await vi.advanceTimersByTimeAsync(5000)
  await run
  expect(signal?.aborted).toBe(true)
  await f.service.refresh('open')
  expect(f.read).toHaveBeenCalledTimes(1)
  f.service.dispose()
})
it('does not overwrite a valid cache with an unsupported language', async () => {
  const f = fixture({ version: 1, generation: 'g', accountKey: 'A', locale: 'zh', source: 'account', revision: 2, verifiedAt: 0 })
  f.read.mockResolvedValue(user('A', 'fr'))
  await f.service.refresh('user-save')
  expect(f.stored()).toMatchObject({ locale: 'zh', revision: 2 })
  f.service.dispose()
})

it('creates a new cache generation after deletion even in a surviving worker', async () => {
  const f = fixture({ version: 1, generation: 'old', accountKey: 'A', locale: 'zh', source: 'account', revision: 20, verifiedAt: Date.now() })
  await f.service.initialize()
  f.setStored(null)
  const snapshot = await f.service.initialize()
  expect(snapshot.generation).not.toBe('old')
  expect(snapshot.revision).toBe(1)
  f.service.dispose()
})
