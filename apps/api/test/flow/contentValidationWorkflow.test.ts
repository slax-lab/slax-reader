import { describe, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  resolveMap: new Map<any, any>(),
  pushMessage: vi.fn().mockResolvedValue(undefined),
  screenshot: vi.fn().mockResolvedValue('screenshots/bookmark.jpg'),
  aiRun: vi.fn().mockResolvedValue({
    choices: [{ message: { content: JSON.stringify({ has_issues: false, issue_type: 'none', description: '正常' }) } }]
  })
}))

vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {},
  WorkflowEvent: class {},
  WorkflowStep: class {}
}))
vi.mock('@/decorators/di', () => ({
  container: {
    clone: vi.fn(() => ({
      resolve: (token: any) => mocks.resolveMap.get(token)
    }))
  },
  inject: () => () => undefined,
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target
}))
vi.mock('@/di/generated/dependency', () => ({ initializeCore: vi.fn(), initializeInfrastructure: vi.fn() }))
vi.mock('@/utils/context', () => ({
  ContextManager: vi.fn().mockImplementation((_ctx: any, env: any) => ({
    env,
    setUserInfo: vi.fn(),
    setHashIds: vi.fn()
  }))
}))
vi.mock('@/utils/hashids', () => ({
  Hashid: vi.fn().mockImplementation(() => ({}))
}))
vi.mock('@/infra/external/remoteFetcher', () => ({
  SlaxFetch: class {
    screenshot = mocks.screenshot
  }
}))
vi.mock('@/utils/async', () => ({
  deriveScreenshotKey: vi.fn((contentKey: string) => `${contentKey}.jpg`)
}))

import { CrawlService } from '@/domain/crawl'
import { SlaxAlertBotClient } from '@/infra/external/slaxAlertBot'
import { ContentValidationWorkflow } from '@/entry/edge/workflows/contentValidationWorkflow'

const qualityReview = {
  version: 'slax-corpus-scoring-v3' as const,
  status: 'scored' as const,
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
}

function createStep() {
  return {
    do: vi.fn(async (_name: string, _options: unknown, fn: () => Promise<unknown>) => fn()),
    sleep: vi.fn().mockResolvedValue(undefined)
  }
}

describe('ContentValidationWorkflow 解析质量点评', () => {
  test('正常校验结果的飞书消息包含解析质量点评', async () => {
    const crawlService = {
      sendAddBookmarkStepEvent: vi.fn().mockResolvedValue(undefined)
    }
    const alertBot = { crawl: { pushMessage: mocks.pushMessage } }
    const env = {
      RUN_TYPE: 'dev',
      IMAGE_PREFIX: 'https://images.example.com/assets',
      RUN_ENV: 'production',
      OSS: {
        get: vi.fn().mockResolvedValue({ arrayBuffer: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3]).buffer) }),
        head: vi.fn()
      },
      AI: { run: mocks.aiRun }
    } as any
    mocks.resolveMap.clear()
    mocks.resolveMap.set(CrawlService, crawlService)
    mocks.resolveMap.set(SlaxAlertBotClient, alertBot)
    mocks.pushMessage.mockClear()
    mocks.aiRun.mockClear()
    mocks.screenshot.mockClear()

    const workflow = new (ContentValidationWorkflow as any)()
    workflow.ctx = {}
    workflow.env = env
    const step = createStep()

    await workflow.run(
      {
        payload: {
          bookmarkId: 42,
          userId: 1,
          enUserId: 100,
          userLang: 'zh',
          url: 'https://example.com/article',
          title: 'Test Article',
          contentKey: 'html/article.html',
          qualityReview
        }
      },
      step
    )

    expect(mocks.pushMessage).toHaveBeenCalledWith(expect.stringContaining('**解析质量点评**:\n综合完整度 92.0%'))
    expect(mocks.pushMessage).toHaveBeenCalledWith(expect.stringContaining('https://images.example.com/assets/screenshots/bookmark.jpg'))
  })
})
