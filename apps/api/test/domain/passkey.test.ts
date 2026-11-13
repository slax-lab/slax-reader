import { beforeEach, describe, expect, test, vi } from 'vitest'
import { PasskeyService } from '@/domain/passkey'
import type { PasskeyRepo } from '@/infra/repository/dbPasskey'
import type { PasskeyChallengeRepo } from '@/infra/repository/redisPasskeyChallenge'

const protocol = vi.hoisted(() => ({ registration: vi.fn(), authentication: vi.fn() }))
vi.mock('@/utils/passkey', async importOriginal => ({
  ...(await importOriginal<typeof import('@/utils/passkey')>()),
  verifyPasskeyRegistration: protocol.registration,
  verifyPasskeyAuthentication: protocol.authentication
}))

const env = { RUN_TYPE: 'dev', FRONT_END_URL: 'https://r.slax.dev' } as Env
const owner = { id: 42, uuid: 'opaque-account-uuid', email: 'historical@example.test', lang: 'en', deleted_at: null }
const mailbox = { platform_id: 'reader@example.test', user_name: 'Reader@example.test' }
const credential = {
  id: 1,
  uuid: 'credential-uuid',
  user_id: 42,
  rp_id: 'r.slax.dev',
  credential_id: 'credential-id',
  public_key: new Uint8Array([1, 2]),
  counter: 0n,
  transports: ['internal'],
  name: 'My phone',
  created_at: new Date(),
  last_used_at: null
}

function fixture() {
  const tx = {
    account: owner,
    findMailbox: vi.fn().mockResolvedValue(mailbox),
    listCredentials: vi.fn().mockResolvedValue([credential]),
    findCredential: vi.fn().mockResolvedValue(credential),
    createCredential: vi.fn().mockResolvedValue(credential),
    updateCredential: vi.fn().mockResolvedValue(undefined),
    deleteCredential: vi.fn().mockResolvedValue(1),
    countCredentials: vi.fn().mockResolvedValue(0),
    saveSummary: vi.fn().mockResolvedValue(undefined),
    deleteSummary: vi.fn().mockResolvedValue(undefined),
    recordLogin: vi.fn().mockResolvedValue(undefined)
  }
  const repo = {
    findLoginAccounts: vi.fn().mockResolvedValue([owner]),
    withAccount: vi.fn(async (_id: number, run: (transaction: typeof tx) => Promise<unknown>) => run(tx))
  }
  let stored: unknown
  const challenges = {
    save: vi.fn(async (_environment: string, _request: string, value: unknown) => {
      stored = value
    }),
    consume: vi.fn(async () => {
      const value = stored
      stored = undefined
      return value ?? null
    })
  }
  return { tx, repo, challenges, service: new PasskeyService(repo as never as PasskeyRepo, challenges as never as PasskeyChallengeRepo) }
}

beforeEach(() => {
  protocol.registration.mockReset().mockResolvedValue({ credential_id: credential.credential_id, public_key: credential.public_key, counter: 0n, transports: ['internal'] })
  protocol.authentication.mockReset().mockResolvedValue(0n)
})

describe('Passkey account orchestration', () => {
  test.each(['reader@example.test', 'unknown@example.test'])('login challenge for %s does not reveal account or credential information', async email => {
    const { service, repo, challenges } = fixture()
    repo.findLoginAccounts.mockResolvedValue([])
    const result = await service.challenge(env, { purpose: 'login', email })
    expect(result.options.allowCredentials).toEqual([])
    expect(repo.findLoginAccounts).not.toHaveBeenCalled()
    expect(repo.withAccount).not.toHaveBeenCalled()
    expect(challenges.save).toHaveBeenCalledWith('dev', result.request_id, expect.objectContaining({ purpose: 'login', emailKey: email }), 300)
  })

  test('an unknown mailbox still cannot complete login with a generic challenge', async () => {
    const { service, repo } = fixture()
    const challenge = await service.challenge(env, { purpose: 'login', email: 'unknown@example.test' })
    repo.findLoginAccounts.mockResolvedValue([])
    await expect(
      service.authenticate(env, { type: 'passkey', request_id: challenge.request_id, email: 'unknown@example.test', credential: { id: 'credential-id' } as never })
    ).rejects.toMatchObject({ name: 'PASSKEY_VERIFICATION_FAILED' })
    expect(protocol.authentication).not.toHaveBeenCalled()
  })

  test('issues a registration challenge only for an active verified-mailbox owner', async () => {
    const { service, challenges, tx } = fixture()
    const result = await service.challenge(env, { purpose: 'register' }, 42)
    expect(result.purpose).toBe('register')
    expect(result.options).toMatchObject({ rp: { id: 'r.slax.dev' }, authenticatorSelection: { userVerification: 'required', residentKey: 'required' } })
    expect(challenges.save).toHaveBeenCalledWith('dev', result.request_id, expect.objectContaining({ purpose: 'register', userId: 42 }), 300)
    tx.findMailbox.mockResolvedValueOnce(null)
    await expect(service.challenge(env, { purpose: 'register' }, 42)).rejects.toBeDefined()
  })

  test('a valid registration preserves existing identities and creates one summary', async () => {
    const { service, tx } = fixture()
    const challenge = await service.challenge(env, { purpose: 'register' }, 42)
    const proof = { type: 'passkey' as const, request_id: challenge.request_id, credential: { id: 'credential-id' } as never, name: 'My phone' }
    expect(await service.linkCredential(env, 42, proof)).toEqual({ linked: true })
    expect(tx.createCredential).toHaveBeenCalledWith(expect.objectContaining({ user_id: 42, rp_id: 'r.slax.dev', name: 'My phone', counter: 0n }))
    expect(tx.saveSummary).toHaveBeenCalledWith(owner.uuid)
    await expect(service.linkCredential(env, 42, proof)).rejects.toBeDefined()
  })

  test('a duplicate credential is a verification failure and cannot change the summary', async () => {
    const { service, tx } = fixture()
    const challenge = await service.challenge(env, { purpose: 'register' }, 42)
    tx.createCredential.mockResolvedValueOnce(null as never)
    await expect(service.linkCredential(env, 42, { type: 'passkey', request_id: challenge.request_id, credential: {} as never, name: 'Duplicate' })).rejects.toMatchObject({
      name: 'PASSKEY_VERIFICATION_FAILED'
    })
    expect(tx.saveSummary).not.toHaveBeenCalled()
  })

  test('registration cannot consume another owner or a login challenge', async () => {
    const { service, tx } = fixture()
    const challenge = await service.challenge(env, { purpose: 'register' }, 42)
    await expect(service.linkCredential(env, 99, { type: 'passkey', request_id: challenge.request_id, credential: {} as never, name: 'Other' })).rejects.toBeDefined()
    expect(tx.createCredential).not.toHaveBeenCalled()
  })

  test('mailbox assertions return the existing owner and accept a legitimate zero counter', async () => {
    const { service, tx } = fixture()
    const challenge = await service.challenge(env, { purpose: 'login', email: 'Reader@example.test' })
    const proof = { type: 'passkey' as const, request_id: challenge.request_id, email: 'Reader@example.test', credential: { id: 'credential-id' } as never }
    expect(await service.authenticate(env, proof)).toMatchObject({ id: 42, uuid: owner.uuid })
    expect(tx.updateCredential).toHaveBeenCalledWith(credential.id, 0n)
    await expect(service.authenticate(env, proof)).rejects.toBeDefined()
  })

  test('a mailbox mismatch cannot authenticate using a valid challenge', async () => {
    const { service, tx } = fixture()
    const challenge = await service.challenge(env, { purpose: 'login', email: 'reader@example.test' })
    await expect(
      service.authenticate(env, { type: 'passkey', request_id: challenge.request_id, email: 'other@example.test', credential: { id: 'credential-id' } as never })
    ).rejects.toBeDefined()
    expect(tx.updateCredential).not.toHaveBeenCalled()
  })

  test('unknown, deleted, or wrong-RP credentials cannot authenticate', async () => {
    const { service, tx } = fixture()
    const challenge = await service.challenge(env, { purpose: 'login', email: 'reader@example.test' })
    tx.findCredential.mockResolvedValueOnce(null)
    await expect(
      service.authenticate(env, { type: 'passkey', request_id: challenge.request_id, email: 'reader@example.test', credential: { id: 'other-credential' } as never })
    ).rejects.toBeDefined()
    expect(protocol.authentication).not.toHaveBeenCalled()
  })

  test('deleted accounts cannot register or authenticate', async () => {
    const { service, tx } = fixture()
    tx.account = { ...owner, deleted_at: new Date() } as never
    await expect(service.challenge(env, { purpose: 'register' }, 42)).rejects.toBeDefined()
    expect(protocol.registration).not.toHaveBeenCalled()
  })

  test('lists only management metadata, never public-key bytes', async () => {
    const { service } = fixture()
    const result = await service.list(env, 42)
    expect(result).toEqual([{ uuid: credential.uuid, name: 'My phone', created_at: credential.created_at.toISOString(), last_used_at: null }])
    expect(JSON.stringify(result)).not.toContain('public_key')
  })

  test('deleting the last key removes only its summary', async () => {
    const { service, tx } = fixture()
    expect(await service.remove(env, 42, credential.uuid)).toEqual({ deleted: true })
    expect(tx.deleteCredential).toHaveBeenCalledWith(credential.uuid, 'r.slax.dev')
    expect(tx.deleteSummary).toHaveBeenCalledOnce()
  })

  test('deleting one of several keys retains the summary', async () => {
    const { service, tx } = fixture()
    tx.countCredentials.mockResolvedValueOnce(1)
    await service.remove(env, 42, credential.uuid)
    expect(tx.deleteSummary).not.toHaveBeenCalled()
  })

  test('a credential UUID owned by another account cannot be deleted', async () => {
    const { service, tx } = fixture()
    tx.deleteCredential.mockResolvedValueOnce(0)
    await expect(service.remove(env, 42, 'foreign-uuid')).rejects.toBeDefined()
    expect(tx.deleteSummary).not.toHaveBeenCalled()
  })
})
