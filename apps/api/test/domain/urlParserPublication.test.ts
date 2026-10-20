import { describe, expect, test, vi } from 'vitest'
import { parseHTML } from 'linkedom'
import { UrlParserHandler } from '@/domain/orchestrator/urlParser'
import { createMockCtx } from '@test/helpers/mockFactory'

function setup() {
  const objects = new Map<string, string>()
  const bookmark = {
    stageBookmarkObjects: vi.fn().mockResolvedValue(undefined),
    publishBookmarkVersion: vi.fn().mockResolvedValue(true),
    isBookmarkVersionCurrent: vi.fn().mockResolvedValue(true),
    getUserBookmark: vi.fn().mockResolvedValue({ uuid: 'owner-bookmark' }),
    getBookmarkById: vi.fn().mockResolvedValue({ write_version: 2, published_version: 1 }),
    getBookmarkTitleAndTextContentTry: vi.fn().mockResolvedValue({ title: 'previous body', textContent: 'previous text' }),
    updateBookmark: vi.fn()
  }
  const bucket = {
    putIfKeyExists: vi.fn(async (key: string, body: string) => {
      objects.set(key, body)
    })
  }
  const crawl = { fetchAndSaveWeibo: vi.fn().mockResolvedValue({ title: 'new body', textContent: 'new text' }) }
  const handler = new UrlParserHandler(bookmark as any, () => bucket as any, {} as any, {} as any, {} as any, {} as any, {} as any, {} as any, crawl as any, {} as any)
  const post = vi.spyOn(handler, 'processPostHandler').mockResolvedValue(undefined)
  return { handler, bookmark, bucket, crawl, objects, post }
}

function parsed() {
  const { document } = parseHTML('<html><body>Complete article</body></html>')
  return { title: 'Article', textContent: 'Complete article', contentDocument: document }
}

describe('URL queue publication', () => {
  test('registers each object before writing and publishes only after both objects exist', async () => {
    const { handler, bookmark, bucket, objects } = setup()
    bucket.putIfKeyExists.mockImplementation(async (key, body) => {
      expect(bookmark.stageBookmarkObjects).toHaveBeenCalledWith(42, 2, expect.any(String), expect.arrayContaining([key]))
      objects.set(key, body)
    })
    bookmark.publishBookmarkVersion.mockImplementation(async (_id, _version, info) => {
      expect(objects.get(info.content_key)).toContain('Complete article')
      expect(objects.get(info.content_md_key)).toBe('Complete article')
      return true
    })
    await handler.saveBookmark('message', 42, parsed(), 2)
    expect(bookmark.publishBookmarkVersion).toHaveBeenCalledWith(42, 2, expect.objectContaining({ status: 'success' }))
    expect(bookmark.updateBookmark).not.toHaveBeenCalled()
  })

  test('does not publish when either object write fails', async () => {
    const { handler, bookmark, bucket } = setup()
    bucket.putIfKeyExists.mockRejectedValueOnce(new Error('R2 unavailable'))
    await expect(handler.saveBookmark('message', 42, parsed(), 2)).rejects.toThrow('R2 unavailable')
    expect(bookmark.publishBookmarkVersion).not.toHaveBeenCalled()
    expect(bookmark.stageBookmarkObjects).toHaveBeenCalledOnce()
  })

  test('legacy deliveries use unique staged version-zero revisions and propagate publication rejection', async () => {
    const { handler, bookmark } = setup()
    const first = await handler.saveBookmark('message', 42, parsed())
    const second = await handler.saveBookmark('message', 42, parsed())
    expect(first.content_key).not.toBe(second.content_key)
    expect(bookmark.publishBookmarkVersion).toHaveBeenCalledWith(42, 0, expect.any(Object))
    bookmark.publishBookmarkVersion.mockResolvedValueOnce(false)
    await expect(handler.saveBookmark('message', 42, parsed())).rejects.toThrow('superseded')
  })

  test('third-party refreshes propagate writeVersion and do not reuse the previous published body', async () => {
    const { handler, bookmark, crawl, post } = setup()
    const message = { id: 'delivery', info: { bookmarkId: 42, userId: 10, targetUrl: 'https://weibo.com/123/456', writeVersion: 2 } }
    await handler.processThirdPartyMessages(createMockCtx(), [message as any])
    expect(bookmark.getBookmarkTitleAndTextContentTry).not.toHaveBeenCalled()
    expect(crawl.fetchAndSaveWeibo).toHaveBeenCalledWith(expect.anything(), message.info.targetUrl, 42, { uuid: 'owner-bookmark', writeVersion: 2 })
    expect(post).toHaveBeenCalledOnce()
  })

  test('a stale delivery cannot piggyback on another owner’s same-URL message', async () => {
    const { handler, bookmark, crawl } = setup()
    bookmark.getBookmarkById.mockResolvedValueOnce({ write_version: 3, published_version: 3 }).mockResolvedValueOnce({ write_version: 2, published_version: 1 })
    const info = { bookmarkId: 42, userId: 10, targetUrl: 'https://weibo.com/123/456', writeVersion: 2 }
    await handler.processThirdPartyMessages(createMockCtx(), [
      { id: 'stale', info },
      { id: 'current', info: { ...info, bookmarkId: 43, userId: 11 } }
    ] as any)
    expect(crawl.fetchAndSaveWeibo).toHaveBeenCalledTimes(1)
    expect(crawl.fetchAndSaveWeibo).toHaveBeenCalledWith(expect.anything(), info.targetUrl, 43, expect.objectContaining({ writeVersion: 2 }))
  })
})
