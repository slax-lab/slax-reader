/**
 * Real Postgres through the repository class: Prisma's JSON containment filter
 * (first use in this codebase), the raw untagged / candidate queries, and the
 * ownership rules on upsert. Runs only with RUN_PG_INTEGRATION_TESTS=1 after migrations.
 */
import 'dotenv/config'
import { randomUUID } from 'node:crypto'
import { Pool } from 'pg'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))

import { BookmarkRepo } from '@/infra/repository/dbBookmark'

const describePg = process.env.RUN_PG_INTEGRATION_TESTS === '1' ? describe : describe.skip

describePg('BookmarkRepo tag queries', () => {
  let pg: HyperdrivePrismaClient
  let repo: BookmarkRepo
  let userId = 0
  const token = randomUUID().slice(0, 8)

  beforeAll(async () => {
    pg = new HyperdrivePrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.HYPERDRIVE_DATABASE_URL, max: 1 })) })
    repo = new (BookmarkRepo as any)(() => null, () => pg) as BookmarkRepo
    const user = await pg.sr_user.create({ data: { email: `repo-${token}@example.test`, last_login_at: new Date(), created_at: new Date() } })
    userId = user.id
  })

  afterAll(async () => {
    if (userId) {
      await pg.sr_user_bookmark_tag.deleteMany({ where: { user_id: userId } })
      await pg.sr_user_bookmark.deleteMany({ where: { user_id: userId } })
      await pg.sr_user_tag.deleteMany({ where: { user_id: userId } })
      await pg.sr_user.delete({ where: { id: userId } })
    }
    await pg.$disconnect()
  })

  test('intersection, untagged, candidates and ownership', async () => {
    const now = new Date()
    const [b1, b2, b3] = await Promise.all(
      [1, 2, 3].map(i => pg.sr_bookmark.create({ data: { target_url: `https://example.test/${token}/${i}`, title: `t${i}`, created_at: now, updated_at: now, published_at: now } }))
    )
    for (const b of [b1, b2, b3]) await pg.sr_user_bookmark.create({ data: { user_id: userId, bookmark_id: b.id, updated_at: now } })

    const a = (await repo.createUserTag(userId, `a-${token}`, 'auto'))!
    const b = (await repo.createUserTag(userId, `b-${token}`, 'auto'))!
    const c = (await repo.createUserTag(userId, `c-${token}`, 'auto'))!

    // b1: a, b (ai) ; b2: a, b, c ; b3: none
    await repo.createBookmarkTag(b1.id, userId, a.id, a.tag_name, 'user')
    await repo.upsertBookmarkTags(b1.id, userId, [{ id: b.id, tag_name: b.tag_name }], 'ai')
    await repo.createBookmarkTag(b2.id, userId, a.id, a.tag_name, 'user')
    await repo.createBookmarkTag(b2.id, userId, b.id, b.tag_name, 'user')
    await repo.createBookmarkTag(b2.id, userId, c.id, c.tag_name, 'user')

    // Prisma array_contains on metadata.tags
    const ab = await repo.listUserBookmarksByTagIds(userId, [a.id, b.id], 0, 20)
    expect(ab.map(r => r.bookmark_id).sort()).toEqual([b1.id, b2.id].sort())
    expect(ab.find(r => r.bookmark_id === b1.id)!.sr_user_bookmark_tag.map(t => [t.tag_name, t.source]).sort()).toEqual([
      [a.tag_name, 'user'],
      [b.tag_name, 'ai']
    ])
    expect((await repo.listUserBookmarksByTagIds(userId, [a.id, c.id], 0, 20)).map(r => r.bookmark_id)).toEqual([b2.id])
    expect(await repo.listUserBookmarksByTagIds(userId, [a.id, 999999999], 0, 20)).toEqual([])

    // raw untagged
    expect((await repo.listUntaggedUserBookmarks(userId, 0, 20)).map(r => r.bookmark_id)).toEqual([b3.id])

    // candidates inside {a,b}: only c, once
    expect(await repo.countTagsWithinBookmarks(userId, [a.uuid, b.uuid], [a.id, b.id])).toEqual([{ tag_id: c.id, count: 1 }])

    // vocabulary order: last_used_at desc nulls last
    await repo.touchUserTagsLastUsed(userId, [c.id])
    const vocab = await repo.getUserTags(userId)
    expect(vocab[0].tag_name).toBe(c.tag_name)

    // AI-path upsert never revives; user path does
    await repo.deleteUserTag(userId, c.id)
    await repo.updateUserTagsDisplay(userId, [c.tag_name])
    expect((await repo.getUserTagById(userId, c.id))!.display).toBe(false)
    const revived = await repo.updateUserTagsDisplay(userId, [c.tag_name, `new-${token}`], true)
    expect((await repo.getUserTagById(userId, c.id))!.display).toBe(true)
    expect(revived.find(t => t.tag_name === `new-${token}`)!.source).toBe('mine')

    // claiming by typing the name flips auto to mine; an import write never demotes it
    expect((await repo.createUserTag(userId, a.tag_name))!.source).toBe('mine')
    expect((await repo.createUserTag(userId, a.tag_name, 'auto'))!.source).toBe('mine')
    expect((await repo.findUserTagByName(userId, a.tag_name.toUpperCase()))!.id).toBe(a.id)

    // soft delete drops the link from metadata.tags via the trigger
    await repo.softDeleteBookmarkTagsByTag(userId, b.id)
    expect(await repo.listUserBookmarksByTagIds(userId, [b.id], 0, 20)).toEqual([])
    expect((await repo.listUserBookmarksByTagIds(userId, [a.id], 0, 20)).length).toBe(2)

    // the AI must not re-attach what the user removed; the user re-adding it revives the link
    await repo.upsertBookmarkTags(b1.id, userId, [{ id: b.id, tag_name: b.tag_name }], 'ai')
    expect(await repo.listUserBookmarksByTagIds(userId, [b.id], 0, 20)).toEqual([])
    await repo.upsertBookmarkTags(b1.id, userId, [{ id: b.id, tag_name: b.tag_name }], 'user')
    const relinked = await repo.listUserBookmarksByTagIds(userId, [b.id], 0, 20)
    expect(relinked.map(r => r.bookmark_id)).toEqual([b1.id])
    expect(relinked[0].sr_user_bookmark_tag.find(t => t.tag_id === b.id)!.source).toBe("user")

    // AI name lookup: unknown and hidden words are dropped, nothing is created
    await repo.deleteUserTag(userId, c.id)
    const found = await repo.getUserTagsByNames(userId, [a.tag_name, c.tag_name, `ghost-${token}`])
    expect(found.map(t => t.tag_name)).toEqual([a.tag_name])
    expect(await pg.sr_user_tag.count({ where: { user_id: userId, tag_name: `ghost-${token}` } })).toBe(0)

    // import: new words are auto, links are user
    const imported = await repo.updateUserTagsDisplay(userId, [`import-${token}`], true, 'auto')
    expect(imported[0].source).toBe('auto')
  })
})
