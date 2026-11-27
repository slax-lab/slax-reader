import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/hyperdrive-client'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'

// sr_bookmark timestamps have no zone, and the pg driver converts them in the process zone.
// Workers run in UTC, so the mirrored metadata is only comparable when the test runs in UTC too.
const url = process.env.FORK_TEST_DATABASE_URL
describe.runIf(!!url && new Date().getTimezoneOffset() === 0)('publisher publication time against PostgreSQL', () => {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  const repo = new BookmarkRepo({} as never, () => client)
  const saved = new Date('2026-11-23T08:01:00.000Z')
  const original = new Date('2023-10-19T12:01:36.000Z')
  const users: number[] = []
  const bookmarks: number[] = []

  const bookmark = async (privateUser: number, status = 'success') => {
    const row = await client.sr_bookmark.create({
      data: {
        title: 'Article',
        target_url: `https://publisher.test/${crypto.randomUUID()}`,
        private_user: privateUser,
        status,
        content_key: 'body.html',
        content_md_key: 'body.txt',
        created_at: saved,
        updated_at: saved,
        published_at: saved
      }
    })
    bookmarks.push(row.id)
    const relation = await client.sr_user_bookmark.create({ data: { user_id: privateUser || users[0], bookmark_id: row.id, updated_at: saved } })
    return { id: row.id, relation: relation.id }
  }
  const stored = async (id: number) => (await client.sr_bookmark.findUniqueOrThrow({ where: { id } })).published_at.toISOString()
  const mirrored = async (relation: number) => ((await client.sr_user_bookmark.findUniqueOrThrow({ where: { id: relation } })).metadata as any)?.bookmark?.published_at

  beforeAll(async () => {
    for (const name of ['publisher', 'other']) {
      const user = await client.sr_user.create({ data: { email: `${crypto.randomUUID()}@publisher.test`, name, created_at: new Date(), last_login_at: new Date() } })
      users.push(user.id)
    }
  })
  afterAll(async () => {
    await client.sr_user_bookmark.deleteMany({ where: { bookmark_id: { in: bookmarks } } })
    await client.sr_bookmark.deleteMany({ where: { id: { in: bookmarks } } })
    await client.sr_user.deleteMany({ where: { id: { in: users } } })
    await client.$disconnect()
  })

  it('sets the owner bookmark and mirrors it into the owner relation metadata', async () => {
    const { id, relation } = await bookmark(users[0])
    expect(await repo.setOwnerPublishedAt(id, users[0], original)).toBe(1)
    expect(await stored(id)).toBe(original.toISOString())
    expect(new Date(await mirrored(relation)).toISOString()).toBe(original.toISOString())
    expect(await repo.setOwnerPublishedAt(id, users[0], original)).toBe(0)
  })

  it('leaves another owner, a shared bookmark and an unfinished capture unchanged', async () => {
    const foreign = await bookmark(users[1])
    const shared = await bookmark(0)
    const pending = await bookmark(users[0], 'parseing')
    for (const { id } of [foreign, shared, pending]) {
      expect(await repo.setOwnerPublishedAt(id, users[0], original)).toBe(0)
      expect(await stored(id)).toBe(saved.toISOString())
    }
  })
})
