/**
 * /add_url Layer 11: 卡死检测 + 救援机制
 * 来源: bookmark.ts:388-453, dbBookmark.ts:570-599
 * 测试 detectStuckAndRetry, processStuckBookmark, kickoffWorkflowForRetry, CAS
 */
import { describe, test, expect, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))

import { BookmarkService } from '@/domain/bookmark'
import {
  createMockBookmarkRepo, createMockCrawlService,
  createMockUserRepo, createMockCtx, createMockEnv
} from '@test/helpers/mockFactory'

function wire() {
  const bookmarkRepo = createMockBookmarkRepo()
  const crawlService = createMockCrawlService()
  const userRepo = createMockUserRepo()

  const svc = new (BookmarkService as any)()
  ;(svc as any).bookmarkData = bookmarkRepo
  ;(svc as any).crawlService = crawlService
  ;(svc as any).userData = userRepo

  return { svc: svc as BookmarkService, bookmarkRepo, crawlService, userRepo }
}

const fakeStuckBookmark = (overrides: Record<string, unknown> = {}) => ({
  id: 1,
  target_url: 'https://example.com/stuck',
  status: 'pending',
  created_at: new Date(Date.now() - 5 * 60_000),
  updated_at: new Date('2026-10-22T00:00:00Z'),
  user_id: 10,
  ...overrides
})

describe('detectStuckAndRetry', () => {
  test('无卡死书签 → 直接返回', async () => {
    const { svc, bookmarkRepo } = wire()
    bookmarkRepo.findStuckBookmarks.mockResolvedValue([])
    const ctx = createMockCtx()

    await svc.detectStuckAndRetry(ctx)

    expect(bookmarkRepo.findStuckBookmarks).toHaveBeenCalledWith({
      pendingThresholdMinutes: 4,
      limit: 100
    })
    expect(bookmarkRepo.casBookmarkStatus).not.toHaveBeenCalled()
  })

  test('pending rescue dispatches without marking the original capture failed', async () => {
    const { svc, bookmarkRepo, crawlService, userRepo } = wire()
    const stuck = fakeStuckBookmark()
    bookmarkRepo.findStuckBookmarks.mockResolvedValue([stuck])
    bookmarkRepo.casBookmarkStatus.mockResolvedValue(true)
    userRepo.getUserInfo.mockResolvedValue({ ai_lang: 'zh' })
    const ctx = createMockCtx()

    await svc.detectStuckAndRetry(ctx)

    expect(bookmarkRepo.casBookmarkStatus).not.toHaveBeenCalled()
    expect(crawlService.createWorkflow).toHaveBeenCalledWith(
      ctx.env,
      expect.objectContaining({
        url: 'https://example.com/stuck',
        bookmarkId: 1,
        userId: 10,
        userLang: 'zh'
      })
    )
  })

  test('does not rescue a capture already claimed as parseing', async () => {
    const { svc, bookmarkRepo, crawlService, userRepo } = wire()
    const stuck = fakeStuckBookmark({ status: 'parseing' })
    bookmarkRepo.findStuckBookmarks.mockResolvedValue([stuck])
    bookmarkRepo.casBookmarkStatus.mockResolvedValue(true)
    userRepo.getUserInfo.mockResolvedValue({ ai_lang: 'en' })
    const ctx = createMockCtx()

    await svc.detectStuckAndRetry(ctx)

    expect(bookmarkRepo.casBookmarkStatus).not.toHaveBeenCalled()
    expect(crawlService.createWorkflow).not.toHaveBeenCalled()
  })

  test('无 user_id (孤儿) → CAS(FAILED), 不告警、不创建 workflow', async () => {
    const { svc, bookmarkRepo, crawlService } = wire()
    const orphan = fakeStuckBookmark({ user_id: 0 })
    bookmarkRepo.findStuckBookmarks.mockResolvedValue([orphan])
    const ctx = createMockCtx()

    await svc.detectStuckAndRetry(ctx)

    expect(bookmarkRepo.casBookmarkStatus).toHaveBeenCalledWith(1, 'pending', 'failed')
    expect(crawlService.pushBookmarkFailureAlert).not.toHaveBeenCalled()
    expect(crawlService.createWorkflow).not.toHaveBeenCalled()
  })

  test('pending rescue preserves the revision and leaves claim admission to the workflow', async () => {
    const { svc, bookmarkRepo, crawlService } = wire()
    const stuck = fakeStuckBookmark()
    bookmarkRepo.findStuckBookmarks.mockResolvedValue([stuck])
    bookmarkRepo.casBookmarkStatus.mockResolvedValue(false)
    const ctx = createMockCtx()

    await svc.detectStuckAndRetry(ctx)

    expect(bookmarkRepo.casBookmarkStatus).not.toHaveBeenCalled()
    expect(crawlService.createWorkflow).toHaveBeenCalledWith(ctx.env, expect.objectContaining({ captureRevision: stuck.updated_at.toISOString() }))
  })

  test('kickoffWorkflowForRetry 失败 → alert(stuck.retry_failed)', async () => {
    const { svc, bookmarkRepo, crawlService, userRepo } = wire()
    const stuck = fakeStuckBookmark()
    bookmarkRepo.findStuckBookmarks.mockResolvedValue([stuck])
    bookmarkRepo.casBookmarkStatus.mockResolvedValue(true)
    userRepo.getUserInfo.mockResolvedValue({ ai_lang: 'en' })
    crawlService.createWorkflow.mockRejectedValue(new Error('workflow create failed'))
    const ctx = createMockCtx()

    await svc.detectStuckAndRetry(ctx)

    expect(crawlService.pushBookmarkFailureAlert).toHaveBeenCalledWith(
      10, 'stuck.retry_failed',
      expect.objectContaining({ bookmark_id: 1, error: 'workflow create failed' })
    )
  })

  test('用户不存在 → createWorkflow 不调用', async () => {
    const { svc, bookmarkRepo, crawlService, userRepo } = wire()
    const stuck = fakeStuckBookmark()
    bookmarkRepo.findStuckBookmarks.mockResolvedValue([stuck])
    bookmarkRepo.casBookmarkStatus.mockResolvedValue(true)
    userRepo.getUserInfo.mockResolvedValue(null)
    const ctx = createMockCtx()

    await svc.detectStuckAndRetry(ctx)

    expect(crawlService.createWorkflow).not.toHaveBeenCalled()
  })

  test('user ai_lang 为 null → 默认 "en"', async () => {
    const { svc, bookmarkRepo, crawlService, userRepo } = wire()
    const stuck = fakeStuckBookmark()
    bookmarkRepo.findStuckBookmarks.mockResolvedValue([stuck])
    bookmarkRepo.casBookmarkStatus.mockResolvedValue(true)
    userRepo.getUserInfo.mockResolvedValue({ ai_lang: null })
    const ctx = createMockCtx()

    await svc.detectStuckAndRetry(ctx)

    expect(crawlService.createWorkflow).toHaveBeenCalledWith(
      ctx.env,
      expect.objectContaining({ userLang: 'en' })
    )
  })
})

describe('批次并发', () => {
  test('15 条 → 分 10+5 两批处理', async () => {
    const { svc, bookmarkRepo, userRepo, crawlService } = wire()
    const stuckList = Array.from({ length: 15 }, (_, i) =>
      fakeStuckBookmark({ id: i + 1, user_id: 10, target_url: `https://example.com/${i}` })
    )
    bookmarkRepo.findStuckBookmarks.mockResolvedValue(stuckList)
    bookmarkRepo.casBookmarkStatus.mockResolvedValue(true)
    userRepo.getUserInfo.mockResolvedValue({ ai_lang: 'en' })
    const ctx = createMockCtx()

    await svc.detectStuckAndRetry(ctx)

    expect(crawlService.createWorkflow).toHaveBeenCalledTimes(15)
    expect(bookmarkRepo.casBookmarkStatus).not.toHaveBeenCalled()
  })

  test('processStuckBookmark 某条 reject → 其他条仍处理', async () => {
    const { svc, bookmarkRepo, crawlService, userRepo } = wire()
    const ok = fakeStuckBookmark({ id: 1, user_id: 10 })
    const bad = fakeStuckBookmark({ id: 2, user_id: 20 })
    bookmarkRepo.findStuckBookmarks.mockResolvedValue([ok, bad])
    bookmarkRepo.casBookmarkStatus.mockResolvedValue(true)
    userRepo.getUserInfo
      .mockResolvedValueOnce({ ai_lang: 'en' })
      .mockResolvedValueOnce({ ai_lang: 'en' })
    crawlService.createWorkflow
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('boom'))
    const ctx = createMockCtx()

    await svc.detectStuckAndRetry(ctx)

    expect(crawlService.createWorkflow).toHaveBeenCalledTimes(2)
    expect(crawlService.pushBookmarkFailureAlert).toHaveBeenCalledWith(
      20, 'stuck.retry_failed', expect.objectContaining({ bookmark_id: 2 })
    )
  })
})
