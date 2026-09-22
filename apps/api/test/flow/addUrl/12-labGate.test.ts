/**
 * /add_url Layer 12: Labs gate — a YouTube link with the switch off never creates a row
 * 来源: bookmark.ts addUrlBookmark, bookmarkAdd.ts addByUrl, bookmarkController.ts add_url
 */
import { describe, test, expect, vi } from 'vitest'

vi.mock('@/decorators/di', () => ({
  injectable: () => (target: any) => target,
  singleton: () => (target: any) => target,
  inject: () => () => undefined
}))
vi.mock('@/decorators/controller', () => ({ Controller: () => (target: any) => target }))
vi.mock('@/decorators/route', () => ({
  Get: () => (_t: any, _k: string, desc: PropertyDescriptor) => desc,
  Post: () => (_t: any, _k: string, desc: PropertyDescriptor) => desc
}))

import { BookmarkService } from '@/domain/bookmark'
import { LabService } from '@/domain/lab'
import { BookmarkAddOrchestrator } from '@/domain/orchestrator/bookmarkAdd'
import { BookmarkController } from '@/handler/http/bookmarkController'
import { ErrorName } from '@/const/err'
import { createMockCtx, createMockBookmarkService, createMockCrawlService, createMockRequest } from '@test/helpers/mockFactory'

const YOUTUBE = 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
const ARTICLE = 'https://example.com/post'

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

describe('BookmarkService.addUrlBookmark', () => {
  test('switch off → LAB_FEATURE_DISABLED before any row is written', async () => {
    const { service, createBookmarkBase } = wireService(false)
    const ctx = createMockCtx({ userId: 7 })

    await expect(service.addUrlBookmark(ctx, { target_url: YOUTUBE, tags: [] }, 0 as any)).rejects.toMatchObject({ name: ErrorName.LAB_FEATURE_DISABLED })
    expect(createBookmarkBase).not.toHaveBeenCalled()
  })

  test('switch on → saves as usual', async () => {
    const { service, createBookmarkBase } = wireService(true)
    await service.addUrlBookmark(createMockCtx({ userId: 7 }), { target_url: YOUTUBE, tags: [] }, 0 as any)
    expect(createBookmarkBase).toHaveBeenCalledWith(expect.objectContaining({ privateUser: 7 }))
  })

  test('non-YouTube link never consults the switch', async () => {
    const { service, createBookmarkBase } = wireService(false)
    await service.addUrlBookmark(createMockCtx({ userId: 7 }), { target_url: ARTICLE, tags: [] }, 0 as any)
    expect(createBookmarkBase).toHaveBeenCalled()
  })
})

describe('BookmarkService.addUrlBookmarkItem (import)', () => {
  test('gated URL is skipped (null) instead of throwing', async () => {
    const { service, createBookmarkBase } = wireService(false)
    const res = await service.addUrlBookmarkItem(createMockCtx({ userId: 7 }), { target_url: YOUTUBE, target_title: 'v', tags: [] })
    expect(res).toBeNull()
    expect(createBookmarkBase).not.toHaveBeenCalled()
  })
})

describe('BookmarkAddOrchestrator.addByUrl', () => {
  test('Labs error is rethrown without a Feishu alert', async () => {
    const bs = createMockBookmarkService()
    const cs = createMockCrawlService()
    const orch = new (BookmarkAddOrchestrator as any)()
    Object.assign(orch, { bookmarkService: bs, crawlService: cs })
    bs.addUrlBookmark.mockRejectedValue(labService(false).disabledError('youtube'))

    await expect(orch.addByUrl(createMockCtx(), { target_url: YOUTUBE, target_title: '', tags: [] })).rejects.toMatchObject({ name: ErrorName.LAB_FEATURE_DISABLED })
    expect(cs.pushBookmarkFailureAlert).not.toHaveBeenCalled()
  })

  test('other errors still alert', async () => {
    const bs = createMockBookmarkService()
    const cs = createMockCrawlService()
    const orch = new (BookmarkAddOrchestrator as any)()
    Object.assign(orch, { bookmarkService: bs, crawlService: cs })
    bs.addUrlBookmark.mockRejectedValue(new Error('boom'))

    await expect(orch.addByUrl(createMockCtx(), { target_url: ARTICLE, target_title: '', tags: [] })).rejects.toThrow('boom')
    expect(cs.pushBookmarkFailureAlert).toHaveBeenCalled()
  })
})

describe('POST /v1/bookmark/add_url', () => {
  function wireController(error: unknown) {
    const orch = { addByUrl: vi.fn().mockRejectedValue(error), kickoffWorkflow: vi.fn() }
    const logs = { track: vi.fn().mockResolvedValue(undefined) }
    const ctrl = new (BookmarkController as any)()
    Object.assign(ctrl, { bookmarkAddOrchestrator: orch, logsService: logs })
    return { ctrl: ctrl as BookmarkController, logs }
  }

  test('Labs error goes out as 400 LAB_FEATURE_DISABLED with the server copy', async () => {
    const { ctrl, logs } = wireController(labService(false).disabledError('youtube'))
    const ctx = createMockCtx()

    const resp = await ctrl.handleUserAddUrlBookmarkRequest(ctx, createMockRequest({ target_url: YOUTUBE }))
    const body = await resp.json()
    expect(resp.status).toBe(400)
    expect(body).toMatchObject({ code: 400, data: 'LAB_FEATURE_DISABLED' })
    expect(body.message).toContain('Labs')
    expect(logs.track).toHaveBeenCalledWith(1, 'bookmark_add', { channel: 'add_url', status: 'lab_disabled' })
  })

  test('any other error is still squashed to ERROR_PARAM', async () => {
    const { ctrl } = wireController(new Error('boom'))
    const resp = await ctrl.handleUserAddUrlBookmarkRequest(createMockCtx(), createMockRequest({ target_url: ARTICLE }))
    expect((await resp.json()).data).toBe('ERROR_PARAM')
  })
})
