import { afterEach, describe, expect, test, vi } from 'vitest'
import { LoginIdentityLinkService } from '@/domain/loginIdentityLinkService'
import { SlaxAuth } from '@/utils/auth'
import { ContextManager } from '@/utils/context'

const env = {
  FRONT_END_URL: 'https://reader.example.test',
  RUN_TYPE: 'dev'
} as Env

function context(userId: number, workerEnv = env) {
  const ctx = new ContextManager({} as ExecutionContext, workerEnv)
  ctx.setUserInfo(userId, userId, '', 'en')
  return ctx
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
  const repo = { linkLoginProvider: vi.fn() }
  const auth = new LoginIdentityLinkService(repo as never, {} as never, challenges as never)
  const start = (id: number) => auth.startProvider(context(id), 'google', 'web')
  const finish = (id: number, state: string) =>
    auth.linkIdentity(context(id), { type: 'google', platform: 'web', code: 'fixture-code', state, redirect_uri: 'https://reader.example.test/auth' })
  return { repo, start, finish }
}

afterEach(() => vi.restoreAllMocks())

describe('explicit OAuth binding', () => {
  test('only the initiating account can complete a valid state, once', async () => {
    const { repo, start, finish } = fixture()
    const { state, nonce } = await start(41)
    const oauth = vi.spyOn(SlaxAuth.prototype, 'login').mockResolvedValue({ sub: 'google-sub', email: 'reader@example.test', nonce } as never)
    await expect(finish(42, state)).rejects.toMatchObject({ name: 'OAUTH2_STATE_EXPIRED' })
    expect(oauth).not.toHaveBeenCalled()
    await expect(finish(41, state)).resolves.toEqual({ linked: true })
    await expect(finish(41, state)).rejects.toMatchObject({ name: 'OAUTH2_STATE_EXPIRED' })
    expect(repo.linkLoginProvider).toHaveBeenCalledExactlyOnceWith(41, 'google', 'google-sub', 'reader@example.test')
  })

  test('rejects a valid provider identity with a different signed nonce', async () => {
    const { repo, start, finish } = fixture()
    const { state } = await start(41)
    vi.spyOn(SlaxAuth.prototype, 'login').mockResolvedValue({ sub: 'google-sub', email: 'reader@example.test', nonce: 'different' } as never)
    await expect(finish(41, state)).rejects.toMatchObject({ name: 'OAUTH2_STATE_EXPIRED' })
    expect(repo.linkLoginProvider).not.toHaveBeenCalled()
  })
})
