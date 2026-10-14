/**
 * Real Postgres through MarkRepo.hasLiveMarksOnBookmark: marks of every reader of a shared
 * bookmark count, deleted marks do not. Runs only with RUN_PG_INTEGRATION_TESTS=1 after migrations.
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

import { MarkRepo } from '@/infra/repository/dbMark'

const describePg = process.env.RUN_PG_INTEGRATION_TESTS === '1' ? describe : describe.skip

describePg('MarkRepo on Postgres', () => {
  let pg: HyperdrivePrismaClient
  let repo: MarkRepo
  const token = randomUUID().slice(0, 8)
  const userIds: number[] = []
  let bookmarkId = 0
  let readerBookmarkId = 0

  beforeAll(async () => {
    pg = new HyperdrivePrismaClient({ adapter: new PrismaPg(new Pool({ connectionString: process.env.HYPERDRIVE_DATABASE_URL, max: 1 })) })
    repo = new (MarkRepo as any)(() => null, () => pg) as MarkRepo
    const now = new Date()
    for (const name of ['owner', 'reader']) {
      const user = await pg.sr_user.create({ data: { email: `marks-${name}-${token}@example.test`, last_login_at: now, created_at: now } })
      userIds.push(user.id)
    }
    const bookmark = await pg.sr_bookmark.create({ data: { target_url: `https://example.test/${token}`, created_at: now, updated_at: now, published_at: now } })
    bookmarkId = bookmark.id
    await pg.sr_user_bookmark.create({ data: { user_id: userIds[0], bookmark_id: bookmarkId, updated_at: now } })
    readerBookmarkId = (await pg.sr_user_bookmark.create({ data: { user_id: userIds[1], bookmark_id: bookmarkId, updated_at: now } })).id
  })

  afterAll(async () => {
    if (bookmarkId) {
      const ubs = await pg.sr_user_bookmark.findMany({ where: { bookmark_id: bookmarkId }, select: { id: true } })
      await pg.sr_bookmark_comment.deleteMany({ where: { bookmark_id: { in: ubs.map(ub => ub.id) } } })
      await pg.sr_user_bookmark.deleteMany({ where: { bookmark_id: bookmarkId } })
      await pg.sr_bookmark.delete({ where: { id: bookmarkId } })
    }
    if (userIds.length) await pg.sr_user.deleteMany({ where: { id: { in: userIds } } })
    await pg.$disconnect()
  })

  test("another reader's live mark counts; a deleted one does not", async () => {
    expect(await repo.hasLiveMarksOnBookmark(bookmarkId)).toBe(false)

    const mark = await pg.sr_bookmark_comment.create({ data: { user_id: userIds[1], bookmark_id: readerBookmarkId, type: 1, is_deleted: true, updated_at: new Date() } })
    expect(await repo.hasLiveMarksOnBookmark(bookmarkId)).toBe(false)

    await pg.sr_bookmark_comment.update({ where: { id: mark.id }, data: { is_deleted: false } })
    expect(await repo.hasLiveMarksOnBookmark(bookmarkId)).toBe(true)
  })
})
