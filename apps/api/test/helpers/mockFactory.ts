import { vi } from 'vitest'

// ---- ContextManager ----

export function createMockCtx(overrides: { userId?: number; encodeUserId?: number; lang?: string; envType?: string; platform?: string; hashIds?: Record<string, any> } = {}) {
  const userId = overrides.userId ?? 1
  let platform = overrides.platform ?? 'web'
  return {
    getUserId: () => userId,
    getEncodeUserId: () => overrides.encodeUserId ?? 100,
    getlang: () => overrides.lang ?? 'en',
    getPlatform: () => platform,
    setPlatform: vi.fn((value: string) => {
      platform = value
    }),
    setUserInfo: vi.fn(),
    setHashIds: vi.fn(),
    set: vi.fn(),    get: vi.fn(() => undefined),
    trace: vi.fn((_stage: string, operation: () => Promise<any>) => operation()),
    env: createMockEnv(overrides.envType),
    execution: { waitUntil: vi.fn((p: Promise<any>) => p.catch(() => {})) },
    hashIds: {
      encodeId: vi.fn((id: number) => `enc_${id}`),
      // 默认 decodeId 做恒等映射（数字进数字出），便于断言；需要校验 hashId 解码失败时可在 overrides.hashIds 覆盖
      decodeId: vi.fn((id: number | string) => Number(id)),
      generateTimeCode: vi.fn(() => 'TC'),
      ...overrides.hashIds
    }
  } as any
}

export function createMockEnv(runType = 'dev') {
  return {
    RUN_ENV: 'prod',
    RUN_TYPE: runType,
    IMAGE_PREFIX: 'https://reader-img.slax.dev/',
    PROXY_IMAGE_PREFIX: 'https://reader-api.slax.dev/static/image',
    IMAGER_CHECK_DIGST_SALT: 'test-salt',
    CRAWL_WORKFLOW: { create: vi.fn().mockResolvedValue(undefined) },
    IMPORT_PARSE_WORKFLOW: { create: vi.fn().mockResolvedValue(undefined) },
    CONTENT_VALIDATION_WORKFLOW: { create: vi.fn().mockResolvedValue(undefined) },
    OSS: { put: vi.fn(), get: vi.fn(), head: vi.fn() }
  } as any
}

// ---- BookmarkService (orchestrator 层直接 mock) ----

export function createMockBookmarkService() {
  return {
    addUrlBookmark: vi.fn(),
    addBookmark: vi.fn(),
    batchAddUrlBookmark: vi.fn(),
    addUrlBookmarkItem: vi.fn(),
    getBookmarkTitleAndTextContentTry: vi.fn().mockResolvedValue(null),
    updateBookmarkStatus: vi.fn().mockResolvedValue(undefined),
    createBookmarkBase: vi.fn(),
    createBookmarkImportRelation: vi.fn().mockResolvedValue(undefined),
    updateBookmarkImportRelationStatus: vi.fn().mockResolvedValue(undefined),
    createBookmarkOverview: vi.fn().mockResolvedValue(undefined),
    updateUserBookmarkCreateAt: vi.fn().mockResolvedValue(undefined),
    getBookmarkContent: vi.fn().mockResolvedValue(null),
    getBookmarkById: vi.fn().mockResolvedValue(null),
    getUserBookmark: vi.fn().mockResolvedValue({ id: 1, uuid: 'ub-test-uuid', user_id: 1, bookmark_id: 42 })
  }
}

// ---- CrawlService ----

export function createMockCrawlService() {
  return {
    resolveFinalUrl: vi.fn().mockImplementation((_ctx: any, url: string) => Promise.resolve(url)),
    resolveShortLink: vi.fn().mockImplementation((_ctx: any, url: string) => Promise.resolve(url)),
    pushBookmarkFailureAlert: vi.fn().mockResolvedValue(undefined),
    createWorkflow: vi.fn().mockResolvedValue(undefined),
    createImportParseWorkflow: vi.fn().mockResolvedValue(undefined),
    sendAddBookmarkStepEvent: vi.fn().mockResolvedValue(undefined),
    fetchTwitterData: vi.fn(),
    fetchXhsData: vi.fn(),
    fetchWeiboData: vi.fn(),
    fetchRedditData: vi.fn(),
    fetchZhihuData: vi.fn(),
    fetchRegular: vi.fn(),
    fetchDajiala: vi.fn(),
    fetchWeixin: vi.fn(),
    parseAndSaveContent: vi.fn(),
    parseAndSaveTwitter: vi.fn(),
    parseAndSaveXhs: vi.fn(),
    parseAndSaveWeibo: vi.fn(),
    parseAndSaveReddit: vi.fn(),
    parseAndSaveZhihu: vi.fn(),
    parseAndSaveWeixin: vi.fn()
  }
}

// ---- BucketClient ----

export function createMockBucketClient() {
  const putIfKeyExists = vi.fn().mockResolvedValue(undefined)
  return { factory: vi.fn(() => ({ putIfKeyExists })), putIfKeyExists }
}

// ---- BookmarkRepo ----

export function createMockBookmarkRepo() {
  return {
    getBookmark: vi.fn().mockResolvedValue(null),
    createBookmark: vi.fn(),
    createBookmarkRelation: vi.fn().mockResolvedValue({ bookmark_id: 1, created_at: new Date(), deleted_at: null }),
    updateBookmarkStatus: vi.fn().mockResolvedValue(undefined),
    updateBookmark: vi.fn().mockResolvedValue(undefined),
    createUserTag: vi.fn(),
    createUserTags: vi.fn().mockResolvedValue([]),
    createBookmarkTag: vi.fn().mockResolvedValue(undefined),
    deleteBookmarkTag: vi.fn().mockResolvedValue({ count: 1 }),
    countBookmarksByTag: vi.fn().mockResolvedValue(false),
    deleteUserTag: vi.fn().mockResolvedValue(undefined),
    updateUserTagDisplay: vi.fn().mockResolvedValue(undefined),
    updateUserTagSource: vi.fn().mockResolvedValue(undefined),
    touchUserTagsLastUsed: vi.fn().mockResolvedValue(0),
    softDeleteBookmarkTagsByTag: vi.fn().mockResolvedValue({ count: 0 }),
    findUserTagByName: vi.fn().mockResolvedValue(null),
    getUserTagById: vi.fn().mockResolvedValue(null),
    getUserTagByUuid: vi.fn().mockResolvedValue(null),
    getUserTagsByIds: vi.fn().mockResolvedValue([]),
    getUserTags: vi.fn().mockResolvedValue([]),
    getUserTagsByNames: vi.fn().mockResolvedValue([]),
    getBookmarkTags: vi.fn().mockResolvedValue([]),
    getUserBookmark: vi.fn().mockResolvedValue({ id: 1 }),
    countTagsWithinBookmarks: vi.fn().mockResolvedValue([]),
    updateUserTagsDisplay: vi.fn().mockResolvedValue([]),
    upsertBookmarkTags: vi.fn().mockResolvedValue(undefined),
    createBookmarkImportRelation: vi.fn().mockResolvedValue(undefined),
    updateBookmarkImportRelationStatus: vi.fn().mockResolvedValue(undefined),
    getBookmarkById: vi.fn().mockResolvedValue(null),
    createBookmarkChangeLog: vi.fn().mockResolvedValue(undefined),
    findStuckBookmarks: vi.fn().mockResolvedValue([]),
    casBookmarkStatus: vi.fn().mockResolvedValue(true)
  }
}

// ---- LogsService ----

export function createMockLogsService() {
  return { track: vi.fn().mockResolvedValue(undefined) }
}

// ---- AlertBot ----

export function createMockAlertBot() {
  return { crawl: { pushMessage: vi.fn().mockResolvedValue(undefined) } }
}

// ---- UrlParserHandler ----

export function createMockUrlParserHandler() {
  return {
    processPostHandler: vi.fn().mockResolvedValue(undefined),
    handleTagTask: vi.fn().mockResolvedValue(vi.fn()),
    handleSearchTask: vi.fn().mockResolvedValue(vi.fn()),
    processThirdPartyMessages: vi.fn().mockResolvedValue(undefined)
  }
}

// ---- SearchService ----

export function createMockSearchService() {
  return { addSearchRecord: vi.fn().mockResolvedValue(undefined) }
}

// ---- UserService ----

export function createMockUserService() {
  return {
    getUserSubscriptionInfo: vi.fn().mockResolvedValue(null),
    getUserInfo: vi.fn().mockResolvedValue(null)
  }
}

// ---- TagService ----

export function createMockTagService() {
  return {
    listUserTags: vi.fn().mockResolvedValue([]),
    getBookmarkTags: vi.fn().mockResolvedValue([]),
    updateUserTagsDisplay: vi.fn().mockResolvedValue(null),
    upsertBookmarkTags: vi.fn().mockResolvedValue(undefined)
  }
}

// ---- AigcService ----

export function createMockAigcService() {
  return {
    generateOverviewTag: vi.fn().mockResolvedValue({ overview: '', key_takeaways: [], tags: [] })
  }
}

// ---- TelegramBotService ----

export function createMockTelegramBotService() {
  return {
    callback: vi.fn().mockResolvedValue(undefined),
    initTelegramBot: vi.fn().mockResolvedValue(undefined)
  }
}

// ---- ImportService ----

export function createMockImportService() {
  return {
    processImportBookmark: vi.fn(),
    incrImportTask: vi.fn().mockResolvedValue(undefined)
  }
}

// ---- UserRepo ----

export function createMockUserRepo() {
  return {
    getUserInfo: vi.fn().mockResolvedValue({ ai_lang: 'en' })
  }
}

// ---- WorkflowStep (for CrawlWorkflow tests) ----

export function createMockStep() {
  return {
    do: vi.fn(async (_name: string, _opts: any, fn: () => Promise<any>) => fn())
  }
}

// ---- WorkflowEvent ----

export function createMockWorkflowEvent(overrides: Record<string, unknown> = {}) {
  return {
    payload: {
      url: 'https://example.com/article',
      bookmarkId: 42,
      userId: 1,
      enUserId: 100,
      userLang: 'en',
      callbackChatId: 0,
      callbackOriginMessageId: 0,
      ignoreGenerateTag: false,
      ...overrides
    }
  }
}

// ---- Mock Request ----

export function createMockRequest<T>(body: T) {
  return { json: () => Promise.resolve(body), headers: new Headers() } as unknown as Request
}

// GET 端点用：RequestUtils.query 只读取 req.url 的 query string，故构造一个带 url 的对象即可
export function createMockQueryRequest(params: Record<string, string | number | undefined> = {}) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined) qs.set(k, String(v))
  }
  return { url: `https://test.local/?${qs.toString()}`, headers: new Headers() } as unknown as Request
}

// ---- 标准测试数据 ----

export const STANDARD_CRAWL_RESULT = {
  title: 'Test Article',
  textContent: 'This is a test article with enough content for validation.',
  excerpt: 'This is a test',
  byline: 'Test Author',
  siteName: 'example.com',
  publishedTime: new Date('2024-06-15'),
  contentKey: 'html/parse/workflow_42_9999.html'
}

export const TWITTER_CRAWL_RESULT = {
  title: 'Tweet: This is a test tweet content',
  textContent: 'This is a test tweet content',
  byline: 'TestUser',
  siteName: 'Twitter',
  contentKey: 'html/parse/workflow_10_9999.html'
}

export const XHS_CRAWL_RESULT = {
  title: 'RedNote By: 测试笔记标题',
  textContent: '这是一篇测试笔记的内容描述',
  byline: '测试用户',
  siteName: 'RedNote',
  contentKey: 'html/parse/workflow_20_9999.html'
}

export const WEIBO_CRAWL_RESULT = {
  title: 'Weibo by 测试用户 (123)',
  textContent: '这是一条测试微博内容',
  byline: '测试用户',
  siteName: 'Weibo',
  contentKey: 'html/parse/workflow_30_9999.html'
}

export const REDDIT_CRAWL_RESULT = {
  title: 'Test Reddit Post Title',
  textContent: 'Test Reddit Post Title\n\nThis is the content of the post.',
  byline: 'u/testuser',
  siteName: 'r/test',
  contentKey: 'html/parse/workflow_40_9999.html'
}
