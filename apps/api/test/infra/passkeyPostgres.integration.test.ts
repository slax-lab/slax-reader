import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { Client } from 'pg'
import { PrismaClient } from '@prisma/hyperdrive-client'
import { PrismaPg } from '@prisma/adapter-pg'
import { PasskeyService } from '@/domain/passkey'
import { PasskeyRepo } from '@/infra/repository/dbPasskey'

const enabled = process.env.PASSKEY_LOCAL_PG_TEST === '1'
const connectionString = process.env.PASSKEY_LOCAL_PG_URL || 'postgresql://postgres@127.0.0.1:6543/payment_test'
const schema = `passkey_review_${randomUUID().replaceAll('-', '')}`
const admin = enabled ? new Client({ connectionString }) : null
const db = enabled ? new PrismaClient({ adapter: new PrismaPg({ connectionString, options: `-c search_path=${schema}` }, { schema }) }) : null
const repo = () => new PasskeyRepo(() => db!)
const service = () => new PasskeyService(repo(), {} as never)
const env = { FRONT_END_URL: 'https://r.slax.dev' } as Env

describe.skipIf(!enabled)('Passkey state against isolated local PostgreSQL', () => {
  beforeAll(async () => {
    expect(['127.0.0.1', 'localhost']).toContain(new URL(connectionString).hostname)
    await admin!.connect()
    await admin!.query(`CREATE SCHEMA "${schema}"`)
    for (const table of ['sr_user', 'sr_platform_bind', 'sr_user_passkey']) {
      await admin!.query(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`)
      await admin!.query(`CREATE SEQUENCE "${schema}"."${table}_local_id_seq" OWNED BY "${schema}"."${table}".id`)
      await admin!.query(`ALTER TABLE "${schema}"."${table}" ALTER COLUMN id SET DEFAULT nextval('"${schema}"."${table}_local_id_seq"')`)
    }
    await db!.$connect()
  })
  beforeEach(async () => {
    await admin!.query(`TRUNCATE "${schema}".sr_user_passkey, "${schema}".sr_platform_bind, "${schema}".sr_user RESTART IDENTITY`)
  })
  afterAll(async () => {
    await db!.$disconnect()
    try {
      await admin!.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    } finally {
      await admin!.end()
    }
  })
  const createUser = (email: string) => db!.sr_user.create({ data: { email, created_at: new Date(), last_login_at: new Date() } })
  const createKey = (userId: number, credentialId: string, rpId = 'r.slax.dev') =>
    db!.sr_user_passkey.create({ data: { user_id: userId, rp_id: rpId, credential_id: credentialId, public_key: new Uint8Array([1, 2]) } })

  test('deletion reports the complete remaining RP state with the stable registration handle', async () => {
    const owner = await createUser('owner@example.test')
    const keys = await Promise.all(['first', 'second', 'third'].map(id => createKey(owner.id, id)))
    await repo().withAccount(owner.id, tx => tx.saveSummary(owner.uuid))
    const result = await service().remove(env, owner.id, keys[0].id)
    expect(result).toEqual({
      deleted: true,
      credential_state: { rp_id: 'r.slax.dev', user_handle: Buffer.from(owner.uuid).toString('base64url'), credential_ids: ['second', 'third'] }
    })
    expect(await db!.sr_platform_bind.count({ where: { user_id: owner.id, platform: 'passkey' } })).toBe(1)
    await service().remove(env, owner.id, keys[1].id)
    expect((await service().remove(env, owner.id, keys[2].id)).credential_state.credential_ids).toEqual([])
    expect(await db!.sr_platform_bind.count({ where: { user_id: owner.id, platform: 'passkey' } })).toBe(0)
  })

  test('numeric deletion still enforces the account and RP and retains another RP summary', async () => {
    const owner = await createUser('owner@example.test')
    const other = await createUser('other@example.test')
    const key = await createKey(owner.id, 'owner-key')
    const otherRp = await createKey(owner.id, 'other-rp-key', 'r-beta.slax.com')
    await repo().withAccount(owner.id, tx => tx.saveSummary(owner.uuid))
    await expect(service().remove(env, other.id, key.id)).rejects.toMatchObject({ name: 'PASSKEY_VERIFICATION_FAILED' })
    await expect(service().remove(env, owner.id, otherRp.id)).rejects.toMatchObject({ name: 'PASSKEY_VERIFICATION_FAILED' })
    expect((await service().remove(env, owner.id, key.id)).credential_state.credential_ids).toEqual([])
    expect(await db!.sr_user_passkey.count({ where: { user_id: owner.id } })).toBe(1)
    expect(await db!.sr_platform_bind.count({ where: { user_id: owner.id, platform: 'passkey' } })).toBe(1)
  })

  test('the repository distinguishes an RP-global credential from a mailbox-owned credential', async () => {
    const owner = await createUser('owner@example.test')
    const other = await createUser('other@example.test')
    await createKey(other.id, 'other-mailbox-key')
    await repo().withAccount(owner.id, async tx => {
      expect(await tx.findCredential('other-mailbox-key', 'r.slax.dev')).toBeNull()
    })
    expect(await repo().credentialExistsForRp('other-mailbox-key', 'r.slax.dev')).toBe(true)
    expect(await repo().credentialExistsForRp('other-mailbox-key', 'r-beta.slax.com')).toBe(false)
    expect(await repo().credentialExistsForRp('missing-key', 'r.slax.dev')).toBe(false)
  })
})
