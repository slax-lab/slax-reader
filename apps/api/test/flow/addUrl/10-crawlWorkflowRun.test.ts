/**
 * /add_url Layer 10: CrawlWorkflow.run() 控制流测试
 * 直接测试 CrawlWorkflow 的 step 编排、状态转换、错误处理
 */
import { describe, test, expect, vi, beforeEach } from 'vitest'

vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {},
  WorkflowEvent: class {},
  WorkflowStep: class {}
}))
vi.mock('cloudflare:workflows', () => ({
  NonRetryableError: class NonRetryableError extends Error {
    constructor(msg: string) {
      super(msg)
      this.name = 'NonRetryableError'
    }
  }
}))

// ---- Mock DI ----
const mockResolveMap = new Map<any, any>()

vi.mock('@/decorators/di', () => ({
  container: {
    clone: vi.fn(() => ({
      resolve: vi.fn((cls: any) => mockResolveMap.get(cls))
    }))
  },
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))
vi.mock('@/di/generated/dependency', () => ({
  initializeCore: vi.fn(),
  initializeInfrastructure: vi.fn()
}))
vi.mock('@/utils/context', () => ({
  ContextManager: vi.fn().mockImplementation((_ctx: any, env: any) => ({
    setUserInfo: vi.fn(),
    setHashIds: vi.fn(),
    env,
    execution: { waitUntil: vi.fn((p: Promise<any>) => p.catch(() => {})) }
  }))
}))
vi.mock('@/utils/hashids', () => ({
  Hashid: vi.fn().mockImplementation(() => ({ encodeId: vi.fn((id: number) => id * 100) }))
}))

import { CrawlWorkflow } from '@/entry/edge/workflows/crawlWorkflow'
import { CrawlService } from '@/domain/crawl'
import { BookmarkService } from '@/domain/bookmark'
import { UrlParserHandler } from '@/domain/orchestrator/urlParser'
import { TelegramBotService } from '@/domain/telegram'
import { ImportService } from '@/domain/import'
import { MultiLangError } from '@/utils/multiLangError'
import { ErrorName } from '@/const/err'
import {
  createMockEnv,
  createMockCrawlService,
  createMockBookmarkService,
  createMockUrlParserHandler,
  createMockTelegramBotService,
  createMockImportService,
  createMockStep,
  createMockWorkflowEvent,
  STANDARD_CRAWL_RESULT
} from '@test/helpers/mockFactory'

function wireWorkflow() {
  const cs = createMockCrawlService()
  const bs = createMockBookmarkService()
  const uph = createMockUrlParserHandler()
  const tg = createMockTelegramBotService()
  const imp = createMockImportService()

  mockResolveMap.clear()
  mockResolveMap.set(CrawlService, cs)
  mockResolveMap.set(BookmarkService, bs)
  mockResolveMap.set(UrlParserHandler, uph)
  mockResolveMap.set(TelegramBotService, tg)
  mockResolveMap.set(ImportService, imp)

  const env = createMockEnv()
  const wf = new (CrawlWorkflow as any)()
  wf.ctx = {}
  wf.env = env

  return { wf, cs, bs, uph, tg, imp, env }
}

// ---- Helper: run workflow ----
async function runWorkflow(wf: any, eventOverrides: Record<string, unknown> = {}, step?: any) {
  const event = createMockWorkflowEvent(eventOverrides)
  const mockStep = step ?? createMockStep()
  return wf.run(event, mockStep)
}

describe('CrawlWorkflow fetch step 状态转换', () => {
  test('fetch 开始 → 设置 status=parseing', async () => {
    const { wf, cs, bs } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>hi</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf)

    expect(bs.updateBookmarkStatus).toHaveBeenCalledWith(42, 'parseing')
  })

  test('regular URL 成功 → fetchRegular + parseAndSaveContent + post-processing', async () => {
    const { wf, cs, bs, uph } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>hi</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf)

    expect(cs.fetchRegular).toHaveBeenCalled()
    expect(cs.parseAndSaveContent).toHaveBeenCalled()
    expect(uph.processPostHandler).toHaveBeenCalled()
    expect(cs.sendAddBookmarkStepEvent).toHaveBeenCalledWith(1, 42, 'example.com', 'complete', 'success')
  })
})

describe('CrawlWorkflow 缓存命中 (shortCircuit)', () => {
  test('历史公开文章已有内容 → 跳过 fetch/parse，直接 post-processing', async () => {
    const { wf, cs, bs, uph } = wireWorkflow()
    bs.getBookmarkTitleAndTextContentTry.mockResolvedValue({ title: 'Cached', textContent: 'Cached body', byline: 'Author', privateUser: 0 })

    await runWorkflow(wf)

    expect(cs.fetchRegular).not.toHaveBeenCalled()
    expect(cs.fetchTwitterData).not.toHaveBeenCalled()
    expect(cs.sendAddBookmarkStepEvent).toHaveBeenCalledWith(1, 42, 'example.com', 'content_fetch_cached', 'success')
    expect(uph.processPostHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ title: 'Cached', textContent: 'Cached body', byline: 'Author' })
    )
  })

  test('私有文章已有内容 → 重新 fetch/parse，不复用缓存', async () => {
    const { wf, cs, bs } = wireWorkflow()
    bs.getBookmarkTitleAndTextContentTry.mockResolvedValue({ title: 'Old', textContent: 'Old body', byline: 'Author', privateUser: 1 })
    cs.fetchRegular.mockResolvedValue({ content: '<p>new</p>', url: 'https://example.com/article', title: 'New' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf)

    expect(bs.updateBookmarkStatus).toHaveBeenCalledWith(42, 'parseing')
    expect(cs.fetchRegular).toHaveBeenCalled()
    expect(cs.parseAndSaveContent).toHaveBeenCalled()
    expect(cs.sendAddBookmarkStepEvent).not.toHaveBeenCalledWith(1, 42, 'example.com', 'content_fetch_cached', 'success')
  })
})

describe('CrawlWorkflow 社交媒体路由 + parse step', () => {
  test('twitter URL → fetchTwitterData + parse step 调 parseAndSaveTwitter', async () => {
    const { wf, cs, env } = wireWorkflow()
    const twitterData = { kind: 'tweet', tweetInfo: { text: 'hello' } }
    cs.fetchTwitterData.mockResolvedValue(twitterData)
    cs.parseAndSaveTwitter.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { url: 'https://x.com/user/status/123' })

    expect(cs.fetchTwitterData).toHaveBeenCalled()
    expect(cs.parseAndSaveTwitter).toHaveBeenCalled()
    expect(env.CONTENT_VALIDATION_WORKFLOW.create).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ bookmarkId: 42, contentKey: STANDARD_CRAWL_RESULT.contentKey }) })
    )
  })

  test('xhs URL → fetchXhsData + parse step 调 parseAndSaveXhs', async () => {
    const { wf, cs } = wireWorkflow()
    cs.fetchXhsData.mockResolvedValue({ title: 'note' })
    cs.parseAndSaveXhs.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { url: 'https://www.xiaohongshu.com/explore/abc' })

    expect(cs.fetchXhsData).toHaveBeenCalled()
    expect(cs.parseAndSaveXhs).toHaveBeenCalled()
  })

  test('weibo URL → fetchWeiboData + parseAndSaveWeibo', async () => {
    const { wf, cs } = wireWorkflow()
    cs.fetchWeiboData.mockResolvedValue({ id: '1', text: 'hi' })
    cs.parseAndSaveWeibo.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { url: 'https://weibo.com/123/abc' })

    expect(cs.fetchWeiboData).toHaveBeenCalled()
    expect(cs.parseAndSaveWeibo).toHaveBeenCalled()
  })

  test('reddit URL → fetchRedditData + parseAndSaveReddit', async () => {
    const { wf, cs } = wireWorkflow()
    cs.fetchRedditData.mockResolvedValue({ title: 'Post' })
    cs.parseAndSaveReddit.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { url: 'https://www.reddit.com/r/test/comments/abc/title' })

    expect(cs.fetchRedditData).toHaveBeenCalled()
    expect(cs.parseAndSaveReddit).toHaveBeenCalled()
  })

  test('zhihu URL → fetchZhihuData + parse step 调 parseAndSaveZhihu', async () => {
    const { wf, cs } = wireWorkflow()
    cs.fetchZhihuData.mockResolvedValue({ content: '<article data-content-type="qa">QA</article>', title: 'Question', author: '知乎回答' })
    cs.parseAndSaveZhihu.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { url: 'https://www.zhihu.com/question/123' })

    expect(cs.fetchZhihuData).toHaveBeenCalled()
    expect(cs.parseAndSaveZhihu).toHaveBeenCalled()
    expect(cs.parseAndSaveContent).not.toHaveBeenCalled()
  })
})

describe('CrawlWorkflow inlineContent 分支', () => {
  test('inlineContent + 非社交 → 使用 inline 内容 (跳过 fetchRegular)', async () => {
    const { wf, cs } = wireWorkflow()
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { inlineContent: '<p>inline</p>' })

    expect(cs.fetchRegular).not.toHaveBeenCalled()
    expect(cs.parseAndSaveContent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ content: '<p>inline</p>' }), 42, 'ub-test-uuid')
  })

  test('inlineContent + 社交媒体 → 忽略 inline, 走平台 fetch', async () => {
    const { wf, cs } = wireWorkflow()
    const twitterData = { kind: 'tweet', tweetInfo: { text: 'tw' } }
    cs.fetchTwitterData.mockResolvedValue(twitterData)
    cs.parseAndSaveTwitter.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { url: 'https://x.com/user/status/1', inlineContent: '<p>ignored</p>' })

    expect(cs.fetchTwitterData).toHaveBeenCalled()
    expect(cs.parseAndSaveContent).not.toHaveBeenCalled()
  })
})

describe('CrawlWorkflow weixin 路由', () => {
  test('weixin 成功 → fetchWeixin + parseAndSaveWeixin 同 step 完成，返回 parsed', async () => {
    const { wf, cs, uph } = wireWorkflow()
    cs.fetchWeixin.mockResolvedValue({ source: 'tikhub', content: { title: 'WX', nick_name: 'n', content_noencode: '<p>wechat</p>' } })
    cs.parseAndSaveWeixin.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { url: 'https://mp.weixin.qq.com/s?__biz=M&mid=1' })

    expect(cs.fetchWeixin).toHaveBeenCalled()
    expect(cs.parseAndSaveWeixin).toHaveBeenCalled()
    expect(uph.processPostHandler).toHaveBeenCalled()
  })

  test('weixin 业务终态 (WEIXIN_ENV_ABNORMAL) → NonRetryableError → FAILED', async () => {
    const { wf, cs, bs } = wireWorkflow()
    cs.fetchWeixin.mockRejectedValue(new MultiLangError(ErrorName.WEIXIN_ENV_ABNORMAL, 500, { en: 'env abnormal' }))

    await expect(runWorkflow(wf, { url: 'https://mp.weixin.qq.com/s?__biz=M&mid=1' })).rejects.toThrow()

    expect(bs.updateBookmarkStatus).toHaveBeenCalledWith(42, 'failed')
    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalledWith(1, 'workflow_fetch.business_terminal', expect.objectContaining({ bookmark_id: 42 }))
  })

  test('weixin 业务终态 (DAJIALA_ARTICLE_UNAVAILABLE) → NonRetryableError → FAILED', async () => {
    const { wf, cs, bs } = wireWorkflow()
    cs.fetchWeixin.mockRejectedValue(new MultiLangError(ErrorName.DAJIALA_ARTICLE_UNAVAILABLE, 404, { en: 'unavailable' }))

    await expect(runWorkflow(wf, { url: 'https://mp.weixin.qq.com/s?__biz=M&mid=1' })).rejects.toThrow()

    expect(bs.updateBookmarkStatus).toHaveBeenCalledWith(42, 'failed')
  })

  test('weixin 图片流 (tikhub item_show_type=8) → 短正文不触发 soft404，但触发内容验证', async () => {
    const { wf, cs, env } = wireWorkflow()
    cs.fetchWeixin.mockResolvedValue({ source: 'tikhub', content: { title: 'WX', nick_name: 'n', content_noencode: '<p>x</p>', item_show_type: 8 } })
    cs.parseAndSaveWeixin.mockResolvedValue({ ...STANDARD_CRAWL_RESULT, textContent: 'Short' })

    await runWorkflow(wf, { url: 'https://mp.weixin.qq.com/s?__biz=M&mid=1' })

    const alertCalls = cs.pushBookmarkFailureAlert.mock.calls
    expect(alertCalls.every((c: any[]) => c[1] !== 'workflow_parse.soft_404')).toBe(true)
    expect(env.CONTENT_VALIDATION_WORKFLOW.create).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ bookmarkId: 42, contentKey: STANDARD_CRAWL_RESULT.contentKey }) })
    )
  })

  test('weixin 图片流 (legacy #js_image_desc) → 视为社媒：短正文不触发 soft404', async () => {
    const { wf, cs } = wireWorkflow()
    cs.fetchWeixin.mockResolvedValue({ source: 'legacy', fetchRes: { content: '<div id="js_image_desc">imgs</div>', url: 'https://mp.weixin.qq.com/s/x', title: 'WX' } })
    cs.parseAndSaveWeixin.mockResolvedValue({ ...STANDARD_CRAWL_RESULT, textContent: 'Short' })

    await runWorkflow(wf, { url: 'https://mp.weixin.qq.com/s?__biz=M&mid=1' })

    const alertCalls = cs.pushBookmarkFailureAlert.mock.calls
    expect(alertCalls.every((c: any[]) => c[1] !== 'workflow_parse.soft_404')).toBe(true)
  })

  test('weixin parse 失败 → 归到 fetch step 失败路径 (exhausted) + FAILED', async () => {
    const { wf, cs, bs } = wireWorkflow()
    cs.fetchWeixin.mockResolvedValue({ source: 'tikhub', content: { title: 'WX', nick_name: 'n', content_noencode: '<p>wechat</p>' } })
    // parse 现在与 fetch 同 step：失败走 fetch 的重试/失败路径，而非旧的独立 parse step
    cs.parseAndSaveWeixin.mockRejectedValue(new Error('parse boom'))

    await expect(runWorkflow(wf, { url: 'https://mp.weixin.qq.com/s?__biz=M&mid=1' })).rejects.toThrow()

    expect(bs.updateBookmarkStatus).toHaveBeenCalledWith(42, 'failed')
    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalledWith(1, 'workflow_fetch.exhausted', expect.objectContaining({ bookmark_id: 42 }))
  })
})

describe('CrawlWorkflow fetch 失败路径', () => {
  test('fetch 异常 (retries exhausted) → FAILED + alert(exhausted)', async () => {
    const { wf, cs, bs } = wireWorkflow()
    cs.fetchRegular.mockRejectedValue(new Error('network timeout'))

    await expect(runWorkflow(wf)).rejects.toThrow('network timeout')

    expect(bs.updateBookmarkStatus).toHaveBeenCalledWith(42, 'failed')
    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalledWith(1, 'workflow_fetch.exhausted', expect.objectContaining({ bookmark_id: 42, error: 'network timeout' }))
  })

  test('fetch 失败 + importTaskId → 更新 import relation(status=2) + incr(0,1)', async () => {
    const { wf, cs, bs, imp } = wireWorkflow()
    cs.fetchRegular.mockRejectedValue(new Error('fail'))

    await expect(runWorkflow(wf, { importTaskId: 99 })).rejects.toThrow()

    expect(bs.updateBookmarkImportRelationStatus).toHaveBeenCalledWith(1, 42, 99, 2)
    expect(imp.incrImportTask).toHaveBeenCalledWith(expect.anything(), 1, 99, 0, 1)
  })

  test('fetch 失败 + 无 importTaskId → 不更新 import', async () => {
    const { wf, bs, cs } = wireWorkflow()
    cs.fetchRegular.mockRejectedValue(new Error('fail'))

    await expect(runWorkflow(wf)).rejects.toThrow()

    expect(bs.updateBookmarkImportRelationStatus).not.toHaveBeenCalled()
  })
})

describe('CrawlWorkflow parse step 失败路径', () => {
  test('parseAndSaveTwitter 异常 → FAILED + alert(workflow_parse.error)', async () => {
    const { wf, cs, bs } = wireWorkflow()
    cs.fetchTwitterData.mockResolvedValue({ kind: 'tweet', tweetInfo: { text: 'hi' } })
    cs.parseAndSaveTwitter.mockRejectedValue(new Error('parse boom'))

    await expect(runWorkflow(wf, { url: 'https://x.com/user/status/1' })).rejects.toThrow()

    expect(bs.updateBookmarkStatus).toHaveBeenCalledWith(42, 'failed')
    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalledWith(1, 'workflow_parse.error', expect.objectContaining({ bookmark_id: 42 }))
  })

  test('parse 失败 + importTaskId → 更新 import relation', async () => {
    const { wf, cs, bs, imp } = wireWorkflow()
    cs.fetchTwitterData.mockResolvedValue({ kind: 'tweet', tweetInfo: {} })
    cs.parseAndSaveTwitter.mockRejectedValue(new Error('parse fail'))

    await expect(runWorkflow(wf, { url: 'https://x.com/user/status/1', importTaskId: 50 })).rejects.toThrow()

    expect(bs.updateBookmarkImportRelationStatus).toHaveBeenCalledWith(1, 42, 50, 2)
    expect(imp.incrImportTask).toHaveBeenCalledWith(expect.anything(), 1, 50, 0, 1)
  })
})

describe('CrawlWorkflow 软 404 + 内容验证', () => {
  test('textContent < 15 chars + 非社交 → soft 404 alert', async () => {
    const { wf, cs } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue({ ...STANDARD_CRAWL_RESULT, textContent: 'Short' })

    await runWorkflow(wf)

    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalledWith(1, 'workflow_parse.soft_404', expect.objectContaining({ bookmark_id: 42 }))
  })

  test('textContent < 15 + 社交媒体 → 不触发 soft 404', async () => {
    const { wf, cs } = wireWorkflow()
    cs.fetchTwitterData.mockResolvedValue({ kind: 'tweet', tweetInfo: { text: 'hi' } })
    cs.parseAndSaveTwitter.mockResolvedValue({ ...STANDARD_CRAWL_RESULT, textContent: 'Short' })

    await runWorkflow(wf, { url: 'https://x.com/user/status/1' })

    const alertCalls = cs.pushBookmarkFailureAlert.mock.calls
    expect(alertCalls.every((c: any[]) => c[1] !== 'workflow_parse.soft_404')).toBe(true)
  })

  test('正常内容 + 有 contentKey → 触发 CONTENT_VALIDATION_WORKFLOW', async () => {
    const { wf, cs, env } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf)

    expect(env.CONTENT_VALIDATION_WORKFLOW.create).toHaveBeenCalledWith(
      expect.objectContaining({
        params: expect.objectContaining({ bookmarkId: 42, contentKey: STANDARD_CRAWL_RESULT.contentKey })
      })
    )
  })

  test('soft 404 → CONTENT_VALIDATION_WORKFLOW 不触发', async () => {
    const { wf, cs, env } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue({ ...STANDARD_CRAWL_RESULT, textContent: 'Tiny' })

    await runWorkflow(wf)

    expect(env.CONTENT_VALIDATION_WORKFLOW.create).not.toHaveBeenCalled()
  })

  test('CONTENT_VALIDATION_WORKFLOW.create 失败 → alert + workflow 继续', async () => {
    const { wf, cs, env, uph } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)
    env.CONTENT_VALIDATION_WORKFLOW.create.mockRejectedValue(new Error('create failed'))

    await runWorkflow(wf)

    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalledWith(1, 'post_processing.content_validation', expect.objectContaining({ bookmark_id: 42 }))
    expect(uph.processPostHandler).toHaveBeenCalled()
  })
})

describe('CrawlWorkflow post-processing step', () => {
  test('processPostHandler 接收正确参数', async () => {
    const { wf, cs, uph } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { callbackChatId: 555, callbackOriginMessageId: 666, ignoreGenerateTag: true })

    expect(uph.processPostHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        info: expect.objectContaining({
          userId: 1,
          bookmarkId: 42,
          callbackPayload: { chat_id: 555, origin_message_id: 666 },
          ignoreGenerateTag: true
        })
      }),
      expect.objectContaining({ title: STANDARD_CRAWL_RESULT.title })
    )
  })

  test('soft 404 → ignoreGenerateTag 强制为 true', async () => {
    const { wf, cs, uph } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue({ ...STANDARD_CRAWL_RESULT, textContent: 'Tiny' })

    await runWorkflow(wf, { ignoreGenerateTag: false })

    expect(uph.processPostHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        info: expect.objectContaining({ ignoreGenerateTag: true })
      }),
      expect.anything()
    )
  })

  test('callbackChatId 存在 → initTelegramBot 被调用', async () => {
    const { wf, cs, tg } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { callbackChatId: 100 })

    expect(tg.initTelegramBot).toHaveBeenCalled()
  })

  test('callbackChatId=0 → initTelegramBot 不调用', async () => {
    const { wf, cs, tg } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { callbackChatId: 0 })

    expect(tg.initTelegramBot).not.toHaveBeenCalled()
  })

  test('post-processing 失败 → 不 throw, alert 发送, workflow 完成', async () => {
    const { wf, cs, uph } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)
    uph.processPostHandler.mockRejectedValue(new Error('post fail'))

    await runWorkflow(wf)

    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalledWith(1, 'post_processing.failed', expect.objectContaining({ error: 'post fail' }))
    expect(cs.sendAddBookmarkStepEvent).toHaveBeenCalledWith(1, 42, 'example.com', 'complete', 'success')
  })
})

describe('CrawlWorkflow import 追踪', () => {
  test('成功 + importTaskId → update-import step 调用 (status=1, incr 1,0)', async () => {
    const { wf, cs, bs, imp } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { importTaskId: 77 })

    expect(bs.updateBookmarkImportRelationStatus).toHaveBeenCalledWith(1, 42, 77, 1)
    expect(imp.incrImportTask).toHaveBeenCalledWith(expect.anything(), 1, 77, 1, 0)
  })

  test('无 importTaskId → update-import step 不执行', async () => {
    const { wf, cs, bs, imp } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf)

    const stepCalls = (createMockStep().do as any).mock?.calls ?? []
    expect(bs.updateBookmarkImportRelationStatus).not.toHaveBeenCalled()
    expect(imp.incrImportTask).not.toHaveBeenCalled()
  })

  test('update-import step 失败 → 静默捕获, workflow 完成', async () => {
    const { wf, cs, bs, imp } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)
    bs.updateBookmarkImportRelationStatus.mockRejectedValue(new Error('db error'))

    await expect(runWorkflow(wf, { importTaskId: 77 })).resolves.toBeUndefined()
  })
})

describe('CrawlWorkflow hostname 提取', () => {
  test('有效 URL → 正确 hostname', async () => {
    const { wf, cs } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { url: 'https://github.com/repo' })

    expect(cs.sendAddBookmarkStepEvent).toHaveBeenCalledWith(1, 42, 'github.com', expect.any(String), expect.any(String))
  })

  test('无效 URL → "unknown"', async () => {
    const { wf, cs } = wireWorkflow()
    cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'not-a-url', title: 'T' })
    cs.parseAndSaveContent.mockResolvedValue(STANDARD_CRAWL_RESULT)

    await runWorkflow(wf, { url: 'not-a-url' })

    expect(cs.sendAddBookmarkStepEvent).toHaveBeenCalledWith(1, 42, 'unknown', expect.any(String), expect.any(String))
  })
})
