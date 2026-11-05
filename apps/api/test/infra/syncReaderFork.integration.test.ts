import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/hyperdrive-client'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'
import { BookmarkForkService } from '@/domain/bookmarkFork'
import { LabService } from '@/domain/lab'
import { LabRepo } from '@/infra/repository/dbLab'
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
    dbSyncBatch, forkService: service, searchService: search, logsService: { track: vi.fn(async () => {}) },
    bookmarkSearchRepo: { upsertUserBookmark: vi.fn(async () => {}) },
    ga4Client: { trackEvent: vi.fn(async () => {}) },
    crawlService: { createWorkflow: async (env: any, params: unknown) => env.CRAWL_WORKFLOW.create({ params }) }
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
  const context = (userId = users[1]) => {
    const ctx = createMockCtx({ userId })
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
    await client.sr_user_lab_feature.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_media_article_ref.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_bookmark_share.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_user_bookmark.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_bookmark.deleteMany({ where: { private_user: { in: users } } })
    await client.sr_user.deleteMany({ where: { id: { in: users } } })
    await client.$disconnect()
  })

  it('commits the supplied UUID before dispatch and applies a later personal edit to it', async () => {
    const original = await source(), create = put(original.uuid), ctx = context()
    const visible: unknown[] = []
    ctx.env.CRAWL_WORKFLOW.create.mockImplementation(async () => { visible.push(await row(create.id)) })
    await orchestrator.syncChanges(ctx, [create, edit(create.id)])
    expect(await row(create.id)).toMatchObject({ user_id: users[1], forked_from_id: original.id, is_starred: true, alias_title: 'My title' })
    expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledOnce()
    expect(visible).toMatchObject([{ is_starred: true, alias_title: 'My title', bookmark: { status: 'parseing' } }])
    expect(ctx.env.CRAWL_WORKFLOW.create.mock.calls[0][0].params.fork).toMatchObject({ sourceId: original.id, destinationUuid: create.id })
  })

  it.each(['pdf', 'youtube', 'podcast'])('checks %s Labs permission inside the transaction with the runtime single-connection pool', async feature => {
    const single = new PrismaClient({ adapter: new PrismaPg({ connectionString: url, max: 1, connectionTimeoutMillis: 1_000 }) })
    try {
      const original = await source(), create = put(original.uuid), ctx = context()
      if (feature === 'pdf') {
        await client.sr_bookmark.update({ where: { id: original.bookmark_id }, data: { content_key: 'pdf/body/source.pdf' } })
        await client.sr_user_bookmark.update({ where: { id: original.id }, data: { type: 2 } })
      } else if (feature === 'youtube') {
        await client.sr_bookmark.update({ where: { id: original.bookmark_id }, data: { target_url: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ' } })
      } else {
        await client.sr_media_article_ref.create({ data: { bookmark_id: original.bookmark_id, user_id: users[0], media_kind: 'podcast', source_id: crypto.randomUUID(), source_hash: 'source' } })
      }
      await client.sr_user_lab_feature.create({ data: { user_id: users[1], feature, enabled: true } })
      const gatedService = Object.assign(Object.create(BookmarkForkService.prototype), {
        repo: new BookmarkForkRepo(() => single), search, labs: new LabService(new LabRepo(() => single))
      }) as BookmarkForkService
      const gatedSync = Object.assign(Object.create(SyncOrchestrator.prototype), orchestrator, {
        dbSyncBatch: new DBSyncBatchOperation(() => single), forkService: gatedService
      }) as SyncOrchestrator
      await gatedSync.syncChanges(ctx, [create, edit(create.id)])
      expect(await row(create.id)).toMatchObject({ forked_from_id: original.id, is_starred: true })
      expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledOnce()
    } finally { await single.$disconnect() }
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

  it.each([false, true])('preserves a new Reader PUT archive flag and respects a later override: %s', async override => {
    const original = await source(), create = put(original.uuid), ctx = context()
    create.data!.archive_status = '1'
    const batch: SyncChangeItem[] = [create]
    if (override) batch.push({ table: 'sr_user_bookmark', id: create.id, op: 'PATCH', data: { archive_status: '0' } })
    const visible: number[] = []
    ctx.env.CRAWL_WORKFLOW.create.mockImplementation(async () => { visible.push((await row(create.id)).archive_status) })
    await orchestrator.syncChanges(ctx, batch)
    expect((await row(create.id)).archive_status).toBe(override ? 0 : 1)
    expect(visible).toEqual([override ? 0 : 1])
  })

  it.each(['new', 'success', 'failed'])('rolls back an ordinary %s save and Fork when a later mutation fails, then retries the same batch', async status => {
    const original = await source(), create = put(original.uuid), ctx = context()
    const ordinaryUuid = crypto.randomUUID(), ordinaryUrl = `https://ordinary.test/${ordinaryUuid}`
    const ordinary: SyncChangeItem = { table: 'sr_user_bookmark', id: ordinaryUuid, op: 'PUT', data: { metadata: JSON.stringify({ bookmark: { target_url: ordinaryUrl, title: 'Ordinary' } }) } }
    const missingUuid = crypto.randomUUID()
    let previous: Awaited<ReturnType<typeof row>> | null = null
    if (status !== 'new') {
      const then = new Date('2025-01-01T00:00:00Z')
      const raw = await client.sr_bookmark.create({ data: { target_url: ordinaryUrl, private_user: users[1], status, title: 'Keep my content', content_key: 'html/body/kept.html', created_at: then, updated_at: then, published_at: then } })
      await client.sr_user_bookmark.create({ data: { uuid: ordinaryUuid, user_id: users[1], bookmark_id: raw.id, archive_status: 1, created_at: then, updated_at: then } })
      previous = await row(ordinaryUuid)
    }
    const batch = [ordinary, create, edit(missingUuid)]
    await expect(orchestrator.syncChanges(ctx, batch)).rejects.toThrow()
    expect(await client.sr_user_bookmark.findUnique({ where: { uuid: ordinaryUuid }, include: { bookmark: true } })).toEqual(previous)
    expect(await client.sr_user_bookmark.findUnique({ where: { uuid: create.id } })).toBeNull()
    expect(await client.sr_bookmark.count({ where: { private_user: users[1], target_url: (await row(original.uuid)).bookmark.target_url } })).toBe(0)
    expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
    // Repair the later missing edit target; replay the identical upload.
    const target = await client.sr_bookmark.create({ data: { target_url: `https://edit.test/${missingUuid}`, private_user: users[1], status: 'success', title: 'Edit target', created_at: new Date(), updated_at: new Date(), published_at: new Date() } })
    await client.sr_user_bookmark.create({ data: { uuid: missingUuid, user_id: users[1], bookmark_id: target.id, updated_at: new Date() } })
    await orchestrator.syncChanges(ctx, batch)
    expect((await row(missingUuid)).is_starred).toBe(true)
    expect((await row(create.id)).forked_from_id).toBe(original.id)
    expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledTimes(2)
    expect(await client.sr_bookmark.count({ where: { private_user: users[1], target_url: ordinaryUrl } })).toBe(1)
  })

  it('rolls back a completed Fork refresh and personal changes when a later edit fails', async () => {
    const original = await source(), create = put(original.uuid), ctx = context()
    await orchestrator.syncChanges(ctx, [create])
    const saved = await row(create.id)
    await client.sr_bookmark.update({ where: { id: saved.bookmark_id }, data: { status: 'success', content_key: 'html/body/kept-fork.html' } })
    const before = await row(create.id)
    ctx.env.CRAWL_WORKFLOW.create.mockClear()
    await expect(orchestrator.syncChanges(ctx, [edit(create.id), put(original.uuid), edit(crypto.randomUUID())])).rejects.toThrow()
    expect(await row(create.id)).toEqual(before)
    expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
  })

  it.each(['P2002', 'P2034'])('discards rolled-back dispatches when the whole mixed transaction retries %s', async code => {
    const original = await source(), create = put(original.uuid), ctx = context()
    const ordinaryUuid = crypto.randomUUID(), ordinaryUrl = `https://retry.test/${ordinaryUuid}`
    const ordinary: SyncChangeItem = { table: 'sr_user_bookmark', id: ordinaryUuid, op: 'PUT', data: { metadata: JSON.stringify({ bookmark: { target_url: ordinaryUrl, title: 'Retry' } }) } }
    const update = dbSyncBatch.executeUpdateBookmark.bind(dbSyncBatch)
    const conflict = vi.spyOn(dbSyncBatch, 'executeUpdateBookmark').mockImplementationOnce(async () => { throw Object.assign(new Error('transaction conflict'), { code }) }).mockImplementation(update)
    try {
      await orchestrator.syncChanges(ctx, [ordinary, create, edit(create.id)])
      const saved = await row(create.id)
      expect(saved.is_starred).toBe(true)
      expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledTimes(2)
      const forks = ctx.env.CRAWL_WORKFLOW.create.mock.calls.map(([job]: any[]) => job.params).filter((params: any) => params.fork)
      expect(forks).toMatchObject([{ bookmarkId: saved.bookmark_id, fork: { destinationId: saved.id, destinationUuid: saved.uuid } }])
      expect(await client.sr_bookmark.count({ where: { private_user: users[1], target_url: ordinaryUrl } })).toBe(1)
    } finally { conflict.mockRestore() }
  })

  it('rolls back a rejected-source placeholder together with ordinary saves', async () => {
    const original = await source(), create = put(original.uuid), ctx = context()
    await client.sr_bookmark_share.create({ data: { bookmark_id: original.bookmark_id, user_id: users[0], is_enable: false, share_code: crypto.randomUUID() } })
    await expect(orchestrator.syncChanges(ctx, [create, edit(crypto.randomUUID())])).rejects.toThrow()
    expect(await client.sr_user_bookmark.findUnique({ where: { uuid: create.id } })).toBeNull()
    expect(await client.sr_bookmark.count({ where: { private_user: users[1], target_url: { contains: create.id } } })).toBe(0)
    expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
  })

  it('restores an own-source save within the batch and rolls it back if a later edit fails', async () => {
    const original = await source(), ctx = context(users[0])
    await client.sr_user_bookmark.update({ where: { id: original.id }, data: { deleted_at: new Date() } })
    const before = await row(original.uuid)
    await expect(orchestrator.syncChanges(ctx, [put(original.uuid), edit(crypto.randomUUID())])).rejects.toThrow()
    expect(await row(original.uuid)).toEqual(before)
    await orchestrator.syncChanges(ctx, [put(original.uuid), edit(original.uuid)])
    expect(await row(original.uuid)).toMatchObject({ deleted_at: null, is_starred: true })
    expect(ctx.env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
  })

  it('reads a source created earlier in the same transaction instead of creating a missing-source failure', async () => {
    const ctx = context(), ownUuid = crypto.randomUUID()
    const ordinary: SyncChangeItem = { table: 'sr_user_bookmark', id: ownUuid, op: 'PUT', data: { metadata: JSON.stringify({ bookmark: { target_url: `https://own-source.test/${ownUuid}`, title: 'Own pending source' } }) } }
    const reader = put(ownUuid)
    await orchestrator.syncChanges(ctx, [ordinary, reader])
    expect(await row(ownUuid)).toMatchObject({ bookmark: { status: 'pending' } })
    expect(await client.sr_user_bookmark.findUnique({ where: { uuid: reader.id } })).toBeNull()
    expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledOnce()
  })

  it('does not replay committed mutations when post-commit dispatch cannot be confirmed', async () => {
    const original = await source(), create = put(original.uuid), ctx = context()
    ctx.env.CRAWL_WORKFLOW.create.mockRejectedValue(new Error('dispatch unavailable'))
    ctx.env.CRAWL_WORKFLOW.get.mockRejectedValue(new Error('lookup unavailable'))
    await orchestrator.syncChanges(ctx, [create, edit(create.id)])
    expect(await row(create.id)).toMatchObject({ is_starred: true, bookmark: { status: 'parseing' } })
    await orchestrator.syncChanges(ctx, [create])
    expect(ctx.env.CRAWL_WORKFLOW.create).toHaveBeenCalledOnce()
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
