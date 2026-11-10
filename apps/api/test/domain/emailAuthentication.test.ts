import { afterEach, describe, expect, test, vi } from 'vitest'
import { EmailAuthentication, emailAuthEnabled } from '@/domain/emailAuthentication'
import { SlaxAuth } from '@/utils/auth'
import { ContextManager } from '@/utils/context'

const env = {
  EMAIL_AUTH_HMAC_SECRET: 'a-long-test-only-verification-secret',
  RESEND_API_KEY: 'fixture',
  FRONT_END_URL: 'https://reader.example.test',
  RUN_TYPE: 'dev'
} as Env

function context(userId: number, workerEnv = env) {
  const ctx = new ContextManager({} as ExecutionContext, workerEnv)
  ctx.setUserInfo(userId, userId, '', 'en')
  return ctx
}

function request(body: object) {
  return new Request('https://api.example.test/', { method: 'POST', body: JSON.stringify(body) })
}

function fixture() {
  const state = new Map<string, unknown>()
  const challenges = {
    saveProvider: async (environment: string, id: number, key: string, value: unknown) => {
      state.set(`${environment}:${id}:${key}`, value)
    },
    consumeProvider: async (environment: string, id: number, key: string) => {
      const entry = `${environment}:${id}:${key}`
      const value = state.get(entry)
      state.delete(entry)
      return value
    }
  }
  const repo = { bindLoginProvider: vi.fn() }
  const auth = new EmailAuthentication(repo as never, challenges as never)
  const start = (id: number) => auth.startProvider(context(id), { type: 'google', platform: 'web' })
  const finish = (id: number, state: string, redirectUri = 'https://reader.example.test/auth') =>
    auth.bind(context(id), request({ type: 'google', platform: 'web', code: 'fixture-code', state, redirect_uri: redirectUri }))
  return { repo, start, finish }
}

afterEach(() => vi.restoreAllMocks())

test('email auth is available as soon as its credentials are configured', () => {
  expect(emailAuthEnabled(env)).toBe(true)
  expect(emailAuthEnabled({ ...env, RESEND_API_KEY: undefined })).toBe(false)
  expect(emailAuthEnabled({ ...env, EMAIL_AUTH_HMAC_SECRET: 'too-short' })).toBe(false)
})

test.each([
  ['dev', true],
  ['beta', false],
  ['prod', false]
] as const)('reports whether the settings should show mailbox binding in %s', async (runType, visible) => {
  const auth = new EmailAuthentication({} as never, {} as never)
  const ctx = context(41, { ...env, RUN_TYPE: runType })
  expect(auth.identities(ctx, [])).toMatchObject({ enabled: true, show_email_binding: visible })
})

describe('explicit OAuth binding', () => {
  test('only the initiating account can complete a valid state, once', async () => {
    const { repo, start, finish } = fixture()
    const { state, nonce } = await start(41)
    const oauth = vi.spyOn(SlaxAuth.prototype, 'login').mockResolvedValue({ sub: 'google-sub', email: 'reader@example.test', nonce } as never)
    await expect(finish(42, state)).rejects.toMatchObject({ name: 'OAUTH2_STATE_EXPIRED' })
    expect(oauth).not.toHaveBeenCalled()
    await expect(finish(41, state)).resolves.toEqual({ linked: true })
    await expect(finish(41, state)).rejects.toMatchObject({ name: 'OAUTH2_STATE_EXPIRED' })
    expect(repo.bindLoginProvider).toHaveBeenCalledExactlyOnceWith(41, 'google', 'google-sub', 'reader@example.test')
  })

  test('rejects a valid provider identity with a different signed nonce', async () => {
    const { repo, start, finish } = fixture()
    const { state } = await start(41)
    vi.spyOn(SlaxAuth.prototype, 'login').mockResolvedValue({ sub: 'google-sub', email: 'reader@example.test', nonce: 'different' } as never)
    await expect(finish(41, state)).rejects.toMatchObject({ name: 'OAUTH2_STATE_EXPIRED' })
    expect(repo.bindLoginProvider).not.toHaveBeenCalled()
  })

  test('rejects an unconfigured web callback before the provider exchange', async () => {
    const { start, finish } = fixture()
    const { state } = await start(41)
    const oauth = vi.spyOn(SlaxAuth.prototype, 'login')
    await expect(finish(41, state, 'https://attacker.example.test/auth')).rejects.toMatchObject({ name: 'ERROR_PARAM' })
    expect(oauth).not.toHaveBeenCalled()
  })
})
