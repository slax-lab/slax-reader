/**
 * /add Layer 4: Labs gate on the extension / iOS share path
 * 来源: bookmark.ts addBookmark, bookmarkAdd.ts addByContent
 */
import { describe, test, expect, vi } from 'vitest'
import { BookmarkService } from '@/domain/bookmark'
import { LabService } from '@/domain/lab'
import { BookmarkAddOrchestrator } from '@/domain/orchestrator/bookmarkAdd'
import { ErrorName } from '@/const/err'
import { createMockCtx, createMockBookmarkService, createMockCrawlService } from '@test/helpers/mockFactory'

const YOUTUBE = 'https://youtu.be/dQw4w9WgXcQ'

function labService(enabled: boolean) {
  const labRepo = { listByUser: vi.fn(), isEnabled: vi.fn().mockResolvedValue(enabled), upsert: vi.fn() }
  return new (LabService as any)(labRepo) as LabService
}

function wireService(enabled: boolean) {
  const createBookmarkBase = vi.fn().mockResolvedValue({ id: 11, private_user: 7 })
  const bookmarkRepo = { getBookmark: vi.fn().mockResolvedValue(null) }
  const service = Object.create(BookmarkService.prototype) as BookmarkService
  Object.assign(service, { createBookmarkBase, bookmarkRepo, labService: labService(enabled) })
  return { service, createBookmarkBase }
}

const req = { target_url: YOUTUBE, target_title: 'v', target_icon: '', taget_cover: '', content: '', description: '', tag: [] }

describe('BookmarkService.addBookmark', () => {
  test('switch off → LAB_FEATURE_DISABLED, no row', async () => {
    const { service, createBookmarkBase } = wireService(false)
    await expect(service.addBookmark(createMockCtx({ userId: 7 }), req)).rejects.toMatchObject({ name: ErrorName.LAB_FEATURE_DISABLED })
    expect(createBookmarkBase).not.toHaveBeenCalled()
  })

  test('switch on → row created', async () => {
    const { service, createBookmarkBase } = wireService(true)
    await service.addBookmark(createMockCtx({ userId: 7 }), req)
    expect(createBookmarkBase).toHaveBeenCalled()
  })
})

describe('BookmarkAddOrchestrator.addByContent', () => {
  test('Labs error is rethrown without a Feishu alert', async () => {
    const bs = createMockBookmarkService()
    const cs = createMockCrawlService()
    const orch = new (BookmarkAddOrchestrator as any)()
    Object.assign(orch, { bookmarkService: bs, crawlService: cs })
    bs.addBookmark.mockRejectedValue(labService(false).disabledError('youtube'))

    await expect(orch.addByContent(createMockCtx(), req as any)).rejects.toMatchObject({ name: ErrorName.LAB_FEATURE_DISABLED })
    expect(cs.pushBookmarkFailureAlert).not.toHaveBeenCalled()
  })
})
