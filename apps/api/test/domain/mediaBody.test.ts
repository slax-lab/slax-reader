import { describe, expect, it, vi } from 'vitest'
import { MediaBodyService } from '@/domain/mediaBody'
import { SnapshotBundle } from '@/utils/snapshotBundle'
import { memoryBucket } from '../utils/snapshotBucket'

async function fixture() {
  const memory = memoryBucket()
  const bookmark = {
    id: 1,
    content_key: 'html/body/owner.html',
    content_md_key: 'text/body/owner.txt',
    content_word_count: 3,
    updated_at: new Date('2026-01-01'),
    title: 'Saved',
    moderation_result: 0
  }
  await memory.bucket.put(bookmark.content_key, '<article>Old</article>')
  await memory.bucket.put(bookmark.content_md_key, 'Old')
  const repo = { claimWrite: vi.fn(async () => true), releaseWrite: vi.fn(async () => true), failWrite: vi.fn(async () => true), publishRevision: vi.fn(async () => true) }
  const summary = vi.fn(async () => {})
  const search = vi.fn(async () => [])
  const service = new MediaBodyService(
    { getBookmarkById: async () => bookmark } as any,
    { deleteBookmarkSummary: summary, updateBookmarkWordCount: vi.fn(async () => {}) } as any,
    { addSearchRecord: search } as any,
    {} as any,
    (() => ({ R2Bucket: memory.bucket })) as any,
    repo as any
  )
  const write = () => service.writeBody({} as any, 1, 7, { html: '<article>New</article>', text: 'New body' })
  return { ...memory, bookmark, repo, summary, search, write }
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
    f.repo.publishRevision.mockImplementation(async () => {
      expect(f.objects.get(f.bookmark.content_key)?.value).toContain('New')
      expect(f.objects.get(f.bookmark.content_md_key)?.value).toBe('New body')
      return true
    })
    expect(await f.write()).toBe(true)
    expect(f.repo.publishRevision).toHaveBeenCalledWith(
      1,
      f.bookmark.content_key,
      { content_key: f.bookmark.content_key, content_md_key: f.bookmark.content_md_key, content_word_count: 8 },
      { expectedUpdatedAt: f.bookmark.updated_at, force: undefined }
    )
    expect(f.summary).toHaveBeenCalledWith(1, 7)
    expect(f.search).toHaveBeenCalled()
  })

  it('releases a managed body claim without overwriting private files or contents', async () => {
    const f = await fixture()
    const bundle = new SnapshotBundle(f.bucket, 'owner')
    await bundle.write('body.html', '<article>Private</article>', 'text/html')
    await bundle.write('media.json', JSON.stringify({ schema: 1, kind: 'html' }), 'application/json')
    const put = vi.spyOn(f.bucket, 'put')
    expect(await f.write()).toBe(false)
    expect(f.repo.releaseWrite).toHaveBeenCalledWith(1, f.bookmark.updated_at)
    expect(put).not.toHaveBeenCalled()
    expect(f.repo.publishRevision).not.toHaveBeenCalled()
  })

  it('keeps database and caches unpublished when a required HTML write fails', async () => {
    const f = await fixture()
    const put = f.bucket.put.bind(f.bucket)
    vi.spyOn(f.bucket, 'put').mockImplementation(async (key, value, options) => {
      if (key === f.bookmark.content_key) throw new Error('R2 unavailable')
      return put(key, value, options)
    })
    await expect(f.write()).rejects.toThrow('R2 unavailable')
    expect(f.repo.publishRevision).not.toHaveBeenCalled()
    expect(f.repo.releaseWrite).toHaveBeenCalledWith(1, f.bookmark.updated_at)
    expect(f.objects.get(f.bookmark.content_key)?.value).toContain('Old')
    expect(f.summary).not.toHaveBeenCalled()
    expect(f.search).not.toHaveBeenCalled()
  })

  it('retains fixed objects and fails only the current request if publication fails', async () => {
    const f = await fixture()
    f.repo.publishRevision.mockResolvedValue(false)
    const deletion = vi.spyOn(f.bucket, 'delete')
    expect(await f.write()).toBe(false)
    expect(f.repo.releaseWrite).toHaveBeenCalledWith(1, f.bookmark.updated_at)
    expect(deletion).not.toHaveBeenCalled()
    expect(f.objects.has(f.bookmark.content_key)).toBe(true)
    expect(f.summary).not.toHaveBeenCalled()
    expect(f.search).not.toHaveBeenCalled()
  })
})
