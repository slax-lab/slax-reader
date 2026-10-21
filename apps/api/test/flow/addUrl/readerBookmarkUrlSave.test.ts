import { describe, expect, test, vi } from 'vitest'
import { BookmarkAddOrchestrator } from '@/domain/orchestrator/bookmarkAdd'
import { BookmarkController } from '@/handler/http/bookmarkController'
import { createMockCtx, createMockCrawlService } from '@test/helpers/mockFactory'

const origin = 'https://reader.example.com'
const sourceUuid = '123e4567-e89b-42d3-a456-426614174000'
const targetUuid = '123e4567-e89b-42d3-a456-426614174001'
const sourceUrl = `${origin}/b/${sourceUuid}`
const saved = { bookmark_id: 420, bookmark_uid: targetUuid, write_mode: 'overwritten', fork_info: { bookmark_uid: sourceUuid } }

function fixture() {
  const ctx = createMockCtx({ hashIds: { encodeId: (id: number) => id * 10, decodeId: (id: number) => id / 10 } })
  ctx.env.FRONT_END_URL = origin
  const bookmarkService = { addUrlBookmark: vi.fn().mockResolvedValue(8), addBookmark: vi.fn().mockResolvedValue(8) }
  const crawlService = createMockCrawlService()
  const bookmarkForkService = { fork: vi.fn().mockResolvedValue(saved) }
  const orchestrator = Object.assign(Object.create(BookmarkAddOrchestrator.prototype), { bookmarkService, crawlService, bookmarkForkService }) as BookmarkAddOrchestrator
  const controller = Object.assign(Object.create(BookmarkController.prototype), {
    bookmarkAddOrchestrator: orchestrator,
    logsService: { track: vi.fn().mockResolvedValue(undefined) },
    userDeletionService: { ensureUserNotDeleted: vi.fn().mockResolvedValue(undefined) }
  }) as BookmarkController
  return { ctx, bookmarkService, crawlService, bookmarkForkService, orchestrator, controller }
}

const request = (target_url = sourceUrl) => ({ target_url, target_title: 'Reader page', tags: [] })
const inlineRequest = () => ({ target_url: sourceUrl, target_title: 'Reader page', target_icon: '', taget_cover: '', description: '', content: '<article>untrusted reader DOM</article>', tag: [] })

for (const method of ['url', 'inline'] as const) {
  describe(`Reader ${method} save delegation`, () => {
    test('returns the stored destination without a crawl workflow', async () => {
      const f = fixture()
      const result = method === 'url' ? await f.orchestrator.addByUrl(f.ctx, request()) : await f.orchestrator.addByContent(f.ctx, inlineRequest())
      expect(result).toMatchObject({ bookmarkId: 42, isShortcut: false, workflowParams: null, forkResult: saved })
      expect(f.bookmarkForkService.fork).toHaveBeenCalledWith(f.ctx, expect.objectContaining({ bookmark_uid: sourceUuid }), undefined)
      expect(f.bookmarkService.addUrlBookmark).not.toHaveBeenCalled()
      expect(f.bookmarkService.addBookmark).not.toHaveBeenCalled()
      expect(f.crawlService.resolveFinalUrl).not.toHaveBeenCalled()
      expect(f.crawlService.createWorkflow).not.toHaveBeenCalled()
    })

    test('does not turn a rejected Fork into a direct capture', async () => {
      const f = fixture()
      const denied = new Error('source access revoked')
      f.bookmarkForkService.fork.mockRejectedValue(denied)
      const result = method === 'url' ? f.orchestrator.addByUrl(f.ctx, request()) : f.orchestrator.addByContent(f.ctx, inlineRequest())
      await expect(result).rejects.toBe(denied)
      expect(f.bookmarkService.addUrlBookmark).not.toHaveBeenCalled()
      expect(f.bookmarkService.addBookmark).not.toHaveBeenCalled()
    })

    test('preserves Fork metadata through the HTTP response', async () => {
      const f = fixture()
      const body = method === 'url' ? request() : inlineRequest()
      const req = new Request(`https://api.test/v1/bookmark/${method === 'url' ? 'add_url' : 'add'}`, { method: 'POST', body: JSON.stringify(body) })
      const response = method === 'url' ? await f.controller.handleUserAddUrlBookmarkRequest(f.ctx, req) : await f.controller.handleUserAddBookmarkRequest(f.ctx, req)
      expect(await response.json()).toMatchObject({ code: 200, data: saved })
      expect(f.crawlService.createWorkflow).not.toHaveBeenCalled()
    })
  })
}

describe('Reader URL-save identity', () => {
  test('rejects an invalid encoded Fork id instead of returning bookmarkId zero', async () => {
    const f = fixture()
    f.ctx.hashIds.decodeId = vi.fn().mockReturnValue(0)
    await expect(f.orchestrator.addByUrl(f.ctx, request())).rejects.toBeTruthy()
  })

  test.each([
    `${sourceUrl}?bookmark_uid=someone-else`,
    `${sourceUrl}#article`,
    `${sourceUrl}/`,
    `${origin}/other/%2e%2e/b/${sourceUuid}`,
    `${origin}.evil.test/b/${sourceUuid}`,
    `https://name:password@reader.example.com/b/${sourceUuid}`,
    `https://reader.example.com:8443/b/${sourceUuid}`,
    `${origin}/b/not-a-uuid`
  ])('cannot select a Reader source from a noncanonical URL: %s', async target_url => {
    const f = fixture()
    await f.orchestrator.addByUrl(f.ctx, request(target_url))
    expect(f.bookmarkForkService.fork).not.toHaveBeenCalled()
    expect(f.bookmarkService.addUrlBookmark).toHaveBeenCalled()
  })

  test('keeps the caller operation key across a retry without using URL identity as its key', async () => {
    const f = fixture()
    const req = request()
    const options = { idempotencyKey: 'caller-operation-1' }
    await f.orchestrator.addByUrl(f.ctx, req, options)
    await f.orchestrator.addByUrl(f.ctx, req, options)
    for (const args of f.bookmarkForkService.fork.mock.calls) {
      expect(args[1]).toEqual({ bookmark_uid: sourceUuid })
      expect(args[2]).toBe('caller-operation-1')
    }
    expect(f.bookmarkForkService.fork).toHaveBeenCalledTimes(2)
  })
})


describe('Reader URL-save HTTP operation identity', () => {
  test.each(['url', 'inline'] as const)('forwards the caller operation key from the %s endpoint', async method => {
    const f = fixture()
    const body = method === 'url' ? request() : inlineRequest()
    const req = new Request(`https://api.test/v1/bookmark/${method === 'url' ? 'add_url' : 'add'}`, {
      method: 'POST',
      headers: { 'Idempotency-Key': 'http-operation-1' },
      body: JSON.stringify(body)
    })
    if (method === 'url') await f.controller.handleUserAddUrlBookmarkRequest(f.ctx, req)
    else await f.controller.handleUserAddBookmarkRequest(f.ctx, req)
    expect(f.bookmarkForkService.fork).toHaveBeenCalledWith(f.ctx, { bookmark_uid: sourceUuid }, 'http-operation-1')
  })

  test('returns Fork metadata while retaining the encoded bookmark id for legacy clients', async () => {
    const f = fixture()
    const response = await f.controller.handleUserAddUrlBookmarkRequest(f.ctx, new Request('https://api.test/v1/bookmark/add_url', {
      method: 'POST', body: JSON.stringify(request())
    }))
    expect(await response.json()).toMatchObject({ code: 200, data: { ...saved, bmId: saved.bookmark_id } })
  })

  test('does not upgrade a missing-scheme Reader URL into a Fork source', async () => {
    const f = fixture()
    const target = `reader.example.com/b/${sourceUuid}`
    await f.controller.handleUserAddUrlBookmarkRequest(f.ctx, new Request('https://api.test/v1/bookmark/add_url', {
      method: 'POST', body: JSON.stringify(request(target))
    }))
    expect(f.bookmarkForkService.fork).not.toHaveBeenCalled()
    expect(f.bookmarkService.addUrlBookmark).toHaveBeenCalledWith(f.ctx, expect.objectContaining({ target_url: sourceUrl }), expect.anything(), expect.anything())
  })
})
