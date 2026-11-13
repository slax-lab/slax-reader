import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { setTimeout as delay } from 'node:timers/promises'
import { PasskeyChallengeRepo } from '@/infra/repository/redisPasskeyChallenge'
import { RedisClient } from '@/infra/repository/redisClient'
import { startEmailRedisFixture } from '../runtime/emailRedisFixture'

describe.skipIf(process.env.PASSKEY_REDIS_TEST !== '1')('Passkey challenges in local Redis', () => {
  let fixture: Awaited<ReturnType<typeof startEmailRedisFixture>>
  let repo: PasskeyChallengeRepo
  const proof = { purpose: 'register' as const, userId: 42, emailKey: 'reader@example.test', rpId: 'r.slax.dev', challenge: 'random-challenge' }
  beforeAll(async () => {
    fixture = await startEmailRedisFixture()
    const redis = new RedisClient({ UPSTASH_REDIS_REST_URL: fixture.url, UPSTASH_REDIS_REST_TOKEN: 'fixture-only' } as Env)
    repo = new PasskeyChallengeRepo(() => redis)
  })
  afterAll(async () => {
    await fixture?.dispose()
  })

  test('one of two competing requests consumes a challenge and environment keys are isolated', async () => {
    const id = crypto.randomUUID()
    await repo.save('dev', id, proof, 300)
    expect(await repo.consume('prod', id)).toBeNull()
    const results = await Promise.all([repo.consume('dev', id), repo.consume('dev', id)])
    expect(results.filter(Boolean)).toEqual([proof])
  })

  test('Redis expires a challenge without a PostgreSQL expiry column', async () => {
    const id = crypto.randomUUID()
    await repo.save('dev', id, proof, 1)
    await delay(1100)
    expect(await repo.consume('dev', id)).toBeNull()
  })
})
