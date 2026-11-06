import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '@prisma/hyperdrive-client'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { BookmarkService } from '@/domain/bookmark'
import { MediaBodyService } from '@/domain/mediaBody'
import { MediaSnapshotService } from '@/domain/mediaSnapshot'
import { memoryBucket } from '../utils/snapshotBucket'

const url = process.env.FORK_TEST_DATABASE_URL
describe.runIf(!!url)('media publication recovery against PostgreSQL', () => {
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) })
  const fork = new BookmarkForkRepo(() => client)
  const bookmarks = new BookmarkRepo({} as any, () => client)
  const memory = memoryBucket()
  const users: number[] = []
  const raws: number[] = []
  const marker = 'data-slax-derived="youtube-article" data-article-version="runtime-en-1-v1"'
  let user = 0

  beforeAll(async () => {
    const created = await client.sr_user.create({ data: { email: `${crypto.randomUUID()}@media.test`, name: 'media', created_at: new Date(), last_login_at: new Date() } })
    user = created.id
    users.push(user)
  })

  afterAll(async () => {
    await client.sr_bookmark_summary.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_media_article_ref.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_user_bookmark.deleteMany({ where: { user_id: { in: users } } })
    await client.sr_bookmark.deleteMany({ where: { id: { in: raws } } })
    await client.sr_user.deleteMany({ where: { id: { in: users } } })
    await client.$disconnect()
  })

  async function row(status = 'success') {
    const suffix = crypto.randomUUID()
    const bookmark = await client.sr_bookmark.create({
      data: {
        title: 'Runtime media',
        target_url: `https://example.com/media-runtime/${suffix}`,
        private_user: 0,
        status,
        content_key: `html/body/runtime-${suffix}.html`,
        content_md_key: `text/body/runtime-${suffix}.txt`,
        content_word_count: 2,
        created_at: new Date(),
        updated_at: new Date(),
        published_at: new Date()
      }
    })
    raws.push(bookmark.id)
    await client.sr_user_bookmark.create({ data: { user_id: user, bookmark_id: bookmark.id, updated_at: new Date() } })
    await memory.bucket.put(bookmark.content_key, '<article>Old</article>')
    await memory.bucket.put(bookmark.content_md_key, 'Old')
    return bookmark
  }

  function bodies() {
    const bookmarkService = Object.assign(Object.create(BookmarkService.prototype), { bookmarkRepo: bookmarks }) as BookmarkService
    const summary = vi.spyOn(bookmarks, 'deleteBookmarkSummary')
    const search = vi.fn(async () => [{ status: 'fulfilled' as const, value: [] }])
    const bodyService = new MediaBodyService(
      bookmarkService,
      bookmarks,
      { addSearchRecord: search } as any,
      { bodyHasMarks: vi.fn(async () => false) } as any,
      (() => ({ R2Bucket: memory.bucket })) as any,
      fork
    )
    return { bodyService, bookmarkService, summary, search }
  }

  function snapshots(create = vi.fn(async () => ({}))) {
    const service = Object.assign(Object.create(MediaSnapshotService.prototype), {
      repo: fork,
      bucket: () => ({ R2Bucket: memory.bucket }),
      vectors: {
        listContentOwners: vi.fn(async (_bookmarkId: number, after: number) => (after > 0 ? [] : [{ id: 1, user_id: user }])),
        findArticles: vi.fn(async (identities: { userId: number; id: number }[]) =>
          identities.map(identity => ({ user_id: identity.userId, bookmark_id: identity.id, status: 'success' }))
        )
      }
    }) as MediaSnapshotService
    const ctx = { getUserId: () => user, env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { create } } } as any
    return { service, ctx, create }
  }

  it('never admits a pre-commit failure, then publishes and admits after cached recovery', async () => {
    const bookmark = await row()
    const ref = { media_kind: 'youtube' as const, source_id: `runtime-${bookmark.id}`, source_hash: 'hash' }
    await client.sr_media_article_ref.create({ data: { bookmark_id: bookmark.id, user_id: user, ...ref } })
    const ctx = { getUserId: () => user, env: {} } as any
    const f = bodies()
    const body = { html: `<article ${marker}>New</article>`, text: 'New body' }
    const original = fork.publishRevision.bind(fork)
    ;(fork as any).publishRevision = vi.fn(async () => {
      throw new Error('db_commit_failed')
    })
    await expect(f.bodyService.writeBody(ctx, bookmark.id, user, body, { mediaRef: ref })).rejects.toThrow('db_commit_failed')
    const failed = await client.sr_bookmark.findUniqueOrThrow({ where: { id: bookmark.id } })
    expect(failed).toMatchObject({ status: 'failed', content_word_count: 2 })
    expect(await f.bodyService.readBody(bookmark.id, true)).toBeNull()
    expect(String(memory.objects.get(bookmark.content_key)?.value)).toContain(marker)
    expect(f.summary).not.toHaveBeenCalled()
    expect(f.search).not.toHaveBeenCalled()

    const before = snapshots()
    await before.service.processVectorMaintenance(before.ctx, bookmark.id, { kind: 'youtube', sourceId: ref.source_id, sourceHash: ref.source_hash })
    expect(before.create).not.toHaveBeenCalled()

    ;(fork as any).publishRevision = original
    await expect(f.bodyService.writeBody(ctx, bookmark.id, user, body, { mediaRef: ref })).resolves.toBe(true)
    expect(await client.sr_bookmark.findUniqueOrThrow({ where: { id: bookmark.id } })).toMatchObject({ status: 'success', content_word_count: 8 })
    expect(await f.bodyService.readBody(bookmark.id, true)).toContain(marker)
    expect(f.summary).toHaveBeenCalledOnce()
    expect(f.search).toHaveBeenCalledOnce()

    const after = snapshots()
    await after.service.processVectorMaintenance(after.ctx, bookmark.id, { kind: 'youtube', sourceId: ref.source_id, sourceHash: ref.source_hash })
    expect(after.create).toHaveBeenCalledOnce()
    expect(after.create).toHaveBeenLastCalledWith(expect.objectContaining({ params: expect.objectContaining({ target: { kind: 'article', userId: user, id: bookmark.id } }) }))
  })

  it('keeps a committed success when only the acknowledgement is lost, and admits from that state', async () => {
    const bookmark = await row()
    const ref = { media_kind: 'youtube' as const, source_id: `runtime-ack-${bookmark.id}`, source_hash: 'hash' }
    await client.sr_media_article_ref.create({ data: { bookmark_id: bookmark.id, user_id: user, ...ref } })
    const ctx = { getUserId: () => user, env: {} } as any
    const f = bodies()
    const original = fork.publishRevision.bind(fork)
    ;(fork as any).publishRevision = vi.fn(async (...args: Parameters<typeof original>) => {
      const published = await original(...args)
      if (published) throw new Error('ack_lost')
      return published
    })
    await expect(f.bodyService.writeBody(ctx, bookmark.id, user, { html: `<article ${marker}>Ack</article>`, text: 'Ack body' }, { mediaRef: ref })).rejects.toThrow('ack_lost')
    const committed = await client.sr_bookmark.findUniqueOrThrow({ where: { id: bookmark.id } })
    expect(committed).toMatchObject({ status: 'success', content_word_count: 8 })
    expect(await f.bodyService.readBody(bookmark.id, true)).toContain(marker)
    expect(f.summary).not.toHaveBeenCalled()
    ;(fork as any).publishRevision = original

    const admission = snapshots()
    await admission.service.processVectorMaintenance(admission.ctx, bookmark.id, { kind: 'youtube', sourceId: ref.source_id, sourceHash: ref.source_hash })
    expect(admission.create).toHaveBeenCalledOnce()
  })

  it('keeps the row failed and fixed files uncommitted when the HTML PUT is rejected', async () => {
    const bookmark = await row()
    const ctx = { getUserId: () => user, env: {} } as any
    const f = bodies()
    const put = memory.bucket.put.bind(memory.bucket)
    vi.spyOn(memory.bucket, 'put').mockImplementation(async (key, value, options) => (key === bookmark.content_key ? null : put(key, value, options)))
    await expect(f.bodyService.writeBody(ctx, bookmark.id, user, { html: `<article ${marker}>Partial</article>`, text: 'Partial body' })).rejects.toThrow('Media HTML write failed')
    const current = await client.sr_bookmark.findUniqueOrThrow({ where: { id: bookmark.id } })
    expect(current).toMatchObject({ status: 'failed', content_word_count: 2 })
    expect(String(memory.objects.get(bookmark.content_key)?.value)).toContain('Old')
    expect(f.summary).not.toHaveBeenCalled()
    expect(f.search).not.toHaveBeenCalled()
  })
})
