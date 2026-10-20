import { describe, expect, test, vi } from 'vitest'
import { MediaBodyService } from '@/domain/mediaBody'
import { createMockCtx } from '@test/helpers/mockFactory'

function setup() {
  const bookmark = { id: 42, content_key: 'html/body/current.html', content_md_key: 'text/body/current.txt', title: 'Video', moderation_result: 0, write_version: 3, published_version: 3 }
  const bookmarkService = { getBookmarkById: vi.fn().mockResolvedValue(bookmark) }
  const repo = { getCurrentBookmarkFork: vi.fn().mockResolvedValue(null), stageBookmarkObjects: vi.fn(), publishMediaBookmarkBody: vi.fn().mockResolvedValue(true), updateBookmarkWordCount: vi.fn(), deleteBookmarkSummary: vi.fn() }
  const bucket = { put: vi.fn(), delete: vi.fn() }
  const search = { addSearchRecordByBmId: vi.fn().mockResolvedValue([]) }
  const service = new MediaBodyService(bookmarkService as any, repo as any, search as any, {} as any, () => ({ R2Bucket: bucket }) as any)
  return { service, bookmark, repo, bucket }
}

describe('media body publication', () => {
  test('does not mutate a Fork snapshot even when an earlier media job still has its reference', async () => {
    const s = setup()
    s.repo.getCurrentBookmarkFork.mockResolvedValue({ source_uuid: 'source' } as any)
    expect(await s.service.writeBody(createMockCtx(), 42, 1, { html: 'old job', text: 'old job' }, { captureVersion: 3 } as any)).toBe(false)
    expect(s.bucket.put).not.toHaveBeenCalled()
  })

  test('an old media job cannot publish to a newer direct capture', async () => {
    const s = setup()
    expect(await s.service.writeBody(createMockCtx(), 42, 1, { html: 'old job', text: 'old job' }, { captureVersion: 2 } as any)).toBe(false)
    expect(s.bucket.put).not.toHaveBeenCalled()
  })

  test('stages new objects and uses an atomic pointer/version comparison', async () => {
    const s = setup()
    expect(await s.service.writeBody(createMockCtx(), 42, 1, { html: 'new article', text: 'new article' }, { captureVersion: 3 } as any)).toBe(true)
    expect(s.repo.publishMediaBookmarkBody).toHaveBeenCalledWith(42, 3, 'html/body/current.html', expect.objectContaining({ content_word_count: 11 }))
    expect(s.bucket.put.mock.calls.every(([key]) => !['html/body/current.html', 'text/body/current.txt'].includes(key))).toBe(true)
    expect(s.repo.stageBookmarkObjects).toHaveBeenCalled()
  })
})
