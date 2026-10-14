import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { Client } from 'pg'
import { PrismaClient } from '@prisma/hyperdrive-client'
import { PrismaPg } from '@prisma/adapter-pg'
import { UserRepo, platformBindType, type userInfoPO } from '@/infra/repository/dbUser'
import { ApiKeyRepo } from '@/infra/repository/dbApiKey'
import { ApiKeyAuth } from '@/utils/apiKeyAuth'
import { requireActiveReaderUser } from '@/utils/activeUser'
import { Container } from '@/decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'

const enabled = process.env.ACCOUNT_LOCAL_PG_TEST === '1'
const connectionString = 'postgresql://postgres@127.0.0.1:6543/payment_test'
const schema = `account_revocation_${randomUUID().replaceAll('-', '')}`
const admin = enabled ? new Client({ connectionString }) : null
const makeClient = (name: string) =>
  new PrismaClient({
    adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}`, application_name: `${schema}_${name}` }, { schema }),
    transactionOptions: { timeout: 15000, maxWait: 5000 }
  })
const first = enabled ? makeClient('first') : null
const second = enabled ? makeClient('second') : null
const userRepo = (db: PrismaClient) =>
  new UserRepo(
    (() => {
      throw new Error('D1 is not part of this test')
    }) as never,
    () => db
  )
const apiKeyRepo = (db: PrismaClient) => new ApiKeyRepo(() => db)
const registration = (email: string) => ({ email, lang: 'en', name: 'Updated', deleted_at: null }) as userInfoPO
const key = (userId: number) => ({ userId, name: 'test', keyHash: randomUUID(), keyPrefix: 'test' })

async function orderedRace(firstOperation: (db: PrismaClient) => Promise<unknown>, secondOperation: (db: PrismaClient) => Promise<unknown>) {
  let ready!: () => void
  let release!: () => void
  const locked = new Promise<void>(resolve => {
    ready = resolve
  })
  const released = new Promise<void>(resolve => {
    release = resolve
  })
  const held = new Proxy(first!, {
    get(target, property) {
      if (property === '$transaction')
        return (operation: (tx: unknown) => Promise<unknown>) =>
          target.$transaction(async tx => {
            const result = await operation(tx)
            ready()
            await released
            return result
          })
      return Reflect.get(target, property)
    }
  })
  const firstResult = firstOperation(held)
  let secondResult: Promise<PromiseSettledResult<unknown>[]> | undefined
  try {
    await Promise.race([
      locked,
      firstResult.then(() => {
        throw new Error('Transaction did not reach commit barrier')
      })
    ])
    secondResult = Promise.allSettled([secondOperation(second!)])
    let blocked = false
    for (let attempt = 0; attempt < 100; attempt++) {
      const result = await admin!.query('SELECT 1 FROM pg_stat_activity WHERE application_name = $1 AND wait_event_type = $2', [`${schema}_second`, 'Lock'])
      if (result.rowCount) {
        blocked = true
        break
      }
      await delay(20)
    }
    expect(blocked, 'competing repository transaction must actually wait on a PostgreSQL lock').toBe(true)
  } finally {
    release()
    await firstResult
  }
  return (await secondResult!)[0]
}

describe.skipIf(!enabled)('account revocation against isolated local PostgreSQL', () => {
  beforeAll(async () => {
    await admin!.connect()
    await admin!.query(`CREATE SCHEMA "${schema}"`)
    for (const table of ['sr_user', 'sr_user_api_key', 'sr_platform_bind', 'sr_user_subscription']) {
      await admin!.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`)
      await admin!.query(`CREATE SEQUENCE "${schema}"."${table}_local_id_seq" OWNED BY "${schema}"."${table}".id`)
      await admin!.query(`ALTER TABLE "${schema}"."${table}" ALTER COLUMN id SET DEFAULT nextval('"${schema}"."${table}_local_id_seq"')`)
    }
    await Promise.all([first!.$connect(), second!.$connect()])
    const location = await first!.$queryRaw<{ current_schema: string }[]>`SELECT current_schema()`
    expect(location[0].current_schema).toBe(schema)
  })
  beforeEach(async () => {
    await admin!.query(`TRUNCATE "${schema}".sr_user_subscription, "${schema}".sr_platform_bind, "${schema}".sr_user_api_key, "${schema}".sr_user RESTART IDENTITY`)
  })
  afterAll(async () => {
    await Promise.all([first!.$disconnect(), second!.$disconnect()])
    try {
      await admin!.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    } finally {
      await admin!.end()
    }
  })
  const createUser = (email = 'user@example.test') => first!.sr_user.create({ data: { email, created_at: new Date(), last_login_at: new Date() } })

  test.each(['register', 'register-id', 'key', 'bind'] as const)('deletion winning the row lock blocks a concurrent %s', async operation => {
    const user = await createUser()
    await apiKeyRepo(first!).upsertApiKey(key(user.id))
    const result = await orderedRace(
      db => userRepo(db).markUserAsDeleted(user.id),
      db => {
        if (operation === 'register') return userRepo(db).registerUser(registration(user.email))
        if (operation === 'register-id') return userRepo(db).registerUser({ ...registration(user.email), id: user.id })
        if (operation === 'key') return apiKeyRepo(db).upsertApiKey(key(user.id))
        return userRepo(db).userBindPlatform(user.id, platformBindType.GOOGLE, 'google-1', 'test')
      }
    )
    expect(result.status).toBe('rejected')
    expect((await first!.sr_user.findUniqueOrThrow({ where: { id: user.id } })).deleted_at).not.toBeNull()
    expect(await first!.sr_user_api_key.count()).toBe(0)
    expect(await first!.sr_platform_bind.count()).toBe(0)
    await expect(requireActiveReaderUser(first!, user.id)).rejects.toMatchObject({ errCode: 401 })
  })

  test.each(['register', 'register-id', 'key', 'bind'] as const)('%s winning the row lock cannot survive subsequent deletion as an active credential', async operation => {
    const user = await createUser()
    const result = await orderedRace(
      db => {
        if (operation === 'register') return userRepo(db).registerUser(registration(user.email))
        if (operation === 'register-id') return userRepo(db).registerUser({ ...registration(user.email), id: user.id })
        if (operation === 'key') return apiKeyRepo(db).upsertApiKey(key(user.id))
        return userRepo(db).userBindPlatform(user.id, platformBindType.GOOGLE, 'google-1', 'test')
      },
      db => userRepo(db).markUserAsDeleted(user.id)
    )
    expect(result.status).toBe('fulfilled')
    expect(await first!.sr_user_api_key.count()).toBe(0)
    await expect(requireActiveReaderUser(first!, user.id)).rejects.toMatchObject({ errCode: 401 })
    await expect(userRepo(first!).getUserByPlatform('google', 'google-1')).rejects.toMatchObject({ name: 'UNKNOWN_BIND_USER_ERROR' })
  })

  test('two active accounts racing for the same provider identity serialize on the advisory lock', async () => {
    const a = await createUser('a@example.test')
    const b = await createUser('b@example.test')
    const result = await orderedRace(
      db => userRepo(db).userBindPlatform(a.id, platformBindType.GOOGLE, 'same-subject', 'a'),
      db => userRepo(db).userBindPlatform(b.id, platformBindType.GOOGLE, 'same-subject', 'b')
    )
    expect(result.status).toBe('rejected')
    expect(await first!.sr_platform_bind.count()).toBe(1)
    expect((await userRepo(first!).getUserByPlatform('google', 'same-subject')).user_id).toBe(a.id)
  })

  test('API-key deletion failure rolls back the tombstone, then a retry revokes it', async () => {
    const user = await createUser()
    await apiKeyRepo(first!).upsertApiKey(key(user.id))
    await admin!.query(`CREATE FUNCTION "${schema}".reject_key_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected key deletion failure'; END $$`)
    await admin!.query(`CREATE TRIGGER reject_key_delete BEFORE DELETE ON "${schema}".sr_user_api_key FOR EACH ROW EXECUTE FUNCTION "${schema}".reject_key_delete()`)
    try {
      await expect(userRepo(first!).markUserAsDeleted(user.id)).rejects.toThrow('injected key deletion failure')
      expect((await first!.sr_user.findUniqueOrThrow({ where: { id: user.id } })).deleted_at).toBeNull()
      expect(await first!.sr_user_api_key.count()).toBe(1)
    } finally {
      await admin!.query(`DROP TRIGGER reject_key_delete ON "${schema}".sr_user_api_key`)
    }
    await userRepo(first!).markUserAsDeleted(user.id)
    expect(await first!.sr_user_api_key.count()).toBe(0)
  })

  test('the real API-key verifier loses access immediately after deletion', async () => {
    const user = await createUser()
    const rawKey = randomUUID()
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(rawKey))
    await apiKeyRepo(first!).upsertApiKey({ ...key(user.id), keyHash: Buffer.from(digest).toString('hex') })
    const scope = new Container()
    scope.registerInstance(PRISIMA_HYPERDRIVE_CLIENT, second!)
    const verifier = new ApiKeyAuth(scope)
    expect((await verifier.verify(rawKey)).userId).toBe(user.id)
    await userRepo(first!).markUserAsDeleted(user.id)
    await expect(verifier.verify(rawKey)).rejects.toBeDefined()
  })

  test('re-registration after 30 days preserves the tombstone and never reuses old id or UUID', async () => {
    const user = await createUser()
    const deletedAt = new Date(Date.now() - 31 * 86400000)
    await first!.sr_user.update({ where: { id: user.id }, data: { deleted_at: deletedAt } })
    await expect(userRepo(first!).registerUser({ ...user, deleted_at: null } as userInfoPO)).rejects.toMatchObject({ name: 'USER_ACCOUNT_DELETED' })
    expect(await userRepo(first!).getInfoByEmail(user.email)).toBeNull()
    const fresh = await userRepo(first!).registerUser(registration(user.email))
    expect(fresh.id).not.toBe(user.id)
    expect(fresh.uuid).not.toBe(user.uuid)
    expect(fresh.deleted_at).toBeNull()
    const tombstone = await first!.sr_user.findUniqueOrThrow({ where: { id: user.id } })
    expect(tombstone.deleted_at).toEqual(deletedAt)
    expect(tombstone.email).toMatch(/@deleted\.invalid$/)
    await expect(requireActiveReaderUser(second!, user.id)).rejects.toMatchObject({ errCode: 401 })
  })
})
