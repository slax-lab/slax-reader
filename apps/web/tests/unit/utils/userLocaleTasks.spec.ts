import { AccountLocaleUnauthorizedError } from '~~/app/utils/accountLocaleRequest'
import { UserLocaleTasks } from '~~/app/utils/userLocaleTasks'

import { makeUser } from '~~/tests/fixtures/user'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const token = (id: string, seq = 1) => `x.${btoa(JSON.stringify({ id, seq }))}.x`
const deferred = <T>() => {
  let resolve!: (v: T) => void, reject!: (e: unknown) => void
  const promise = new Promise<T>((a, b) => {
    resolve = a
    reject = b
  })
  return { promise, resolve, reject }
}
const fixture = () => {
  let current = token('A'),
    display = 'en'
  const store = { user: makeUser({ lang: 'en' }), locale: 'en', confirmedAccountLocale: null as { accountKey: string; locale: 'en' | 'zh' } | null }
  const api = { saveLanguage: vi.fn(async () => {}), readUser: vi.fn(async () => ({ ...makeUser(), userId: 'A' })), refreshToken: vi.fn(async () => token('A', 2)) }
  const notify = vi.fn(),
    expire = vi.fn(async () => {})
  const apply = vi.fn(async (locale: string) => {
    display = locale
  })
  const tasks = new UserLocaleTasks(store, {
    api: api as never,
    getToken: () => current,
    setToken: t => {
      current = t
    },
    apply,
    notify,
    expire
  })
  return {
    tasks,
    store,
    api,
    notify,
    expire,
    apply,
    getToken: () => current,
    setToken: (t: string) => {
      current = t
    },
    display: () => display
  }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
it('serializes selections using the rotated token and notifies before token refresh', async () => {
  const f = fixture(),
    pending = deferred<string>()
  f.api.refreshToken.mockImplementationOnce(() => pending.promise)
  const a = f.tasks.save('zh'),
    b = f.tasks.save('en')
  await vi.advanceTimersByTimeAsync(0)
  expect(f.store.user.lang).toBe('zh')
  expect(f.notify).toHaveBeenCalledTimes(1)
  pending.resolve(token('A', 2))
  await Promise.all([a, b])
  expect(f.api.saveLanguage.mock.calls).toEqual([
    [token('A'), 'zh'],
    [token('A', 2), 'en']
  ])
  expect(f.store.locale).toBe('en')
  expect(f.notify).toHaveBeenCalledTimes(2)
})
it('keeps confirmed locale when an offline copy lags after a successful save', async () => {
  const f = fixture()
  await f.tasks.save('zh')
  await f.tasks.restore({ ...makeUser(), userId: 'A', lang: 'en' } as never, f.tasks.capture())
  expect(f.store.user.lang).toBe('zh')
  expect(f.store.locale).toBe('zh')
})
it('does not clear a new account on an old unauthorized response', async () => {
  const f = fixture(),
    pending = deferred<void>()
  f.api.saveLanguage.mockImplementationOnce(() => pending.promise)
  const saving = f.tasks.save('zh').catch(e => e)
  await vi.advanceTimersByTimeAsync(0)
  f.setToken(token('B'))
  pending.reject(new AccountLocaleUnauthorizedError())
  await saving
  expect(f.expire).not.toHaveBeenCalled()
  expect(f.notify).not.toHaveBeenCalled()
})
it('applies the newest target after an older language load finishes', async () => {
  const f = fixture(),
    pending = deferred<void>()
  f.apply.mockImplementationOnce(() => pending.promise)
  const old = f.tasks.local('en')
  await vi.advanceTimersByTimeAsync(0)
  const newer = f.tasks.local('zh')
  pending.resolve()
  await Promise.all([old, newer])
  expect(f.display()).toBe('zh')
  expect(f.store.locale).toBe('zh')
})
it('does not confirm display-only native preferences', async () => {
  const f = fixture()
  await f.tasks.local('zh', true)
  expect(f.display()).toBe('zh')
  expect(f.store.locale).toBe('en')
  expect(f.store.confirmedAccountLocale).toBeNull()
})
it('releases the queue after auxiliary refresh timeout and rejects late cookie writes', async () => {
  const f = fixture(),
    pending = deferred<string>()
  f.api.refreshToken.mockImplementationOnce(() => pending.promise)
  const first = f.tasks.save('zh')
  await vi.advanceTimersByTimeAsync(5000)
  await first
  const after = f.getToken()
  pending.resolve(token('A', 99))
  await vi.advanceTimersByTimeAsync(0)
  expect(f.getToken()).toBe(after)
  await f.tasks.save('en')
  expect(f.store.locale).toBe('en')
})

it.each([false, true])('keeps initial language application when token refresh starts in the same tick (displayOnly=%s)', async displayOnly => {
  const f = fixture()
  const applying = f.tasks.local('zh', displayOnly)
  await Promise.all([applying, f.tasks.refreshToken()])
  expect(f.display()).toBe('zh')
  expect(f.store.locale).toBe(displayOnly ? 'en' : 'zh')
})

it('discards an older profile read after a newer read confirms the account language', async () => {
  const f = fixture(), older = deferred<ReturnType<typeof makeUser>>(), newer = deferred<ReturnType<typeof makeUser>>()
  f.api.readUser.mockImplementationOnce(() => older.promise as never).mockImplementationOnce(() => newer.promise as never)
  const first = f.tasks.read().catch(error => error)
  const second = f.tasks.read()
  newer.resolve({ ...makeUser(), userId: 'A', lang: 'zh' } as never)
  await second
  older.resolve({ ...makeUser(), userId: 'A', lang: 'en' } as never)
  await first
  expect(f.store.locale).toBe('zh')
  expect(f.store.confirmedAccountLocale).toEqual({ accountKey: 'id:A', locale: 'zh' })
})

it('rejects an offline profile from a read superseded by a newer profile request', async () => {
  const f = fixture(), pending = deferred<ReturnType<typeof makeUser>>()
  f.api.readUser.mockImplementationOnce(() => pending.promise as never)
  const first = f.tasks.read().catch(error => error), ticket = f.tasks.capture()
  f.api.readUser.mockResolvedValueOnce({ ...makeUser(), userId: 'A', lang: 'zh' } as never)
  await f.tasks.read()
  pending.reject(new Error('offline'))
  await first
  await expect(f.tasks.restore({ ...makeUser(), userId: 'A', lang: 'en' } as never, ticket)).rejects.toThrow('superseded')
  expect(f.store.locale).toBe('zh')
})

it.each(['read', 'save', 'refreshToken'] as const)('expires the current expired cookie during %s', async operation => {
  const f = fixture()
  f.setToken(`x.${btoa(JSON.stringify({ id: 'A', exp: 1 }))}.x`)
  if (operation === 'save') await expect(f.tasks.save('zh')).rejects.toBeInstanceOf(AccountLocaleUnauthorizedError)
  else if (operation === 'read') await expect(f.tasks.read()).rejects.toBeInstanceOf(AccountLocaleUnauthorizedError)
  else await f.tasks.refreshToken()
  expect(f.expire).toHaveBeenCalledOnce()
})

it.each(['not-a-jwt', token('B'), `x.${btoa(JSON.stringify({ id: 'A', exp: 1 }))}.x`])('retains the current session when refresh returns an invalid or unrelated token: %s', async replacement => {
  const f = fixture(), original = f.getToken()
  f.api.refreshToken.mockResolvedValueOnce(replacement)
  await f.tasks.refreshToken()
  expect(f.getToken()).toBe(original)
  expect(f.expire).not.toHaveBeenCalled()
})

it('does not expire a replacement session when an expired-token save was queued', async () => {
  const f = fixture()
  f.setToken(`x.${btoa(JSON.stringify({ id: 'A', exp: 1 }))}.x`)
  const saving = f.tasks.save('zh').catch(error => error)
  f.setToken(token('B'))
  await saving
  expect(f.getToken()).toBe(token('B'))
  expect(f.expire).not.toHaveBeenCalled()
})

it('retries profile reads after same-account token rotation and rejects the obsolete offline result', async () => {
  const f = fixture(), pending = deferred<ReturnType<typeof makeUser>>()
  await f.tasks.local('zh')
  f.api.readUser.mockImplementationOnce(() => pending.promise as never)
  const reading = f.tasks.read().catch(error => error), ticket = f.tasks.capture()
  f.setToken(token('A', 2))
  f.api.readUser.mockResolvedValueOnce({ ...makeUser(), userId: 'A', lang: 'zh' } as never)
  pending.resolve({ ...makeUser(), userId: 'A', lang: 'en' } as never)
  await reading
  expect(f.api.readUser).toHaveBeenLastCalledWith(token('A', 2))
  expect(f.store.locale).toBe('zh')
  await expect(f.tasks.restore({ ...makeUser(), userId: 'A', lang: 'en' } as never, ticket)).rejects.toThrow('superseded')
})

it('loads the account profile when startup token refresh finishes first', async () => {
  const f = fixture(), pending = deferred<ReturnType<typeof makeUser>>()
  f.store.user = null as never
  f.api.readUser.mockImplementationOnce(() => pending.promise as never).mockResolvedValueOnce({ ...makeUser(), userId: 'A', lang: 'zh' } as never)
  const reading = f.tasks.read().catch(error => error)
  await f.tasks.refreshToken()
  pending.resolve({ ...makeUser(), userId: 'A', lang: 'en' } as never)
  await reading
  expect(f.store.user).toMatchObject({ userId: 'A', lang: 'zh' })
  expect(f.store.locale).toBe('zh')
  expect(f.api.readUser).toHaveBeenCalledTimes(2)
})

it('bounds profile recovery when the token keeps rotating', async () => {
  const f = fixture()
  let calls = 0
  f.api.readUser.mockImplementation(async () => {
    f.setToken(token('A', ++calls + 1))
    return { ...makeUser(), userId: 'A', lang: 'zh' } as never
  })
  await expect(f.tasks.read()).rejects.toThrow('superseded')
  expect(f.api.readUser).toHaveBeenCalledTimes(2)
  expect(f.store.locale).toBe('en')
})

it('expires the current token when it becomes expired during an unauthorized refresh', async () => {
  const f = fixture(), pending = deferred<string>()
  f.setToken(`x.${btoa(JSON.stringify({ id: 'A', exp: Math.floor(Date.now() / 1000) + 1 }))}.x`)
  f.api.refreshToken.mockImplementationOnce(() => pending.promise)
  const refreshing = f.tasks.refreshToken()
  await vi.advanceTimersByTimeAsync(2000)
  pending.reject(new AccountLocaleUnauthorizedError())
  await refreshing
  expect(f.expire).toHaveBeenCalledOnce()
})
