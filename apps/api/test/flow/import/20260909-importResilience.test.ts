/**
 * Import progress must survive a Redis outage, up to MAX_ACTIVE_IMPORT_TASKS imports may run
 * at once (a stuck task never blocks the next one), and parsing an imported bookmark must not
 * rewrite its saved time.
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))

import { ImportService, IMPORT_TASK_TIMEOUT_MS, MAX_ACTIVE_IMPORT_TASKS } from '@/domain/import'
import { ErrorName } from '@/const/err'
import { UrlParserHandler } from '@/domain/orchestrator/urlParser'
import {
  createMockCtx,
  createMockBookmarkService,
  createMockTelegramBotService,
  createMockSearchService,
  createMockUserService,
  createMockTagService,
  createMockAigcService,
  createMockCrawlService,
  createMockLogsService
} from '@test/helpers/mockFactory'

const redisDown = () => ({
  getString: vi.fn().mockRejectedValue(new Error('Unable to find environment variable: `UPSTASH_REDIS_REST_URL`')),
  del: vi.fn().mockRejectedValue(new Error('redis down')),
  incrBy: vi.fn().mockRejectedValue(new Error('redis down'))
})
const redisValue = (value: string) => ({ getString: vi.fn().mockResolvedValue(value), del: vi.fn().mockResolvedValue(undefined) })

function wireService(options: { redis?: (userId: number, id: number) => any; tasks?: any[]; relationCounts?: Record<number, number> } = {}) {
  const service = Object.create(ImportService.prototype) as ImportService
  const repo = {
    getUserImportTask: vi.fn().mockResolvedValue(options.tasks ?? []),
    getUnfinishedImportTask: vi.fn().mockResolvedValue(options.tasks ?? []),
    getUserProcessingImportTasks: vi.fn().mockResolvedValue((options.tasks ?? []).filter(item => item.status === 1)),
    updateBookmarkImportTask: vi.fn().mockResolvedValue(undefined),
    updateImportTaskCounters: vi.fn().mockResolvedValue(undefined),
    countImportRelationStatus: vi.fn().mockResolvedValue(options.relationCounts ?? {})
  }
  const redis = options.redis ?? redisDown
  Object.assign(service, {
    bookmarkData: repo,
    redisClient: () => ({ userImportProcess: redis, userImportSuccess: redis, userImportFailed: redis })
  })
  return { service, repo, ctx: createMockCtx() }
}

const task = (overrides: Record<string, unknown> = {}) => ({
  id: 7,
  user_id: 1,
  type: 'pinboard',
  status: 1,
  reason: 'PENDING',
  total_count: 20,
  batch_count: 20,
  success_total: 0,
  failed_total: 0,
  created_at: new Date(),
  ...overrides
})

describe('import progress without Redis', () => {
  it('reports progress from the database instead of failing the status request', async () => {
    const { service, ctx, repo } = wireService({ tasks: [task()], relationCounts: { 1: 12, 2: 3 } })
    const [info] = await service.getImportInfo(ctx)
    expect(info).toMatchObject({ id: 'enc_7', status: 1, current_count: 15, success_total: 12, failed_total: 3, count: 20 })
    expect(repo.countImportRelationStatus).toHaveBeenCalledWith(7)
  })

  it('reads Redis counters when they are available', async () => {
    const { service, ctx, repo } = wireService({ tasks: [task()], redis: () => redisValue('18') })
    const [info] = await service.getImportInfo(ctx)
    expect(info).toMatchObject({ current_count: 18, success_total: 18, failed_total: 18 })
    expect(repo.countImportRelationStatus).not.toHaveBeenCalled()
  })

  it('reports live progress for every processing task and stored totals for finished ones', async () => {
    const tasks = [task({ id: 7 }), task({ id: 8 }), task({ id: 9, status: 3, success_total: 19, failed_total: 1 })]
    const reads: number[] = []
    const redis = (_userId: number, id: number) => {
      reads.push(id)
      return redisValue(id === 7 ? '5' : '11')
    }
    const { service, ctx } = wireService({ tasks, redis })
    const info = await service.getImportInfo(ctx)
    expect(info.map(item => item.id)).toEqual(['enc_7', 'enc_8', 'enc_9'])
    expect(info[0]).toMatchObject({ current_count: 5 })
    expect(info[1]).toMatchObject({ current_count: 11 })
    expect(info[2]).toMatchObject({ status: 3, current_count: 20, success_total: 19, failed_total: 1 })
    expect(reads).not.toContain(9)
  })
})

describe('cron task check', () => {
  it('settles completed tasks even when constructing the Redis client throws', async () => {
    const { service, ctx, repo } = wireService({ tasks: [task()], relationCounts: { 1: 20 } })
    Object.assign(service, {
      redisClient: () => {
        throw new Error('Redis configuration missing')
      }
    })
    await service.checkImportTaskProcess(ctx)
    expect(repo.updateBookmarkImportTask).toHaveBeenCalledWith(7, 3, '')
  })
  it.each(['redis down', '', 'NaN', '-1'])('settles DB-complete tasks with unavailable counters: %s', async value => {
    const { service, ctx, repo } = wireService({ tasks: [task()], relationCounts: { 1: 18, 2: 2 }, redis: value === 'redis down' ? redisDown : () => redisValue(value) })
    await service.checkImportTaskProcess(ctx)
    expect(repo.updateImportTaskCounters).toHaveBeenCalledWith(7, 18, 2)
    expect(repo.updateBookmarkImportTask).toHaveBeenCalledWith(7, 3, '')
  })

  it('releases all five completed slots while Redis is down', async () => {
    const { service, ctx, repo } = wireService({ tasks: Array.from({ length: 5 }, (_, i) => task({ id: i + 1 })), relationCounts: { 1: 20 } })
    await expect(service.ensureImportCapacity(ctx)).resolves.toBeUndefined()
    expect(repo.updateBookmarkImportTask).toHaveBeenCalledTimes(5)
    expect(repo.updateBookmarkImportTask.mock.calls.every(([, status]) => status === 3)).toBe(true)
  })

  it('keeps checking other tasks when one task throws', async () => {
    const stale = task({ id: 8, created_at: new Date(Date.now() - IMPORT_TASK_TIMEOUT_MS - 1000) })
    const { service, ctx, repo } = wireService({ tasks: [task({ id: 7 }), stale] })
    repo.countImportRelationStatus.mockRejectedValueOnce(new Error('db hiccup')).mockResolvedValue({})
    await service.checkImportTaskProcess(ctx)
    expect(repo.updateBookmarkImportTask).toHaveBeenCalledWith(8, 2, expect.stringContaining('Timed out'))
  })

  it('completes a task whose counters reached the batch count and clears its counters', async () => {
    const { service, ctx, repo } = wireService({ tasks: [task()], redis: () => redisValue('20') })
    await service.checkImportTaskProcess(ctx)
    expect(repo.updateImportTaskCounters).toHaveBeenCalledWith(7, 20, 20)
    expect(repo.updateBookmarkImportTask).toHaveBeenCalledWith(7, 3, '')
  })

  it('marks a task failed after the timeout instead of waiting three days', async () => {
    const old = task({ created_at: new Date(Date.now() - IMPORT_TASK_TIMEOUT_MS - 1000) })
    const { service, ctx, repo } = wireService({ tasks: [old], redis: () => redisValue('3') })
    await service.checkImportTaskProcess(ctx)
    expect(repo.updateBookmarkImportTask).toHaveBeenCalledWith(7, 2, expect.stringContaining('Timed out'))
  })

  it('leaves a fresh task running', async () => {
    const { service, ctx, repo } = wireService({ tasks: [task()], redis: () => redisValue('3') })
    await service.checkImportTaskProcess(ctx)
    expect(repo.updateBookmarkImportTask).not.toHaveBeenCalled()
  })
})

describe('several imports run at once, up to the limit', () => {
  const running = (count: number, overrides: Record<number, Record<string, unknown>> = {}) => Array.from({ length: count }, (_, i) => task({ id: 10 + i, ...overrides[10 + i] }))
  const stillRunning = () => redisValue('3')

  it('caps at five', () => {
    expect(MAX_ACTIVE_IMPORT_TASKS).toBe(5)
  })

  it('lets a new import start while fewer than the limit are running', async () => {
    const { service, ctx, repo } = wireService({ tasks: running(MAX_ACTIVE_IMPORT_TASKS - 1), redis: stillRunning })
    await expect(service.ensureImportCapacity(ctx)).resolves.toBeUndefined()
    expect(repo.updateBookmarkImportTask).not.toHaveBeenCalled()
  })

  it('rejects with TOO_MANY_IMPORT_TASKS once the limit is reached', async () => {
    const { service, ctx } = wireService({ tasks: running(MAX_ACTIVE_IMPORT_TASKS), redis: stillRunning })
    await expect(service.ensureImportCapacity(ctx)).rejects.toMatchObject({ name: ErrorName.TOO_MANY_IMPORT_TASKS, errCode: 400 })
  })

  it('closes a task whose work is done but the cron has not closed yet, then lets the import start', async () => {
    const redis = (_userId: number, id: number) => (id === 12 ? redisValue('20') : stillRunning())
    const { service, ctx, repo } = wireService({ tasks: running(MAX_ACTIVE_IMPORT_TASKS), redis })
    await expect(service.ensureImportCapacity(ctx)).resolves.toBeUndefined()
    expect(repo.updateBookmarkImportTask).toHaveBeenCalledTimes(1)
    expect(repo.updateBookmarkImportTask).toHaveBeenCalledWith(12, 3, '')
  })

  it('times out a stale task and lets the import start', async () => {
    const stale = { created_at: new Date(Date.now() - IMPORT_TASK_TIMEOUT_MS - 1000) }
    const { service, ctx, repo } = wireService({ tasks: running(MAX_ACTIVE_IMPORT_TASKS, { 11: stale }), redis: stillRunning })
    await expect(service.ensureImportCapacity(ctx)).resolves.toBeUndefined()
    expect(repo.updateBookmarkImportTask).toHaveBeenCalledWith(11, 2, expect.stringContaining('Timed out'))
  })

  it('treats a task whose check fails as still running', async () => {
    const redis = (_userId: number, id: number) => (id === 10 ? redisDown() : stillRunning())
    const { service, ctx, repo } = wireService({ tasks: running(MAX_ACTIVE_IMPORT_TASKS), redis })
    repo.countImportRelationStatus.mockRejectedValue(new Error('db hiccup'))
    await expect(service.ensureImportCapacity(ctx)).rejects.toMatchObject({ name: ErrorName.TOO_MANY_IMPORT_TASKS })
  })

  it('passes when nothing is running', async () => {
    const { service, ctx } = wireService()
    await expect(service.ensureImportCapacity(ctx)).resolves.toBeUndefined()
  })
})

describe('parse post-processing keeps the imported saved time', () => {
  function wireHandler() {
    const bs = createMockBookmarkService()
    const handler = new (UrlParserHandler as any)()
    Object.assign(handler, {
      bookmarkSvc: bs,
      telegramBotSvc: createMockTelegramBotService(),
      searchSvc: createMockSearchService(),
      userSvc: createMockUserService(),
      tagSvc: createMockTagService(),
      aigcSvc: createMockAigcService(),
      crawlSvc: createMockCrawlService(),
      logsService: createMockLogsService()
    })
    return { handler: handler as UrlParserHandler, bs }
  }
  const info = (overrides: Record<string, unknown> = {}) => ({
    id: 'workflow_42',
    info: {
      userId: 1,
      bookmarkId: 42,
      targetUrl: 'https://example.com/article',
      targetTitle: 'Test Article',
      callback: 0,
      callbackPayload: {},
      ignoreGenerateTag: true,
      parserType: 'server_puppeteer_parse',
      privateUser: 0,
      resource: '',
      ...overrides
    }
  })
  const parseRes = { title: 'Test', textContent: 'Test content', byline: 'Author' }

  it('does not touch created_at for an import task', async () => {
    const { handler, bs } = wireHandler()
    const ctx = createMockCtx()
    await handler.processPostHandler(ctx, info({ importTaskId: 7 }) as any, parseRes)
    await ctx.execution.waitUntil.mock.calls[0]?.[0]
    expect(bs.updateUserBookmarkCreateAt).not.toHaveBeenCalled()
  })

  it('still bumps created_at for a normal save', async () => {
    const { handler, bs } = wireHandler()
    const ctx = createMockCtx()
    await handler.processPostHandler(ctx, info() as any, parseRes)
    await ctx.execution.waitUntil.mock.calls[0]?.[0]
    expect(bs.updateUserBookmarkCreateAt).toHaveBeenCalledWith(42, 1, expect.any(Date))
  })
})
