/**
 * /add_url Layer 7: 软404检测 + 内容验证触发 + import 追踪
 * 通过 CrawlWorkflow.run() 测试真实后处理逻辑
 * (路由/fetch/parse 见 Layer 10; 本文件聚焦 fetch 之后的决策分支)
 */
import { describe, test, expect, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {},
  WorkflowEvent: class {},
  WorkflowStep: class {}
}))
vi.mock('cloudflare:workflows', () => ({
  NonRetryableError: class NonRetryableError extends Error {
    constructor(msg: string) { super(msg); this.name = 'NonRetryableError' }
  }
}))

const mockResolveMap = new Map<any, any>()
vi.mock('@/decorators/di', () => ({
  container: { clone: vi.fn(() => ({ resolve: vi.fn((cls: any) => mockResolveMap.get(cls)) })) },
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))
vi.mock('@/di/generated/dependency', () => ({ initializeCore: vi.fn(), initializeInfrastructure: vi.fn() }))
vi.mock('@/utils/context', () => ({
  ContextManager: vi.fn().mockImplementation((_ctx: any, env: any) => ({
    setUserInfo: vi.fn(), setHashIds: vi.fn(), env,
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
import {
  createMockEnv, createMockCrawlService, createMockBookmarkService,
  createMockUrlParserHandler, createMockTelegramBotService, createMockImportService,
  createMockStep, createMockWorkflowEvent, STANDARD_CRAWL_RESULT
} from '@test/helpers/mockFactory'

function wireAndRun(eventOverrides: Record<string, unknown> = {}, crawlResultOverrides: Record<string, unknown> = {}) {
  const cs = createMockCrawlService()
  const bs = createMockBookmarkService()
  const uph = createMockUrlParserHandler()
  const tg = createMockTelegramBotService()
  const imp = createMockImportService()
  const env = createMockEnv()

  mockResolveMap.clear()
  mockResolveMap.set(CrawlService, cs)
  mockResolveMap.set(BookmarkService, bs)
  mockResolveMap.set(UrlParserHandler, uph)
  mockResolveMap.set(TelegramBotService, tg)
  mockResolveMap.set(ImportService, imp)

  cs.fetchRegular.mockResolvedValue({ content: '<p>x</p>', url: 'https://example.com/article', title: 'T' })
  cs.parseAndSaveContent.mockResolvedValue({ ...STANDARD_CRAWL_RESULT, ...crawlResultOverrides })

  const wf = new (CrawlWorkflow as any)()
  wf.ctx = {}
  wf.env = env

  const event = createMockWorkflowEvent(eventOverrides)
  const step = createMockStep()
  const run = () => wf.run(event, step)

  return { run, cs, bs, uph, imp, env }
}

describe('软 404 检测', () => {
  test('textContent < 15 + 非社交媒体 → alert(soft_404)', async () => {
    const { run, cs } = wireAndRun({}, { textContent: 'Error' })
    await run()
    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalledWith(
      1, 'workflow_parse.soft_404', expect.objectContaining({ text_content_length: 5 })
    )
  })

  test('textContent >= 15 → 不触发 soft 404', async () => {
    const { run, cs } = wireAndRun({}, { textContent: 'Long enough content!' })
    await run()
    const calls = cs.pushBookmarkFailureAlert.mock.calls
    expect(calls.every((c: any[]) => c[1] !== 'workflow_parse.soft_404')).toBe(true)
  })

  test('边界: 14 chars → soft 404; 15 chars → 不触发', async () => {
    const { run: run14, cs: cs14 } = wireAndRun({}, { textContent: '12345678901234' })
    await run14()
    expect(cs14.pushBookmarkFailureAlert).toHaveBeenCalledWith(1, 'workflow_parse.soft_404', expect.anything())

    const { run: run15, cs: cs15 } = wireAndRun({}, { textContent: '123456789012345' })
    await run15()
    expect(cs15.pushBookmarkFailureAlert.mock.calls.every((c: any[]) => c[1] !== 'workflow_parse.soft_404')).toBe(true)
  })

  test('社交媒体 textContent 短 → 不触发 soft 404', async () => {
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

    cs.fetchTwitterData.mockResolvedValue({ kind: 'tweet', tweetInfo: { text: 'hi' } })
    cs.parseAndSaveTwitter.mockResolvedValue({ ...STANDARD_CRAWL_RESULT, textContent: 'Short' })

    const env = createMockEnv()
    const wf = new (CrawlWorkflow as any)()
    wf.ctx = {}
    wf.env = env

    await wf.run(createMockWorkflowEvent({ url: 'https://x.com/user/status/1' }), createMockStep())

    expect(cs.pushBookmarkFailureAlert.mock.calls.every((c: any[]) => c[1] !== 'workflow_parse.soft_404')).toBe(true)
  })
})

describe('内容验证 Workflow 触发', () => {
  test('正常内容 + contentKey → CONTENT_VALIDATION_WORKFLOW.create', async () => {
    const { run, env } = wireAndRun()
    await run()
    expect(env.CONTENT_VALIDATION_WORKFLOW.create).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ bookmarkId: 42, contentKey: STANDARD_CRAWL_RESULT.contentKey }) })
    )
  })

  test('解析质量点评 → 透传到 CONTENT_VALIDATION_WORKFLOW', async () => {
    const qualityReview = {
      version: 'slax-corpus-scoring-v3',
      status: 'scored',
      score: 0.92,
      textRecall: 0.98,
      textF2: 0.97,
      imageRecall: 1,
      tableRecall: null,
      codeRecall: null,
      linkRecall: 1,
      headingRecall: 1,
      structure: 0.9,
      hardFailures: [],
      comment: '综合完整度 92.0%'
    } as const
    const { run, env } = wireAndRun({}, { qualityReview })

    await run()

    expect(env.CONTENT_VALIDATION_WORKFLOW.create).toHaveBeenCalledWith(
      expect.objectContaining({ params: expect.objectContaining({ qualityReview }) })
    )
  })

  test('soft 404 → 不触发', async () => {
    const { run, env } = wireAndRun({}, { textContent: 'Tiny' })
    await run()
    expect(env.CONTENT_VALIDATION_WORKFLOW.create).not.toHaveBeenCalled()
  })

  test('无 contentKey → 不触发', async () => {
    const { run, env } = wireAndRun({}, { contentKey: undefined })
    await run()
    expect(env.CONTENT_VALIDATION_WORKFLOW.create).not.toHaveBeenCalled()
  })

  test('create 失败 → alert + workflow 继续', async () => {
    const { run, env, cs, uph } = wireAndRun()
    env.CONTENT_VALIDATION_WORKFLOW.create.mockRejectedValue(new Error('create fail'))
    await run()
    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalledWith(
      1, 'post_processing.content_validation', expect.objectContaining({ error: 'create fail' })
    )
    expect(uph.processPostHandler).toHaveBeenCalled()
  })
})

describe('ignoreGenerateTag 逻辑', () => {
  test('用户设 false + soft404 → processPostHandler 收到 true', async () => {
    const { run, uph } = wireAndRun({ ignoreGenerateTag: false }, { textContent: 'Tiny' })
    await run()
    expect(uph.processPostHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ info: expect.objectContaining({ ignoreGenerateTag: true }) }),
      expect.anything()
    )
  })

  test('用户设 true + 无 soft404 → processPostHandler 收到 true', async () => {
    const { run, uph } = wireAndRun({ ignoreGenerateTag: true })
    await run()
    expect(uph.processPostHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ info: expect.objectContaining({ ignoreGenerateTag: true }) }),
      expect.anything()
    )
  })

  test('用户设 false + 无 soft404 → processPostHandler 收到 false', async () => {
    const { run, uph } = wireAndRun({ ignoreGenerateTag: false })
    await run()
    expect(uph.processPostHandler).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ info: expect.objectContaining({ ignoreGenerateTag: false }) }),
      expect.anything()
    )
  })
})

describe('import 追踪 (成功路径)', () => {
  test('importTaskId 存在 → update-import step 执行 (status=1, incr 1,0)', async () => {
    const { run, bs, imp } = wireAndRun({ importTaskId: 55 })
    await run()
    expect(bs.updateBookmarkImportRelationStatus).toHaveBeenCalledWith(1, 42, 55, 1)
    expect(imp.incrImportTask).toHaveBeenCalledWith(expect.anything(), 1, 55, 1, 0)
  })

  test('importTaskId 不存在 → 不执行', async () => {
    const { run, bs, imp } = wireAndRun()
    await run()
    expect(bs.updateBookmarkImportRelationStatus).not.toHaveBeenCalled()
    expect(imp.incrImportTask).not.toHaveBeenCalled()
  })

  test('importTaskId=0 (falsy) → 不执行', async () => {
    const { run, bs, imp } = wireAndRun({ importTaskId: 0 })
    await run()
    expect(bs.updateBookmarkImportRelationStatus).not.toHaveBeenCalled()
  })
})

describe('complete 事件', () => {
  test('成功 → sendAddBookmarkStepEvent(complete, success)', async () => {
    const { run, cs } = wireAndRun()
    await run()
    expect(cs.sendAddBookmarkStepEvent).toHaveBeenCalledWith(1, 42, 'example.com', 'complete', 'success')
  })
})
