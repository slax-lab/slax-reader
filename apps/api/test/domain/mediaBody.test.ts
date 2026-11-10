import { describe, expect, it, vi } from 'vitest'
import { MediaBodyService } from '@/domain/mediaBody'
import { SnapshotBundle } from '@/utils/snapshotBundle'
import { memoryBucket } from '../utils/snapshotBucket'

type FixtureOptions = {
  status?: string
  moderation?: number
  relation?: { id: number; uuid: string; deleted_at: Date | null; type: number } | null
  sourceUpdatedAt?: Date | null
  mediaRef?: { media_kind: string; source_id: string; source_hash: string } | null
  denied?: boolean
}

async function fixture(options: FixtureOptions = {}) {
  const memory = memoryBucket()
  const bookmark: any = {
    id: 1,
    content_key: 'html/body/owner.html',
    content_md_key: 'text/body/owner.txt',
    content_word_count: 3,
    updated_at: new Date('2026-01-01'),
    title: 'Saved',
    moderation_result: options.moderation ?? 0,
    status: options.status ?? 'success',
    private_user: 0
  }
  await memory.bucket.put(bookmark.content_key, '<article>Old</article>')
  await memory.bucket.put(bookmark.content_md_key, 'Old')
  const initialRevision = new Date(bookmark.updated_at)
  const relation = options.relation === undefined ? { id: 1, uuid: 'relation', deleted_at: null, type: 0 } : options.relation
  const source =
    relation === null || options.sourceUpdatedAt === null
      ? null
      : { deleted_at: null, bookmark_id: 1, bookmark: { updated_at: options.sourceUpdatedAt ?? bookmark.updated_at } }
  const mediaRef = options.mediaRef === undefined ? { media_kind: 'youtube', source_id: 'video', source_hash: 'hash' } : options.mediaRef
  const repo: any = {
    claimWrite: vi.fn(async (id: number, revision: Date, statuses: string[] = ['success']) => {
      if (id !== bookmark.id || revision.getTime() !== bookmark.updated_at.getTime() || !statuses.includes(bookmark.status)) return false
      bookmark.status = 'parseing'
      return true
    }),
    releaseWrite: vi.fn(async (id: number, revision: Date) => {
      if (id !== bookmark.id || revision.getTime() !== bookmark.updated_at.getTime() || bookmark.status !== 'parseing') return false
      bookmark.status = 'success'
      bookmark.updated_at = new Date(bookmark.updated_at.getTime() + 1)
      return true
    }),
    failWrite: vi.fn(async (id: number, revision: Date) => {
      if (id !== bookmark.id || revision.getTime() !== bookmark.updated_at.getTime() || bookmark.status !== 'parseing') return false
      bookmark.status = 'failed'
      return true
    }),
    publishRevision: vi.fn(async (id: number, expected: string, content: any, publishOptions: any) => {
      if (id !== bookmark.id || expected !== bookmark.content_key || bookmark.status !== 'parseing') return false
      if (publishOptions.expectedUpdatedAt.getTime() !== bookmark.updated_at.getTime()) return false
      Object.assign(bookmark, content, { status: 'success', updated_at: new Date(bookmark.updated_at.getTime() + 1) })
      return true
    }),
    source: vi.fn(async () => source),
    mediaRef: vi.fn(async () => mediaRef),
    mediaDenied: vi.fn(async () => options.denied ?? false)
  }
  const summary = vi.fn(async () => {})
  const search = vi.fn(async () => [])
  const service = new MediaBodyService(
    { getBookmarkById: async () => ({ ...bookmark }) } as any,
    { deleteBookmarkSummary: summary, getUserBookmark: async () => relation } as any,
    { addSearchRecord: search } as any,
    { bodyHasMarks: async () => false } as any,
    (() => ({ R2Bucket: memory.bucket })) as any,
    repo as any
  )
  const ctx = { env: {} } as any
  const write = (body = { html: '<article>New</article>', text: 'New body' }, opts: any = {}) => service.writeBody(ctx, 1, 7, body, opts)
  return { ...memory, bookmark, initialRevision, repo, summary, search, write }
}

describe('legacy media body shared write ownership', () => {
  it('does not inspect or overwrite objects when another capture owns the row', async () => {
    const f = await fixture()
    f.repo.claimWrite.mockResolvedValue(false)
    const get = vi.spyOn(f.bucket, 'get')
    const put = vi.spyOn(f.bucket, 'put')
    expect(await f.write()).toBe(false)
    expect(get).not.toHaveBeenCalled()
    expect(put).not.toHaveBeenCalled()
    expect(f.summary).not.toHaveBeenCalled()
  })

  it('publishes required text and HTML before database success', async () => {
    const f = await fixture()
    expect(await f.write()).toBe(true)
    expect(f.repo.publishRevision).toHaveBeenCalledWith(
      1,
      f.bookmark.content_key,
      { content_key: f.bookmark.content_key, content_md_key: f.bookmark.content_md_key, content_word_count: 8 },
      { expectedUpdatedAt: f.initialRevision, force: undefined, mediaRef: undefined }
    )
    expect(f.summary).toHaveBeenCalledWith(1, 7)
    expect(f.search).toHaveBeenCalled()
    expect(f.bookmark.status).toBe('success')
  })

  it('releases a managed body claim without overwriting private files or contents', async () => {
    const f = await fixture()
    const bundle = new SnapshotBundle(f.bucket, 'owner')
    await bundle.write('body.html', '<article>Private</article>', 'text/html')
    await bundle.write('media.json', JSON.stringify({ schema: 1, kind: 'html' }), 'application/json')
    const put = vi.spyOn(f.bucket, 'put')
    expect(await f.write()).toBe(false)
    expect(f.repo.releaseWrite).toHaveBeenCalledWith(1, f.initialRevision)
    expect(put).not.toHaveBeenCalled()
    expect(f.repo.publishRevision).not.toHaveBeenCalled()
  })

  it('keeps database and caches unpublished when a required HTML write fails', async () => {
    const f = await fixture()
    const put = f.bucket.put.bind(f.bucket)
    vi.spyOn(f.bucket, 'put').mockImplementation(async (key, value, putOptions) => {
      if (key === f.bookmark.content_key) throw new Error('R2 unavailable')
      return put(key, value, putOptions)
    })
    await expect(f.write()).rejects.toThrow('R2 unavailable')
    expect(f.repo.publishRevision).not.toHaveBeenCalled()
    expect(f.repo.failWrite).toHaveBeenCalledWith(1, f.initialRevision)
    expect(f.repo.releaseWrite).not.toHaveBeenCalled()
    expect(f.bookmark.status).toBe('failed')
    expect(f.bookmark.content_word_count).toBe(3)
    expect(f.objects.get(f.bookmark.content_key)?.value).toContain('Old')
    expect(f.summary).not.toHaveBeenCalled()
    expect(f.search).not.toHaveBeenCalled()
  })

  it('treats a null HTML PUT as a failed write and never publishes the database row', async () => {
    const f = await fixture()
    const put = f.bucket.put.bind(f.bucket)
    vi.spyOn(f.bucket, 'put').mockImplementation(async (key, value, putOptions) => {
      if (key === f.bookmark.content_key) return null
      return put(key, value, putOptions)
    })
    await expect(f.write()).rejects.toThrow('Media HTML write failed')
    expect(f.repo.publishRevision).not.toHaveBeenCalled()
    expect(f.repo.failWrite).toHaveBeenCalledWith(1, f.initialRevision)
    expect(f.bookmark.status).toBe('failed')
    expect(f.summary).not.toHaveBeenCalled()
  })

  it('retains fixed objects and marks the row failed if publication returns false', async () => {
    const f = await fixture()
    f.repo.publishRevision.mockResolvedValue(false)
    const deletion = vi.spyOn(f.bucket, 'delete')
    expect(await f.write()).toBe(false)
    expect(f.repo.failWrite).toHaveBeenCalledWith(1, f.initialRevision)
    expect(f.repo.releaseWrite).not.toHaveBeenCalled()
    expect(f.bookmark.status).toBe('failed')
    expect(deletion).not.toHaveBeenCalled()
    expect(f.objects.has(f.bookmark.content_key)).toBe(true)
    expect(f.summary).not.toHaveBeenCalled()
    expect(f.search).not.toHaveBeenCalled()
  })

  it('never downgrades a committed publication when its acknowledgement throws', async () => {
    const f = await fixture()
    f.repo.publishRevision.mockImplementation(async (_id: number, _expected: string, content: any, publishOptions: any) => {
      if (f.bookmark.status !== 'parseing' || publishOptions.expectedUpdatedAt.getTime() !== f.bookmark.updated_at.getTime()) return false
      Object.assign(f.bookmark, content, { status: 'success', updated_at: new Date(f.bookmark.updated_at.getTime() + 1) })
      throw new Error('ack lost after commit')
    })
    await expect(f.write()).rejects.toThrow('ack lost after commit')
    expect(f.repo.failWrite).toHaveBeenCalledWith(1, f.initialRevision)
    expect(f.repo.releaseWrite).not.toHaveBeenCalled()
    expect(f.bookmark.status).toBe('success')
    expect(f.bookmark.content_word_count).toBe(8)
    expect(f.summary).not.toHaveBeenCalled()
  })

  it('keeps a confirmed publication when summary or search post-commit effects fail', async () => {
    const f = await fixture()
    f.summary.mockRejectedValueOnce(new Error('summary unavailable'))
    f.search.mockRejectedValueOnce(new Error('search unavailable'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await f.write()).toBe(true)
    expect(f.bookmark.status).toBe('success')
    expect(f.bookmark.content_word_count).toBe(8)
    expect(error).toHaveBeenCalled()
    error.mockRestore()
  })

  it('recovers a failed row through the guarded publisher', async () => {
    const f = await fixture({ status: 'failed' })
    expect(await f.write()).toBe(true)
    expect(f.repo.claimWrite).toHaveBeenCalledWith(1, f.initialRevision, ['failed'], undefined)
    expect(f.repo.publishRevision).toHaveBeenCalledOnce()
    expect(f.bookmark.status).toBe('success')
    expect(f.summary).toHaveBeenCalled()
  })

  it('refuses a failed row without a live relation or a matching source revision', async () => {
    const deleted = await fixture({ status: 'failed', relation: { id: 1, uuid: 'relation', deleted_at: new Date(), type: 0 } })
    expect(await deleted.write()).toBe(false)
    expect(deleted.repo.claimWrite).not.toHaveBeenCalled()
    const stale = await fixture({ status: 'failed', sourceUpdatedAt: new Date('2026-01-02') })
    expect(await stale.write()).toBe(false)
    expect(stale.repo.claimWrite).not.toHaveBeenCalled()
    const missing = await fixture({ status: 'failed', relation: null })
    expect(await missing.write()).toBe(false)
    expect(missing.repo.claimWrite).not.toHaveBeenCalled()
  })

  it('does not publish a failed row whose current media source is missing or differs', async () => {
    const intended = { media_kind: 'youtube', source_id: 'video', source_hash: 'hash' }
    const missing = await fixture({ status: 'failed', mediaRef: null })
    await expect(missing.write()).rejects.toThrow('Media publication source missing')
    expect(missing.repo.publishRevision).not.toHaveBeenCalled()
    expect(missing.bookmark.status).toBe('failed')

    const changed = await fixture({ status: 'failed' })
    changed.repo.mediaRef.mockResolvedValue({ media_kind: 'youtube', source_id: 'video', source_hash: 'other' })
    await expect(changed.write(undefined, { mediaRef: intended })).rejects.toThrow('Media publication source changed')
    expect(changed.repo.publishRevision).not.toHaveBeenCalled()

    const denied = await fixture({ status: 'failed', denied: true })
    await expect(denied.write(undefined, { mediaRef: intended })).rejects.toThrow('Media publication source changed')
    expect(denied.repo.publishRevision).not.toHaveBeenCalled()
  })

  it('never writes a moderated or foreign-private bookmark', async () => {
    const moderated = await fixture({ status: 'failed', moderation: 1 })
    expect(await moderated.write()).toBe(false)
    expect(moderated.repo.claimWrite).not.toHaveBeenCalled()
  })

  it('gates committed-only reads on database success', async () => {
    const f = await fixture({ status: 'failed' })
    const service = new MediaBodyService(
      { getBookmarkById: async () => ({ ...f.bookmark }) } as any,
      { deleteBookmarkSummary: f.summary, getUserBookmark: async () => ({ id: 1, uuid: 'relation', deleted_at: null, type: 0 }) } as any,
      { addSearchRecord: f.search } as any,
      {} as any,
      (() => ({ R2Bucket: f.bucket })) as any,
      f.repo as any
    )
    expect(await service.readBody(1)).toContain('Old')
    expect(await service.readBody(1, true)).toBeNull()
    f.bookmark.status = 'success'
    expect(await service.readBody(1, true)).toContain('Old')
  })
})
