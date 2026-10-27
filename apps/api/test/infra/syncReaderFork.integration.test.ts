import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/hyperdrive-client'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'
import { BookmarkForkService } from '@/domain/bookmarkFork'
import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'
import { SyncOrchestrator, type SyncChangeItem } from '@/domain/orchestrator/sync'
import { createMockCtx } from '../helpers/mockFactory'

const url = process.env.FORK_TEST_DATABASE_URL
describe.runIf(!!url)('PowerSync Reader admission against PostgreSQL', () => {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  const repo = new BookmarkForkRepo(() => client)
  const dbSyncBatch = new DBSyncBatchOperation(() => client)
  const users: number[] = []
  const search = { clearSearchCache: vi.fn(async () => {}) }
  const service = Object.assign(Object.create(BookmarkForkService.prototype), {
    repo, search, labs: { assertUrlAllowed: vi.fn(async () => {}), assertEnabled: vi.fn(async () => {}) }
  }) as BookmarkForkService
  const orchestrator = Object.assign(Object.create(SyncOrchestrator.prototype), {
    userService: { getUserInfo: vi.fn(async () => ({ uuid: 'destination-user' })) },
    dbSyncBatch, forkService: service, searchService: search, logsService: { track: vi.fn(async () => {}) }
  }) as SyncOrchestrator
  const row = (uuid: string) => client.sr_user_bookmark.findUniqueOrThrow({ where: { uuid }, include: { bookmark: true } })
  const put = (source: string, uuid = crypto.randomUUID()): SyncChangeItem => ({
    table: 'sr_user_bookmark', id: uuid, op: 'PUT',
    data: { metadata: JSON.stringify({ bookmark: { target_url: `https://reader.test/b/${source}`, title: 'Reader URL' } }) }
  })
  const edit = (uuid: string): SyncChangeItem => ({ table: 'sr_user_bookmark', id: uuid, op: 'PATCH', data: { is_starred: '1', alias_title: 'My title' } })
  const source = async () => {
    const now = new Date()
    const bookmark = await client.sr_bookmark.create({ data: {
      target_url: `https://example.com/${crypto.randomUUID()}`, private_user: users[0], status: 'success', title: 'Source title',
      created_at: now, updated_at: now, published_at: now, content_key: 'html/body/source.html'
    } })
    return client.sr_user_bookmark.create({ data: { user_id: users[0], bookmark_id: bookmark.id, updated_at: now } })
  }
  const context = () => {
    const ctx = createMockCtx({ userId: users[1] })
    ctx.env.FRONT_END_URL = 'https://reader.test'
    ctx.env.CRAWL_WORKFLOW.get = vi.fn(async () => ({ status: async () => ({ status: 'queued' }) }))
    return ctx
  }
  beforeAll(async () => {
    for (const name of ['source', 'destination']) {
      const user = await client.sr_user.create({ data: { email: `${crypto.randomUUID()}@sync-fork.test`, name, created_at: new Date(), last_login_at: new Date() } })
      users.push(user.id)
    }
  })
  afterAll(async () => {
    await client.sr_bookmark_share.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_user_bookmark.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_bookmark.deleteMany({ where: { private_user: { in: users } } })
    await client.sr_user.deleteMany({ where: { id: { in: users } } })
    await client.$disconnect()
  })

  it('commits the supplied UUID before dispatch and applies a later personal edit to it', async () => {
    const original = await source(), create = put(original.uuid), ctx = context()
    ctx.env.CRAWL_WORKFLOW.create.mockImplementation(async ({ params }: any) => {
      expect((await row(create.id)).bookmark.status).toBe('parseing')
      expect(params.fork).toMatchObject({ sourceId: original.id, destinationUuid: create.id })
    })
    await orchestrator.syncChanges(ctx, [create, edit(create.id)])
    expect(await row(create.id)).toMatchObject({ user_id: users[1], forked_from_id: original.id, is_starred: true, alias_title: 'My title' })
    expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledOnce()
  })

  it('replays an active save without another task and refreshes a completed save without changing its UUID', async () => {
    const original = await source(), create = put(original.uuid), ctx = context()
    await orchestrator.syncChanges(ctx, [create, edit(create.id)])
    await orchestrator.syncChanges(ctx, [create])
    expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledOnce()
    const existing = await row(create.id)
    await client.sr_bookmark.update({ where: { id: existing.bookmark_id }, data: { status: 'success' } })
    const repeat = put(original.uuid)
    await orchestrator.syncChanges(ctx, [repeat])
    expect(await client.sr_user_bookmark.findUnique({ where: { uuid: repeat.id } })).toBeNull()
    expect(await row(create.id)).toMatchObject({ is_starred: true, alias_title: 'My title', bookmark: { status: 'parseing' } })
    expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledTimes(2)
  })

  it('keeps a denied source as a stable failed save with editable local UUID', async () => {
    const original = await source(), create = put(original.uuid), ctx = context()
    await client.sr_bookmark_share.create({ data: { bookmark_id: original.bookmark_id, user_id: users[0], is_enable: false, share_code: crypto.randomUUID() } })
    await orchestrator.syncChanges(ctx, [create, edit(create.id)])
    expect(await row(create.id)).toMatchObject({ forked_from_id: null, is_starred: true, bookmark: { status: 'failed', content_key: '' } })
    await client.sr_bookmark_share.updateMany({ where: { bookmark_id: original.bookmark_id }, data: { is_enable: true } })
    await orchestrator.syncChanges(ctx, [create])
    expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
    expect((await row(create.id)).bookmark.status).toBe('failed')
  })

  it.each(['revoked', 'deleted'])('acknowledges a persisted create after the source is %s and applies following edits', async condition => {
    const original = await source(), create = put(original.uuid), ctx = context()
    await orchestrator.syncChanges(ctx, [create])
    if (condition === 'revoked') {
      await client.sr_bookmark_share.create({ data: { bookmark_id: original.bookmark_id, user_id: users[0], is_enable: false, share_code: crypto.randomUUID() } })
    } else {
      await client.sr_user_bookmark.update({ where: { id: original.id }, data: { deleted_at: new Date() } })
    }
    await orchestrator.syncChanges(ctx, [create, edit(create.id)])
    expect(await row(create.id)).toMatchObject({ forked_from_id: original.id, is_starred: true, alias_title: 'My title', bookmark: { status: 'parseing' } })
    expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledOnce()
    expect(await client.sr_user_bookmark.count({ where: { user_id: users[1], uuid: create.id } })).toBe(1)
  })

  it('acknowledges concurrent device saves with one destination and one copy task', async () => {
    const original = await source(), ctx = context()
    await Promise.all([orchestrator.syncChanges(ctx, [put(original.uuid)]), orchestrator.syncChanges(ctx, [put(original.uuid)])])
    const copies = await client.sr_user_bookmark.findMany({ where: { user_id: users[1], forked_from_id: original.id } })
    expect(copies).toHaveLength(1)
    expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledOnce()
  })

  it('does not acknowledge a client UUID owned by another account or leave an orphan destination', async () => {
    const original = await source(), ctx = context()
    await expect(orchestrator.syncChanges(ctx, [put(original.uuid, original.uuid)])).rejects.toThrow()
    expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
    expect(await client.sr_bookmark.count({ where: { private_user: users[1], target_url: (await row(original.uuid)).bookmark.target_url } })).toBe(0)
  })
})
