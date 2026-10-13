import { expireLocaleSession } from '../src/entrypoints/background/localeSessionExpiry'
import { SessionService } from '../src/entrypoints/background/sessionService'
import { afterEach, expect, it, vi } from 'vitest'

const deferred = () => {
  let resolve!: () => void
  return {
    promise: new Promise<void>(r => {
      resolve = r
    }),
    resolve: () => resolve()
  }
}
afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})
it.each(['B-new', 'A-rotated'])('preserves %s when the cookie rotates while locale invalidation is pending', async replacement => {
  let token: string | null = 'A-old'
  const waiting = deferred(),
    started = deferred()
  const session = {
    getToken: vi.fn(async () => token),
    clearSession: vi.fn(async () => {
      token = null
      return true
    })
  }
  const clearUserData = vi.fn(async () => {}),
    teardown = vi.fn(async () => {}),
    recalibrate = vi.fn()
  const pending = expireLocaleSession(
    {
      session,
      invalidateLocale: async () => {
        started.resolve()
        await waiting.promise
      },
      clearUserData,
      teardown,
      recalibrate
    },
    'A-old'
  )
  await started.promise
  token = replacement
  waiting.resolve()
  await pending
  expect(token).toBe(replacement)
  expect(clearUserData).not.toHaveBeenCalled()
  expect(teardown).not.toHaveBeenCalled()
  expect(recalibrate).toHaveBeenCalledOnce()
})
it('checks the token after enumerating cookies, immediately before deletion', async () => {
  vi.stubEnv('PUBLIC_BASE_URL', 'https://reader.test')
  vi.stubEnv('COOKIE_TOKEN_NAME', 'session')
  let token = 'A-old'
  const cookie = () => ({ name: 'session', value: token, domain: 'reader.test', path: '/', secure: true, storeId: '0' })
  const remove = vi.fn(async () => ({}))
  vi.stubGlobal('browser', {
    cookies: {
      get: vi.fn(async () => cookie()),
      getAll: vi.fn(async () => {
        const old = cookie()
        token = 'B-new'
        return [old]
      }),
      remove
    }
  })
  expect(await new SessionService().clearSession('A-old')).toBe(false)
  expect(remove).not.toHaveBeenCalled()
})
it('clears an unchanged expired session and its dependent state', async () => {
  const session = { getToken: vi.fn(async () => 'A-old'), clearSession: vi.fn(async () => true) }
  const invalidateLocale = vi.fn(async () => {}),
    clearUserData = vi.fn(async () => {}),
    teardown = vi.fn(async () => {}),
    recalibrate = vi.fn()
  await expireLocaleSession({ session, invalidateLocale, clearUserData, teardown, recalibrate }, 'A-old')
  expect(session.clearSession).toHaveBeenCalledWith('A-old')
  expect(clearUserData).toHaveBeenCalledOnce()
  expect(teardown).toHaveBeenCalledOnce()
})
