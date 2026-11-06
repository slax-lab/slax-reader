import { describe, expect, it, vi } from 'vitest'
import { MediaBodyService } from '@/domain/mediaBody'
import { YoutubeArticleService } from '@/domain/youtubeArticle'
import type { youtubeArticlePO } from '@/infra/repository/dbYoutubeArticle'
import { memoryBucket } from '../utils/snapshotBucket'

const row = {
  id: 3,
  source_id: 'dQw4w9WgXcQ',
  source_hash: 'hash',
  target_language: 'en',
  status: 'ready',
  article_key: 'youtube/article.json',
  caption_key: 'youtube/captions.json',
  schema_version: 1,
  prompt_version: 1
} as unknown as youtubeArticlePO
const marker = (Object.create(YoutubeArticleService.prototype) as any).bodyMarker(row) as string
const mediaRef = { media_kind: 'youtube', source_id: row.source_id, source_hash: row.source_hash }

async function publicationFixture(status = 'success') {
  const memory = memoryBucket()
  const bookmark: any = {
    id: 1,
    content_key: 'html/body/owner.html',
    content_md_key: 'text/body/owner.txt',
    content_word_count: 3,
    updated_at: new Date('2026-01-01'),
    title: 'Saved',
    moderation_result: 0,
    status,
    private_user: 0
  }
  await memory.bucket.put(bookmark.content_key, '<article>Old</article>')
  await memory.bucket.put(bookmark.content_md_key, 'Old')
  const initialRevision = new Date(bookmark.updated_at)
  const repo: any = {
    claimWrite: vi.fn(async (_id: number, revision: Date, statuses: string[] = ['success']) => {
      if (revision.getTime() !== bookmark.updated_at.getTime() || !statuses.includes(bookmark.status)) return false
      bookmark.status = 'parseing'
      return true
    }),
    releaseWrite: vi.fn(async (_id: number, revision: Date) => {
      if (revision.getTime() !== bookmark.updated_at.getTime() || bookmark.status !== 'parseing') return false
      bookmark.status = 'success'
      bookmark.updated_at = new Date(bookmark.updated_at.getTime() + 1)
      return true
    }),
    failWrite: vi.fn(async (_id: number, revision: Date) => {
      if (revision.getTime() !== bookmark.updated_at.getTime() || bookmark.status !== 'parseing') return false
      bookmark.status = 'failed'
      return true
    }),
    publishRevision: vi.fn(async (_id: number, expected: string, content: any, options: any) => {
      if (expected !== bookmark.content_key || bookmark.status !== 'parseing') return false
      if (options.expectedUpdatedAt.getTime() !== bookmark.updated_at.getTime()) return false
      Object.assign(bookmark, content, { status: 'success', updated_at: new Date(bookmark.updated_at.getTime() + 1) })
      return true
    }),
    getUserBookmark: vi.fn(async () => ({ id: 1, uuid: 'relation', deleted_at: null, type: 0 })),
    source: vi.fn(async () => ({ deleted_at: null, bookmark_id: 1, bookmark: { updated_at: bookmark.updated_at } })),
    mediaRef: vi.fn(async () => mediaRef),
    mediaDenied: vi.fn(async () => false)
  }
  const summary = vi.fn(async () => {})
  const search = vi.fn(async () => [])
  const bodies = new MediaBodyService(
    { getBookmarkById: async () => ({ ...bookmark }) } as any,
    { deleteBookmarkSummary: summary, getUserBookmark: repo.getUserBookmark } as any,
    { addSearchRecord: search } as any,
    { bodyHasMarks: async () => false } as any,
    (() => ({ R2Bucket: memory.bucket })) as any,
    repo as any
  )
  const ctx: any = { env: {} }
  const write = () => bodies.writeBody(ctx, 1, 7, { html: `<article ${marker}>New</article>`, text: 'New body' })
  return { memory, bookmark, initialRevision, repo, summary, search, bodies, ctx, write }
}

describe('publication failure and recovery', () => {
  it.each([
    ['throws', async () => Promise.reject(new Error('db_publication_failed'))],
    ['returns false', async () => false]
  ])('keeps uncommitted bodies failed when the database publication %s', async (_label, rejectOrFalse) => {
    const f = await publicationFixture()
    f.repo.publishRevision.mockImplementation(rejectOrFalse as any)
    if (_label === 'throws') await expect(f.write()).rejects.toThrow('db_publication_failed')
    else expect(await f.write()).toBe(false)
    expect(f.bookmark.status).toBe('failed')
    expect(f.bookmark.content_word_count).toBe(3)
    expect(String(f.memory.objects.get(f.bookmark.content_key)?.value)).toContain(marker)
    expect(await f.bodies.readBody(1, true)).toBeNull()
    expect(f.repo.failWrite).toHaveBeenCalledWith(1, f.initialRevision)
    expect(f.repo.releaseWrite).not.toHaveBeenCalled()
    expect(f.summary).not.toHaveBeenCalled()
    expect(f.search).not.toHaveBeenCalled()
  })

  it('repairs a failed legacy publication from cached artifacts without another generation', async () => {
    const f = await publicationFixture()
    f.repo.publishRevision.mockRejectedValueOnce(new Error('db_publication_failed'))
    await expect(f.write()).rejects.toThrow('db_publication_failed')
    expect(f.bookmark.status).toBe('failed')
    expect(await f.bodies.readBody(1, true)).toBeNull()

    const youtube = Object.assign(Object.create(YoutubeArticleService.prototype), {
      snapshots: {
        load: vi.fn(async () => ({ raw: { ...f.bookmark }, media: null, managed: false })),
        processVectorMaintenance: vi.fn(async () => {})
      },
      bodies: f.bodies,
      labService: { isEnabled: async () => true },
      languageOf: async () => 'en',
      renderBody: async () => ({ html: `<article ${marker}>New</article>`, text: 'New body' })
    }) as YoutubeArticleService
    expect(await (youtube as any).publishBodyFor(f.ctx, 1, 7, row)).toBe(true)
    expect(f.bookmark.status).toBe('success')
    expect(f.bookmark.content_word_count).toBe(8)
    expect(f.summary).toHaveBeenCalledOnce()
    expect(f.search).toHaveBeenCalledOnce()
    expect((await f.bodies.readBody(1, true))?.includes(marker)).toBe(true)
    expect(await (youtube as any).publishBodyFor(f.ctx, 1, 7, row)).toBe(false)
    expect(f.summary).toHaveBeenCalledOnce()
  })

  it('does not downgrade a committed publication when only its acknowledgement is lost', async () => {
    const f = await publicationFixture()
    f.repo.publishRevision.mockImplementation(async (_id: number, _expected: string, content: any, options: any) => {
      if (f.bookmark.status !== 'parseing' || options.expectedUpdatedAt.getTime() !== f.bookmark.updated_at.getTime()) return false
      Object.assign(f.bookmark, content, { status: 'success', updated_at: new Date(f.bookmark.updated_at.getTime() + 1) })
      throw new Error('ack lost')
    })
    await expect(f.write()).rejects.toThrow('ack lost')
    expect(f.bookmark.status).toBe('success')
    expect(f.bookmark.content_word_count).toBe(8)
    expect(f.repo.failWrite).toHaveBeenCalledWith(1, f.initialRevision)
    expect(f.repo.releaseWrite).not.toHaveBeenCalled()
  })

  it.each([
    ['partial HTML', async (key: string) => (key === 'html/body/owner.html' ? null : undefined)],
    ['rejected HTML', async (key: string) => (key === 'html/body/owner.html' ? Promise.reject(new Error('html rejected')) : undefined)]
  ])('keeps the row failed after a %s PUT', async (_label, fail) => {
    const f = await publicationFixture()
    const put = f.memory.bucket.put.bind(f.memory.bucket)
    vi.spyOn(f.memory.bucket, 'put').mockImplementation(async (key, value, options) => {
      const result = await fail(key)
      if (result !== undefined) return result
      return put(key, value, options)
    })
    await expect(f.write()).rejects.toThrow()
    expect(f.bookmark.status).toBe('failed')
    expect(f.bookmark.content_word_count).toBe(3)
    expect(f.repo.publishRevision).not.toHaveBeenCalled()
    expect(f.repo.failWrite).toHaveBeenCalledWith(1, f.initialRevision)
    expect(f.summary).not.toHaveBeenCalled()
  })

  it('admits maintenance after recovery without starting a new article generation', async () => {
    const f = await publicationFixture('failed')
    const processVectorMaintenance = vi.fn(async () => {})
    const takeDaily = vi.fn(async () => true)
    const start = vi.fn(async () => 'started')
    const service = Object.assign(Object.create(YoutubeArticleService.prototype), {
      snapshots: {
        load: vi.fn(async () => ({ raw: { ...f.bookmark, status: 'failed' }, media: null, managed: false })),
        processVectorMaintenance
      },
      bodies: { readBody: vi.fn(async () => null), writeBody: vi.fn(async () => true), hasMarks: vi.fn(async () => false) },
      labService: { isEnabled: async () => true },
      languageOf: async () => 'en',
      renderBody: async () => ({ html: `<article ${marker}>New</article>`, text: 'New body' }),
      repo: { findRef: async () => ({ source_id: row.source_id, source_hash: row.source_hash }), findVersion: async () => row, listForSource: async () => [row] },
      takeDaily,
      start
    }) as YoutubeArticleService
    await service.triggerAfterCrawl(f.ctx as any, 1, 7, 'Saved')
    expect(processVectorMaintenance).toHaveBeenCalledOnce()
    expect(takeDaily).not.toHaveBeenCalled()
    expect(start).not.toHaveBeenCalled()
  })
})
