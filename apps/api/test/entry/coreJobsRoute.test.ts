import { expect, test, vi } from 'vitest'

// Exercises Core's real entry fetch, so the internalRoutes entry that sends the jobs host to handleJobsRequest is
// covered; removing it would let jobs.internal fall through to the reader router.
const handlers = vi.hoisted(() => ({ cron: vi.fn<(event: { cron: string; scheduledTime: number }) => Promise<void>>(), reader: vi.fn() }))
vi.mock('cloudflare:workers', () => ({ WorkerEntrypoint: class {}, DurableObject: class {}, WorkflowEntrypoint: class {} }))
vi.mock('@/entry/core/handlers', () => ({ handleScheduledEvent: handlers.cron, handleQueueEvent: vi.fn(), handleEmailEvent: vi.fn() }))
vi.mock('@/di/generated/core/dependency', () => ({ initializeCore() {}, initializeInfrastructure() {} }))
vi.mock('@/di/generated/core/readerRouter', () => ({ getRouter: vi.fn() }))
vi.mock('@/di/router', () => ({ getRouter: () => ({ fetch: handlers.reader }) }))
vi.mock('@/entry/core/contentHandler', () => ({ handleContentRequest: vi.fn(), isContentRequest: () => false }))
vi.mock('@/entry/core/vectorPreferenceObject', () => ({ VectorPreferenceObject: class {} }))
vi.mock('@/entry/retired', () => ({ SlaxJieba: class {}, SlaxWebSocketServer: class {}, ScreenshotBrowser: class {} }))
vi.mock('@/entry/core/workflows/crawlWorkflow', () => ({ CrawlWorkflow: class {} }))
vi.mock('@/entry/core/workflows/contentValidationWorkflow', () => ({ ContentValidationWorkflow: class {} }))
vi.mock('@/entry/core/workflows/importParseWorkflow', () => ({ ImportParseWorkflow: class {} }))
vi.mock('@/entry/core/workflows/youtubeArticleWorkflow', () => ({ YoutubeArticleWorkflow: class {} }))
vi.mock('@/entry/core/workflows/podcastWorkflow', () => ({ PodcastWorkflow: class {} }))
vi.mock('@/entry/core/workflows/vectorMaintenanceWorkflow', () => ({ VectorMaintenanceWorkflow: class {} }))

import core from '@/entry/core'
import { EDGE_SECRET_HEADER } from '@/const/edge'

test('Core routes the jobs host to the jobs handler, not the reader router', async () => {
  handlers.cron.mockResolvedValueOnce()
  const ctx = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {} } as unknown as ExecutionContext
  const request = new Request('https://jobs.internal/cron', {
    method: 'POST',
    headers: { [EDGE_SECRET_HEADER]: 'shared', 'Content-Type': 'application/json' },
    body: JSON.stringify({ cron: '*/5 * * * *', scheduledTime: 9 })
  })
  const response = await core.fetch(request, { EDGE_SHARED_SECRET: 'shared' } as Env, ctx)
  expect(response.status).toBe(200)
  expect(await response.json()).toEqual({})
  expect(handlers.cron).toHaveBeenCalledWith(expect.objectContaining({ cron: '*/5 * * * *', scheduledTime: 9 }), expect.anything(), expect.anything())
  expect(handlers.reader).not.toHaveBeenCalled()
})
