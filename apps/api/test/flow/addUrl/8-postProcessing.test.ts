/**
 * /add_url Layer 8: processPostHandler 全分支
 * 来源: urlParser.ts:67-205
 * 实例化真实 UrlParserHandler，调用 processPostHandler() 测试每个回调分支
 */
import { describe, test, expect, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))

import { UrlParserHandler } from '@/domain/orchestrator/urlParser'
import {
  createMockMediaSnapshots,
  createMockSearchService,
  createMockUserService,
  createMockTagService,
  createMockAigcService,
  createMockTelegramBotService,
  createMockBookmarkService,
  createMockCrawlService,
  createMockLogsService,
  createMockCtx
} from '@test/helpers/mockFactory'

function wireHandler() {
  const bs = createMockBookmarkService()
  const tg = createMockTelegramBotService()
  const search = createMockSearchService()
  const user = createMockUserService()
  const tags = createMockTagService()
  const aigc = createMockAigcService()
  const crawl = createMockCrawlService()
  const logs = createMockLogsService()

  const handler = new (UrlParserHandler as any)()
  ;(handler as any).snapshots = createMockMediaSnapshots()
  ;(handler as any).bookmarkSvc = bs
  ;(handler as any).telegramBotSvc = tg
  ;(handler as any).searchSvc = search
  ;(handler as any).userSvc = user
  ;(handler as any).tagSvc = tags
  ;(handler as any).aigcSvc = aigc
  ;(handler as any).crawlSvc = crawl
  ;(handler as any).logsService = logs

  return { handler: handler as UrlParserHandler, bs, tg, search, user, tags, aigc, crawl, logs }
}

function makeTaskInfo(overrides: Record<string, unknown> = {}) {
  return {
    id: 'workflow_42',
    info: {
      userId: 1,
      bookmarkId: 42,
      targetUrl: 'https://example.com/article',
      targetTitle: 'Test Article',
      callback: 0,
      callbackPayload: {},
      ignoreGenerateTag: false,
      parserType: 'server_puppeteer_parse',
      privateUser: 0,
      resource: '',
      ...overrides
    }
  } as any
}

const parseRes = { title: 'Test', textContent: 'Test content', byline: 'Author' }

async function callAndAwait(handler: UrlParserHandler, ctx: any, taskInfo: any, res = parseRes) {
  await handler.processPostHandler(ctx, taskInfo, res)
  await Promise.all(ctx.execution.waitUntil.mock.calls.map(([work]: [Promise<unknown>]) => work))
}

describe('explicit vector postprocessing', () => {
  test('enqueues exactly one actor article after legacy embedding fails', async () => {
    const { handler, search } = wireHandler()
    const ctx = createMockCtx()
    search.addSearchRecord.mockRejectedValue(new Error('legacy embedding unavailable'))
    await handler.processPostHandler(ctx, makeTaskInfo(), parseRes)
    expect(ctx.env.VECTOR_V5_MAINTENANCE_WORKFLOW.create).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ params: expect.objectContaining({ target: { kind: 'article', userId: 1, id: 42 } }) })
    )
    expect(ctx.env.VECTOR_V5_MAINTENANCE_WORKFLOW.createBatch).not.toHaveBeenCalled()
    expect(ctx.execution.waitUntil).not.toHaveBeenCalled()
  })

  test('propagates durable admission failure instead of detaching it', async () => {
    const { handler } = wireHandler()
    const ctx = createMockCtx()
    ctx.env.VECTOR_V5_MAINTENANCE_WORKFLOW.create.mockRejectedValue(new Error('admission unavailable'))
    await expect(handler.processPostHandler(ctx, makeTaskInfo(), parseRes)).rejects.toThrow('admission unavailable')
  })

  test.each([false, true])('cached queue completion admits explicit owners without refetching: retry=%s', async retry => {
    const { handler, bs } = wireHandler()
    const ctx = createMockCtx()
    Object.assign(handler, { bookmarkService: bs })
    bs.getBookmarkById.mockResolvedValue({ status: 'success', private_user: 1 })
    bs.getBookmarkTitleAndTextContentTry.mockResolvedValue(parseRes)
    const callback = vi.fn().mockRejectedValue(new Error('legacy callback failed'))
    const fetch = vi.spyOn(UrlParserHandler, 'fetchContent')
    try {
      const message = retry ? { ...makeTaskInfo().info, userId: undefined, retry: { userIds: [1, 2, 1], retryCount: 1 } } : makeTaskInfo().info
      if (retry) delete message.userId
      await handler.parseUrl(ctx, 'queue', message, [callback])
      expect(fetch).not.toHaveBeenCalled()
      expect(ctx.env.VECTOR_V5_MAINTENANCE_WORKFLOW.create.mock.calls.map(([args]: any[]) => args.params.target)).toEqual(
        retry
          ? [
              { kind: 'article', userId: 1, id: 42 },
              { kind: 'article', userId: 2, id: 42 }
            ]
          : [{ kind: 'article', userId: 1, id: 42 }]
      )
    } finally {
      fetch.mockRestore()
    }
  })

  test('cached third party completion uses the same posthandler without fetching', async () => {
    const { handler, bs, crawl } = wireHandler()
    const ctx = createMockCtx()
    bs.getBookmarkById.mockResolvedValue({ status: 'success', private_user: 1 })
    bs.getBookmarkTitleAndTextContentTry.mockResolvedValue(parseRes)
    await handler.processThirdPartyMessages(ctx, [makeTaskInfo({ targetUrl: 'https://x.com/u/status/42' })])
    expect(ctx.env.VECTOR_V5_MAINTENANCE_WORKFLOW.create).toHaveBeenCalledTimes(1)
    expect(crawl.fetchTwitterData).not.toHaveBeenCalled()
  })

  test('legacy-only workflow callback cannot enqueue a duplicate article event', async () => {
    const { handler } = wireHandler()
    const ctx = createMockCtx()
    await handler.processContentPostProcessing(ctx, makeTaskInfo(), parseRes)
    expect(ctx.env.VECTOR_V5_MAINTENANCE_WORKFLOW.create).not.toHaveBeenCalled()
  })
})

describe('telegramCallback', () => {
  test('callback === 1 (CALLBACK_TELEGRAM) → telegramBotSvc.callback 调用', async () => {
    const { handler, tg } = wireHandler()
    const ctx = createMockCtx()
    const taskInfo = makeTaskInfo({ callback: 1, callbackPayload: { chat_id: 555 } })

    await callAndAwait(handler, ctx, taskInfo)

    expect(tg.callback).toHaveBeenCalledWith(expect.anything(), { chat_id: 555 })
  })

  test('callback !== 1 → telegramBotSvc.callback 不调用', async () => {
    const { handler, tg } = wireHandler()
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo({ callback: 0 }))

    expect(tg.callback).not.toHaveBeenCalled()
  })
})

describe('searchCallback', () => {
  test('成功 → addSearchRecord + track(embedding, success)', async () => {
    const { handler, search, logs } = wireHandler()
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(search.addSearchRecord).toHaveBeenCalledWith(ctx, 42, 'Test', 'Test content')
    expect(logs.track).toHaveBeenCalledWith(
      1,
      'bookmark_add_step',
      expect.objectContaining({
        step_name: 'embedding',
        status: 'success'
      })
    )
  })

  test('addSearchRecord 内部 rejected（embedding 真失败）→ track(embedding, failed) + pushBookmarkFailureAlert', async () => {
    const { handler, search, logs, crawl } = wireHandler()
    search.addSearchRecord.mockResolvedValue([
      { status: 'fulfilled', value: [] },
      { status: 'rejected', reason: new Error('vector db error') }
    ])
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(logs.track).toHaveBeenCalledWith(
      1,
      'bookmark_add_step',
      expect.objectContaining({
        step_name: 'embedding',
        status: 'failed',
        error_reason: 'vector db error'
      })
    )
    expect(crawl.pushBookmarkFailureAlert).toHaveBeenCalledWith(
      1,
      'embedding',
      expect.objectContaining({
        error: 'vector db error'
      })
    )
  })

  test('addSearchRecord 全 fulfilled → track(embedding, success)', async () => {
    const { handler, search, logs } = wireHandler()
    search.addSearchRecord.mockResolvedValue([
      { status: 'fulfilled', value: [] },
      { status: 'fulfilled', value: [] }
    ])
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(logs.track).toHaveBeenCalledWith(
      1,
      'bookmark_add_step',
      expect.objectContaining({
        step_name: 'embedding',
        status: 'success'
      })
    )
  })
})

describe('tagsAndOverviewCallback', () => {
  test('ignoreGenerateTag=true → 跳过 (不调 getUserSubscriptionInfo)', async () => {
    const { handler, user } = wireHandler()
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo({ ignoreGenerateTag: true }))

    expect(user.getUserSubscriptionInfo).not.toHaveBeenCalled()
  })

  test('未订阅 (null) → 跳过 AIGC', async () => {
    const { handler, user, aigc } = wireHandler()
    user.getUserSubscriptionInfo.mockResolvedValue(null)
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(aigc.generateOverviewTag).not.toHaveBeenCalled()
  })

  test('订阅过期 → 跳过 AIGC', async () => {
    const { handler, user, aigc } = wireHandler()
    user.getUserSubscriptionInfo.mockResolvedValue({ subscription_end_at: new Date(Date.now() - 86400000) })
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(aigc.generateOverviewTag).not.toHaveBeenCalled()
  })

  test('命中内容审核 (moderation_result>0) → 跳过 AIGC', async () => {
    const { handler, user, aigc, bs } = wireHandler()
    user.getUserSubscriptionInfo.mockResolvedValue({ subscription_end_at: new Date(Date.now() + 86400000) })
    bs.getBookmarkById.mockResolvedValue({ id: 42, moderation_result: 1 })
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(aigc.generateOverviewTag).not.toHaveBeenCalled()
  })

  test('已订阅 + userInfo=null → 跳过 AIGC', async () => {
    const { handler, user, aigc } = wireHandler()
    user.getUserSubscriptionInfo.mockResolvedValue({ subscription_end_at: new Date(Date.now() + 86400000) })
    user.getUserInfo.mockResolvedValue(null)
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(aigc.generateOverviewTag).not.toHaveBeenCalled()
  })

  test('已订阅 + userInfo → generateOverviewTag 调用', async () => {
    const { handler, user, aigc } = wireHandler()
    user.getUserSubscriptionInfo.mockResolvedValue({ subscription_end_at: new Date(Date.now() + 86400000) })
    user.getUserInfo.mockResolvedValue({ ai_lang: 'zh' })
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(aigc.generateOverviewTag).toHaveBeenCalledWith(ctx, 'Test', 'Test content', 'Author', expect.any(Array))
  })

  test('overview 非空 → createBookmarkOverview', async () => {
    const { handler, user, aigc, bs } = wireHandler()
    user.getUserSubscriptionInfo.mockResolvedValue({ subscription_end_at: new Date(Date.now() + 86400000) })
    user.getUserInfo.mockResolvedValue({ ai_lang: 'en' })
    aigc.generateOverviewTag.mockResolvedValue({ overview: 'Summary', key_takeaways: ['p1'], tags: [] })
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(bs.createBookmarkOverview).toHaveBeenCalledWith(1, 42, '', expect.stringContaining('Summary'))
  })

  test('overview 为空 → 跳过写入', async () => {
    const { handler, user, aigc, bs } = wireHandler()
    user.getUserSubscriptionInfo.mockResolvedValue({ subscription_end_at: new Date(Date.now() + 86400000) })
    user.getUserInfo.mockResolvedValue({ ai_lang: 'en' })
    aigc.generateOverviewTag.mockResolvedValue({ overview: '', key_takeaways: [], tags: [] })
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(bs.createBookmarkOverview).not.toHaveBeenCalled()
  })

  test('tags 非空 + bookmarkTags 已存在 → 不写入新 tags', async () => {
    const { handler, user, aigc, tags } = wireHandler()
    user.getUserSubscriptionInfo.mockResolvedValue({ subscription_end_at: new Date(Date.now() + 86400000) })
    user.getUserInfo.mockResolvedValue({ ai_lang: 'en' })
    aigc.generateOverviewTag.mockResolvedValue({ overview: '', key_takeaways: [], tags: ['tech'] })
    tags.getBookmarkTags.mockResolvedValue([{ id: 1, name: 'existing' }])
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(tags.upsertBookmarkTags).not.toHaveBeenCalled()
  })

  test('tags 非空 + 无匹配 userTags → 不写入', async () => {
    const { handler, user, aigc, tags } = wireHandler()
    user.getUserSubscriptionInfo.mockResolvedValue({ subscription_end_at: new Date(Date.now() + 86400000) })
    user.getUserInfo.mockResolvedValue({ ai_lang: 'en' })
    aigc.generateOverviewTag.mockResolvedValue({ overview: '', key_takeaways: [], tags: ['tech'] })
    tags.getBookmarkTags.mockResolvedValue([])
    tags.listUserTags.mockResolvedValue([{ id: 1, name: 'sports' }])
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(tags.upsertBookmarkTags).not.toHaveBeenCalled()
  })

  test('tags 非空 + 全通过 → upsertBookmarkTags', async () => {
    const { handler, user, aigc, tags } = wireHandler()
    user.getUserSubscriptionInfo.mockResolvedValue({ subscription_end_at: new Date(Date.now() + 86400000) })
    user.getUserInfo.mockResolvedValue({ ai_lang: 'en' })
    aigc.generateOverviewTag.mockResolvedValue({ overview: '', key_takeaways: [], tags: ['tech'] })
    tags.getBookmarkTags.mockResolvedValue([])
    tags.listUserTags.mockResolvedValue([{ id: 1, name: 'tech' }])
    tags.updateUserTagsDisplay.mockResolvedValue([{ id: 1, name: 'tech' }])
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(tags.upsertBookmarkTags).toHaveBeenCalledWith(42, 1, [{ id: 1, name: 'tech' }])
  })

  test('tags 非空 → 我的标签优先、截到 3 个、词表外的丢弃', async () => {
    const { handler, user, aigc, tags } = wireHandler()
    user.getUserSubscriptionInfo.mockResolvedValue({ subscription_end_at: new Date(Date.now() + 86400000) })
    user.getUserInfo.mockResolvedValue({ ai_lang: 'zh' })
    aigc.generateOverviewTag.mockResolvedValue({ overview: '', key_takeaways: [], tags: ['技术', '创业', '人工智能', '育儿', '无关'] })
    tags.getBookmarkTags.mockResolvedValue([])
    tags.listUserTags.mockResolvedValue([
      { id: 1, name: '人工智能', source: 'auto' },
      { id: 2, name: '技术', source: 'auto' },
      { id: 3, name: '创业', source: 'mine' },
      { id: 4, name: '育儿', source: 'mine' }
    ])
    tags.updateUserTagsDisplay.mockResolvedValue([{ id: 3, tag_name: '创业' }])
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(tags.updateUserTagsDisplay).toHaveBeenCalledWith(1, ['创业', '育儿', '技术'])
    expect(aigc.generateOverviewTag).toHaveBeenCalledWith(
      ctx,
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.arrayContaining([expect.objectContaining({ name: '创业', source: 'mine' })])
    )
  })

  test('整体异常 → track(failed) + pushBookmarkFailureAlert', async () => {
    const { handler, user, logs, crawl } = wireHandler()
    user.getUserSubscriptionInfo.mockRejectedValue(new Error('AIGC timeout'))
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(logs.track).toHaveBeenCalledWith(
      1,
      'bookmark_add_step',
      expect.objectContaining({
        step_name: 'generate_overview_and_tags',
        status: 'failed'
      })
    )
    expect(crawl.pushBookmarkFailureAlert).toHaveBeenCalledWith(
      1,
      'generate_overview_and_tags',
      expect.objectContaining({
        error: 'AIGC timeout'
      })
    )
  })
})

describe('updateUserBookmarkCreateAtCallback', () => {
  test('成功 → updateUserBookmarkCreateAt 被调用', async () => {
    const { handler, bs } = wireHandler()
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(bs.updateUserBookmarkCreateAt).toHaveBeenCalledWith(42, 1, expect.any(Date))
  })

  test('失败 → 静默 (不影响其他回调)', async () => {
    const { handler, bs, search } = wireHandler()
    bs.updateUserBookmarkCreateAt.mockRejectedValue(new Error('fail'))
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(search.addSearchRecord).toHaveBeenCalled()
  })
})

describe('Promise.allSettled 隔离', () => {
  test('一个回调失败不影响其他', async () => {
    const { handler, search, bs } = wireHandler()
    search.addSearchRecord.mockRejectedValue(new Error('search fail'))
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo())

    expect(bs.updateUserBookmarkCreateAt).toHaveBeenCalled()
  })
})

describe('hostname 提取', () => {
  test('targetTitle 非空 + 有效 URL → hostname 从 URL 提取', async () => {
    const { handler, logs } = wireHandler()
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo({ targetTitle: 'Title', targetUrl: 'https://github.com/repo' }))

    expect(logs.track).toHaveBeenCalledWith(
      1,
      'bookmark_add_step',
      expect.objectContaining({
        domain: 'github.com'
      })
    )
  })

  test('targetTitle 为空 → hostname="unknown"', async () => {
    const { handler, logs } = wireHandler()
    const ctx = createMockCtx()

    await callAndAwait(handler, ctx, makeTaskInfo({ targetTitle: '' }))

    expect(logs.track).toHaveBeenCalledWith(
      1,
      'bookmark_add_step',
      expect.objectContaining({
        domain: 'unknown'
      })
    )
  })
})
