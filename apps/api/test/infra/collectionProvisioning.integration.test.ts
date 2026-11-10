import 'dotenv/config'
import { createHash, randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'
import { CollectionRepo } from '@/infra/repository/dbCollection'

vi.mock('@/utils/strings', () => ({
  hashMD5: vi.fn(async (source: string | Uint8Array) => createHash('md5').update(source).digest('hex'))
}))

const describePg = process.env.RUN_PG_INTEGRATION_TESTS === '1' ? describe : describe.skip

describePg('Collection default provisioning PostgreSQL integration', () => {
  let db: HyperdrivePrismaClient
  let repo: CollectionRepo
  let ownerId: number | null = null

  beforeAll(async () => {
    db = new HyperdrivePrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.HYPERDRIVE_DATABASE_URL, max: 4 })) })
    repo = new CollectionRepo(() => db)
  })

  afterAll(async () => {
    if (ownerId) await db.sr_user.delete({ where: { id: ownerId } }).catch(() => undefined)
    await db?.$disconnect()
  })

  test('concurrent provisioning returns one stable row and preserves a later close', async () => {
    const token = randomUUID()
    const owner = await db.sr_user.create({
      data: { email: `collection-provisioning-${token}@example.test`, name: 'Concurrent Owner', lang: 'en', last_login_at: new Date(), created_at: new Date() }
    })
    ownerId = owner.id

    const results = await Promise.all(Array.from({ length: 8 }, () => repo.ensureUserShareCollect(owner.id, "Concurrent Owner's Reading Recommendations")))
    expect(new Set(results.map(row => row.id)).size).toBe(1)
    expect(new Set(results.map(row => row.collection_code)).size).toBe(1)
    expect(results[0]).toMatchObject({ owner_id: owner.id, status: 1, display_name: "Concurrent Owner's Reading Recommendations" })
    expect(await db.sr_user_collection.count({ where: { owner_id: owner.id } })).toBe(1)

    await db.sr_user_collection.update({ where: { owner_id: owner.id }, data: { status: 0 } })
    const closed = await repo.ensureUserShareCollect(owner.id, 'Replacement name')
    expect(closed).toMatchObject({ status: 0, display_name: "Concurrent Owner's Reading Recommendations", collection_code: results[0].collection_code })
  })
})
