/**
 * /add_url Layer 4: kickoffWorkflow + CrawlService.createWorkflow 重试
 * 来源: bookmarkAdd.ts:96-116, crawl.ts:64-98
 */
import { describe, test, expect, vi } from 'vitest'
import { BookmarkAddOrchestrator } from '@/domain/orchestrator/bookmarkAdd'
import { CrawlService } from '@/domain/crawl'
import {
  createMockCtx, createMockBookmarkService, createMockCrawlService,
  createMockBucketClient, createMockBookmarkRepo, createMockLogsService, createMockAlertBot
} from '@test/helpers/mockFactory'

function wireOrch() {
  const bs = createMockBookmarkService()
  const cs = createMockCrawlService()
  const orch = new (BookmarkAddOrchestrator as any)()
  ;(orch as any).bookmarkService = bs
  ;(orch as any).crawlService = cs
  return { orch: orch as BookmarkAddOrchestrator, cs }
}

function wireCrawlService() {
  const { factory: bc, putIfKeyExists } = createMockBucketClient()
  const br = createMockBookmarkRepo()
  const ls = createMockLogsService()
  const ab = createMockAlertBot()
  const svc = new (CrawlService as any)()
  ;(svc as any).bucketClient = bc
  ;(svc as any).bookmarkRepo = br
  ;(svc as any).logsService = ls
  ;(svc as any).alertBot = ab
  ;(svc as any).snapshotRepo = {
    snapshot: vi.fn(async () => ({ status: 'pending', updated_at: new Date('2026-10-22T00:00:00Z') })),
    failDispatch: vi.fn(async (id, _revision) => {
      await br.updateBookmarkStatus(id, 'failed')
      return true
    }),
    setCaptureStatus: vi.fn(async (id, _revision, status) => {
      await br.updateBookmarkStatus(id, status)
      return true
    })
  }
  return { svc: svc as CrawlService, br, ls, ab }
}

describe('kickoffWorkflow 参数映射', () => {
  test('默认参数: callbackChatId=0, ignoreGenerateTag=false', async () => {
    const { orch, cs } = wireOrch()
    const ctx = createMockCtx({ encodeUserId: 200, lang: 'zh' })
    await orch.kickoffWorkflow(ctx, { url: 'https://a.com', bookmarkId: 1, userId: 1 })
    expect(cs.createWorkflow).toHaveBeenCalledWith(ctx.env, expect.objectContaining({
      url: 'https://a.com', bookmarkId: 1, userId: 1,
      enUserId: 200, userLang: 'zh', callbackChatId: 0, callbackOriginMessageId: 0, ignoreGenerateTag: false
    }), 3, ctx)
  })

  test('Telegram 回调参数传递', async () => {
    const { orch, cs } = wireOrch()
    await orch.kickoffWorkflow(createMockCtx(), { url: 'https://a.com', bookmarkId: 1, userId: 1 },
      { callbackChatId: 555, callbackOriginMessageId: 666, ignoreGenerateTag: true })
    expect(cs.createWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      callbackChatId: 555, callbackOriginMessageId: 666, ignoreGenerateTag: true
    }), 3, expect.objectContaining({ execution: expect.anything() }))
  })

  test('inlineContent 透传', async () => {
    const { orch, cs } = wireOrch()
    await orch.kickoffWorkflow(createMockCtx(), { url: 'https://a.com', bookmarkId: 1, userId: 1, inlineContent: '<p>hi</p>' })
    expect(cs.createWorkflow).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ inlineContent: '<p>hi</p>' }), 3, expect.objectContaining({ execution: expect.anything() }))
  })
})

describe('kickoffWorkflow 错误处理', () => {
  test('createWorkflow 失败 → 静默不抛', async () => {
    const { orch, cs } = wireOrch()
    cs.createWorkflow.mockRejectedValue(new Error('workflow fail'))
    await expect(orch.kickoffWorkflow(createMockCtx(), { url: 'https://a.com', bookmarkId: 1, userId: 1 }))
      .resolves.toBeUndefined()
  })
})

describe('CrawlService.createWorkflow 重试', () => {
  test('a legacy Reader URL becomes failed without crawling the Reader shell', async () => {
    const { svc, br } = wireCrawlService()
    const env = { ...createMockCtx().env, FRONT_END_URL: 'https://reader.test' }
    await expect(svc.createWorkflow(env, { url: 'https://reader.test/b/11111111-1111-4111-8111-111111111111', bookmarkId: 42, userId: 1 } as any)).rejects.toMatchObject({
      name: 'fork_source_not_ready'
    })
    expect(br.updateBookmarkStatus).toHaveBeenCalledWith(42, 'failed')
    expect(env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
  })

  test('首次成功 → 只调 1 次 + 发送 success event', async () => {
    const { svc, ls } = wireCrawlService()
    const env = createMockCtx().env
    await svc.createWorkflow(env, { url: 'https://github.com/user', bookmarkId: 1, userId: 1 } as any)
    expect(env.CRAWL_WORKFLOW.create).toHaveBeenCalledTimes(1)
    expect(ls.track).toHaveBeenCalledWith(1, 'bookmark_add_step', expect.objectContaining({
      domain: 'github.com', step_name: 'workflow_creation', status: 'success'
    }))
  })

  test('首次失败 + 重试成功 → 调 2 次', async () => {
    const { svc } = wireCrawlService()
    const env = createMockCtx().env
    env.CRAWL_WORKFLOW.create.mockRejectedValueOnce(new Error('tmp')).mockResolvedValueOnce(undefined)
    await svc.createWorkflow(env, { url: 'https://a.com', bookmarkId: 1, userId: 1 } as any)
    expect(env.CRAWL_WORKFLOW.create).toHaveBeenCalledTimes(2)
  })

  test('全部重试失败 → FAILED + 告警 + 抛出', async () => {
    const { svc, br, ab } = wireCrawlService()
    const env = createMockCtx().env
    env.CRAWL_WORKFLOW.create.mockRejectedValue(new Error('persistent'))
    await expect(svc.createWorkflow(env, { url: 'https://a.com', bookmarkId: 42, userId: 1 } as any, 2))
      .rejects.toThrow('persistent')
    expect(br.updateBookmarkStatus).toHaveBeenCalledWith(42, 'failed')
    expect(ab.crawl.pushMessage).toHaveBeenCalledWith(expect.stringContaining('workflow_creation Failed'))
  })

  test('hostname 正常 URL', async () => {
    const { svc, ls } = wireCrawlService()
    await svc.createWorkflow(createMockCtx().env, { url: 'https://github.com/repo', bookmarkId: 1, userId: 1 } as any)
    expect(ls.track).toHaveBeenCalledWith(1, 'bookmark_add_step', expect.objectContaining({ domain: 'github.com' }))
  })

  test('hostname 无效 URL → "unknown"', async () => {
    const { svc, ls } = wireCrawlService()
    await svc.createWorkflow(createMockCtx().env, { url: 'not-a-url', bookmarkId: 1, userId: 1 } as any)
    expect(ls.track).toHaveBeenCalledWith(1, 'bookmark_add_step', expect.objectContaining({ domain: 'unknown' }))
  })
})

describe('CrawlService.createImportParseWorkflow 重试', () => {
  test('首次成功', async () => {
    const { svc } = wireCrawlService()
    const env = createMockCtx().env
    await svc.createImportParseWorkflow(env, { url: 'https://a.com', bookmarkId: 1, userId: 1 } as any)
    expect(env.IMPORT_PARSE_WORKFLOW.create).toHaveBeenCalledTimes(1)
  })

  test('全部重试失败 → FAILED + 抛出', async () => {
    const { svc, br } = wireCrawlService()
    const env = createMockCtx().env
    env.IMPORT_PARSE_WORKFLOW.create.mockRejectedValue(new Error('fail'))
    await expect(svc.createImportParseWorkflow(env, { url: 'https://a.com', bookmarkId: 5, userId: 1 } as any, 2))
      .rejects.toThrow('fail')
    expect(br.updateBookmarkStatus).toHaveBeenCalledWith(5, 'failed')
  })
})

describe('bound capture dispatch', () => {
  test.each(['createWorkflow', 'createImportParseWorkflow'] as const)('%s forwards the admitted capture revision', async method => {
    const { svc } = wireCrawlService()
    const env = createMockCtx().env
    const captureRevision = '2026-10-22T00:00:00.000Z'
    await svc[method](env, { url: 'https://example.com/article', bookmarkId: 42, userId: 1, captureRevision } as any)
    const binding = method === 'createWorkflow' ? env.CRAWL_WORKFLOW : env.IMPORT_PARSE_WORKFLOW
    expect(binding.create).toHaveBeenCalledWith(expect.objectContaining({ params: expect.objectContaining({ captureRevision }) }))
  })

  test('a superseded revision does not dispatch or reset the capture', async () => {
    const { svc, br } = wireCrawlService()
    const env = createMockCtx().env
    await svc.createWorkflow(env, { url: 'https://example.com/article', bookmarkId: 42, userId: 1, captureRevision: '2026-10-21T00:00:00.000Z' } as any)
    expect(env.CRAWL_WORKFLOW.create).not.toHaveBeenCalled()
    expect(br.updateBookmarkStatus).not.toHaveBeenCalled()
    expect(br.updateBookmark).not.toHaveBeenCalled()
  })
})
