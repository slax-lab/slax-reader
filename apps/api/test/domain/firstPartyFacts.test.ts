import { describe, expect, test, vi } from 'vitest'
import { ContextManager } from '@/utils/context'
import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'
import type { OrderedSyncOperation } from '@/domain/orchestrator/sync'
import { SyncOrchestrator } from '@/domain/orchestrator/sync'
import { BookmarkController } from '@/handler/http/bookmarkController'
import { CollectionController } from '@/handler/http/collectionController'
import { CrawlService } from '@/domain/crawl'
import { ImportOrchestrator } from '@/domain/orchestrator/import'
import { captureEventContext, EVENT_CONTEXT_KEY, submitServerEvent } from '@/domain/events'
import { rateLimit } from '@/middleware/rateLimit'

const bookmark = () => ({
  uuid: 'bookmark-1',
  user_id: 7,
  type: 0,
  archive_status: 0,
  is_starred: false,
  deleted_at: null,
  bookmark: { target_url: 'https://example.test/article' }
})

function setup() {
  const records: Record<string, any>[] = []
  const pending: Promise<unknown>[] = []
  const ctx = new ContextManager(
    { waitUntil: (promise: Promise<unknown>) => pending.push(promise) } as unknown as ExecutionContext,
    {
      SLAX_READER_STREAM_STREAM: {
        send: async (rows: Record<string, any>[]) => {
          records.push(...rows)
        }
      }
    } as unknown as Env
  )
  ctx.setUserInfo(7, 70, 'test@example.test', 'en')
  ctx.setPlatform('web')
  ctx.setHashIds({ decodeId: (value: number) => value } as never)
  const request = new Request('https://api.test/v1/sync/changes', {
    headers: { 'X-Device-ID': 'device-1', 'X-CLIENT-VERSION': '2.0.11', 'X-CLIENT-LOCALE': 'zh-CN', 'User-Agent': 'test-browser' }
  })
  ctx.set(EVENT_CONTEXT_KEY, captureEventContext(ctx, request))
  const flush = async () => {
    let count: number
    do {
      count = pending.length
      await Promise.all(pending)
    } while (pending.length !== count)
  }
  return { ctx, request, records, flush }
}

function syncFixture(initial: any = bookmark()) {
  const fixture = setup()
  let row = initial
  let mark: any = null
  const tx = {
    sr_user_bookmark: { findFirst: vi.fn(async () => (row ? structuredClone(row) : null)) },
    sr_bookmark_comment: { findFirst: vi.fn(async () => (mark ? structuredClone(mark) : null)) }
  }
  const db = new DBSyncBatchOperation((() => ({
    $transaction: async (callback: (value: any) => Promise<void>) => {
      const previous = structuredClone({ row, mark })
      try {
        await callback(tx)
      } catch (error) {
        row = previous.row
        mark = previous.mark
        throw error
      }
    }
  })) as never)
  vi.spyOn(db, 'executeCreateBookmark').mockImplementation(async () => {
    row ||= bookmark()
    return { bookmarkId: 12, targetUrl: row.bookmark.target_url, userId: 7 }
  })
  vi.spyOn(db, 'executeUpdateBookmark').mockImplementation(async (_tx, operation) => {
    if ((operation as any).data.fail) throw new Error('transaction rejected')
    Object.assign(row, operation.data)
  })
  vi.spyOn(db, 'executeDeleteBookmark').mockImplementation(async () => {
    row.deleted_at = new Date('2026-09-11T00:00:00Z')
  })
  vi.spyOn(db, 'executeCreateComment').mockImplementation(async (_tx, operation) => {
    mark ||= { uuid: 'highlight-1', user_id: 7, type: (operation as any).data.type, user_bookmark_uuid: 'bookmark-1', is_deleted: false }
  })
  vi.spyOn(db, 'executeDeleteComment').mockImplementation(async () => {
    mark.is_deleted = true
  })
  const orchestrator = Object.create(SyncOrchestrator.prototype)
  const execute = async (operations: OrderedSyncOperation[]) => {
    await db.executeOrderedOperations(operations, orchestrator.syncCommitObserver(fixture.ctx))
    await fixture.flush()
  }
  return { ...fixture, execute }
}

const update = (data: Record<string, unknown>): OrderedSyncOperation => ({ type: 'update_bookmark', userId: 7, bookmarkUuid: 'bookmark-1', data }) as OrderedSyncOperation

describe('committed sync facts', () => {
  test.each([
    ['archive_status', 1, 'bookmark_archived', 'bookmark_unarchived'],
    ['is_starred', true, 'bookmark_starred', 'bookmark_unstarred']
  ] as const)('%s emits real state changes once, with full context', async (field, value, enabled, disabled) => {
    const f = syncFixture()
    await f.execute([update({ [field]: value })])
    await f.execute([update({ [field]: value })])
    expect(f.records.map(r => r.event_name)).toEqual([enabled])
    await f.execute([update({ [field]: field === 'archive_status' ? 0 : false })])
    expect(f.records.map(r => r.event_name)).toEqual([enabled, disabled])
    expect(f.records[0]).toMatchObject({
      user_id: 7,
      device_id: 'device-1',
      ua: 'test-browser',
      properties: {
        bookmark_id: 'bookmark-1',
        url_domain: 'example.test',
        content_type: 'full_content',
        source: 'web_button',
        platform: 'web',
        locale: 'zh',
        client_version: '2.0.11'
      }
    })
  })

  test('a rollback emits none of the earlier operations in that batch', async () => {
    const f = syncFixture()
    await expect(f.execute([update({ is_starred: true }), update({ fail: true })])).rejects.toThrow('transaction rejected')
    await f.flush()
    expect(f.records).toEqual([])
  })

  test('create and trash do not count replayed writes twice', async () => {
    const f = syncFixture(null)
    const create = { type: 'create_bookmark', userId: 7, bookmarkUuid: 'bookmark-1', data: {} } as OrderedSyncOperation
    const remove = { type: 'delete_bookmark', userId: 7, bookmarkUuid: 'bookmark-1', data: undefined } as OrderedSyncOperation
    await f.execute([create])
    await f.execute([create])
    await f.execute([remove])
    await f.execute([remove])
    expect(f.records.map(r => r.event_name)).toEqual(['bookmark_saved', 'bookmark_deleted'])
  })

  test('highlight creation/deletion retain both relation UUIDs', async () => {
    const f = syncFixture()
    const create = { type: 'create_comment', userId: 7, commentUuid: 'highlight-1', data: { type: 1 } } as OrderedSyncOperation
    const remove = { type: 'delete_comment', userId: 7, commentUuid: 'highlight-1', data: { isDeleted: true } } as OrderedSyncOperation
    await f.execute([create, remove])
    expect(f.records.map(r => r.event_name)).toEqual(['highlight_created', 'highlight_deleted'])
    expect(f.records.every(r => r.properties.highlight_id === 'highlight-1' && r.properties.bookmark_id === 'bookmark-1')).toBe(true)
  })

  test('comments are not silently reclassified as highlights', async () => {
    const f = syncFixture()
    await f.execute([{ type: 'create_comment', userId: 7, commentUuid: 'comment-1', data: { type: 2 } } as OrderedSyncOperation])
    expect(f.records).toEqual([])
  })
})

describe('REST and asynchronous failure boundaries', () => {
  test.each(['handleUserAddBookmarkRequest', 'handleUserAddUrlBookmarkRequest'])('%s emits a fully attributed saved event after persistence', async method => {
    const f = setup()
    const row = { ...bookmark(), type: 1 }
    const controller = Object.create(BookmarkController.prototype)
    controller.bookmarkService = { getUserBookmarkWithDetail: vi.fn().mockResolvedValue(row) }
    controller.userDeletionService = { ensureUserNotDeleted: vi.fn().mockResolvedValue(undefined) }
    controller.bookmarkAddOrchestrator = {
      addByContent: vi.fn().mockResolvedValue({ bookmarkId: 12, isShortcut: true, workflowParams: null }),
      addByUrl: vi.fn().mockResolvedValue({ bookmarkId: 12, isShortcut: true, workflowParams: null })
    }
    controller.logsService = { track: vi.fn().mockResolvedValue(undefined) }
    f.ctx.hashIds.encodeId = value => value
    const request = new Request('https://api.test/v1/bookmark/add', {
      method: 'POST',
      headers: f.request.headers,
      body: JSON.stringify({ target_url: 'https://example.test/article', target_title: 'Test', tags: [] })
    })
    const response = await controller[method](f.ctx, request)
    await f.flush()
    expect(response.status).toBe(200)
    expect(f.records).toMatchObject([
      {
        event_name: 'bookmark_saved',
        user_id: 7,
        device_id: 'device-1',
        properties: {
          bookmark_id: 'bookmark-1',
          url_domain: 'example.test',
          source: 'web_button',
          content_type: 'url_only',
          platform: 'web',
          locale: 'zh',
          client_version: '2.0.11'
        }
      }
    ])
  })

  test('import restores the original request identity before emitting saved', async () => {
    const f = setup()
    const service = Object.create(ImportOrchestrator.prototype)
    service.importService = { processImportBookmark: vi.fn().mockResolvedValue([{}]), incrImportTask: vi.fn().mockResolvedValue(undefined) }
    service.bookmarkService = {
      batchAddUrlBookmark: vi.fn().mockResolvedValue([{ bookmarkId: 12, userId: 7, skipParse: true }]),
      createBookmarkImportRelation: vi.fn().mockResolvedValue(undefined),
      updateBookmarkImportRelationStatus: vi.fn().mockResolvedValue(undefined),
      getUserBookmarkWithDetail: vi.fn().mockResolvedValue(bookmark())
    }
    const context = f.ctx.get(EVENT_CONTEXT_KEY)
    await service.processImportBookmark(f.ctx, { id: 1, info: { id: 99, type: 'pocket', userId: 7, eventContext: context } })
    await f.flush()
    expect(f.records).toMatchObject([
      { event_name: 'bookmark_saved', user_id: 7, device_id: 'device-1', properties: { source: 'import', bookmark_id: 'bookmark-1', locale: 'zh', client_version: '2.0.11' } }
    ])
  })

  test('collection events confirm actual subscribe/unsubscribe outcomes', async () => {
    const f = setup()
    const controller = Object.create(CollectionController.prototype)
    controller.collectionOrchestrator = {
      subscribeUserCollection: vi.fn().mockResolvedValue({ subscribe: true }),
      unsubscribeUserCollection: vi.fn().mockResolvedValue(undefined)
    }
    controller.collectionService = { getUserCollectionSubscribed: vi.fn().mockResolvedValue({ subscribed: false, deleted: false }) }
    const request = () =>
      new Request('https://api.test/v1/collection', { method: 'POST', headers: { 'X-Device-ID': 'device-1' }, body: JSON.stringify({ collect_code: 'abcdef', cancel_now: true }) })
    await controller.handleUserCollectionSubscribeRequest(f.ctx, request())
    await controller.handleUserCollectionUnsubscribeRequest(f.ctx, request())
    await f.flush()
    expect(f.records.map(r => r.event_name)).toEqual(['collection_subscribed', 'collection_unsubscribed'])
    expect(f.records.every(r => r.properties.collection_id === 'abcdef')).toBe(true)
    controller.collectionOrchestrator.subscribeUserCollection.mockResolvedValue({ subscribe: false, pay_url: 'https://payments.test' })
    await controller.handleUserCollectionSubscribeRequest(f.ctx, request())
    await f.flush()
    expect(f.records).toHaveLength(2)
  })

  test('a telemetry lookup failure does not turn a successful business action into an HTTP failure', async () => {
    const f = setup()
    const controller = Object.create(BookmarkController.prototype)
    const remove = vi.fn().mockResolvedValue('ok')
    controller.bookmarkService = { getUserBookmarkWithDetail: vi.fn().mockRejectedValue(new Error('telemetry lookup unavailable')), deleteBookmark: remove }
    const response = await controller.handleUserDeleteBookmarkRequest(
      f.ctx,
      new Request('https://api.test/v1/bookmark/del', { method: 'POST', body: JSON.stringify({ bookmark_id: 12 }) })
    )
    expect(response.status).toBe(200)
    expect(remove).toHaveBeenCalledOnce()
    expect(f.records).toEqual([])
  })

  test('workflow creation snapshots the original client context', async () => {
    const f = setup()
    const create = vi.fn().mockResolvedValue(undefined)
    f.ctx.env.CRAWL_WORKFLOW = { create } as never
    const service = Object.create(CrawlService.prototype)
    service.logsService = { track: vi.fn().mockResolvedValue(undefined) }
    await service.createWorkflow(f.ctx.env, { url: 'https://example.test/article', bookmarkId: 12, userId: 7, enUserId: 70, userLang: 'en' }, 3, f.ctx)
    expect(create.mock.calls[0][0].params.eventContext).toMatchObject({ device_id: 'device-1', platform: 'web', locale: 'zh', client_version: '2.0.11', ua: 'test-browser' })
  })

  test('rate-limited saves are recorded even though the controller never runs', async () => {
    const f = setup()
    f.ctx.env.BOOKMARK_ADD_RATE_LIMITER = { limit: vi.fn().mockResolvedValue({ success: false }) } as never
    const body = JSON.stringify({ target_url: 'https://example.test/article' })
    const request = new Request('https://api.test/v1/bookmark/add_url', {
      method: 'POST',
      headers: { 'Content-Length': String(new TextEncoder().encode(body).length), 'X-Device-ID': 'device-1', 'X-CLIENT-VERSION': '2.0.11' },
      body
    })
    await expect(rateLimit(request, f.ctx)).rejects.toBeDefined()
    await f.flush()
    expect(f.records).toMatchObject([
      { event_name: 'bookmark_save_failed', user_id: 7, device_id: 'device-1', properties: { url_domain: 'example.test', error_class: 'bookmark_add' } }
    ])
  })

  test('REST star records a persisted transition, not a successful no-op response', async () => {
    const f = setup()
    const row = bookmark()
    const controller = Object.create(BookmarkController.prototype)
    controller.bookmarkService = { getBookmarkId: async () => 12, getUserBookmarkWithDetail: async () => structuredClone(row) }
    controller.bookmarkOrchestrator = { bookmarkStar: vi.fn().mockResolvedValue(undefined) }
    controller.logsService = { track: vi.fn().mockResolvedValue(undefined) }
    const request = () => new Request('https://api.test/v1/bookmark/star', { method: 'POST', body: JSON.stringify({ bookmark_id: 12, status: 'star' }) })
    await controller.handleUserBookmarkStarRequest(f.ctx, request())
    await f.flush()
    expect(f.records).toEqual([])
    controller.bookmarkOrchestrator.bookmarkStar.mockImplementation(async () => {
      row.is_starred = true
    })
    await controller.handleUserBookmarkStarRequest(f.ctx, request())
    await f.flush()
    expect(f.records.map(r => r.event_name)).toEqual(['bookmark_starred'])
    await controller.handleUserBookmarkStarRequest(f.ctx, request())
    await f.flush()
    expect(f.records).toHaveLength(1)
  })

  test('physical deletion records attributes captured before the relation disappears', async () => {
    const f = setup()
    let row: ReturnType<typeof bookmark> | null = bookmark()
    const controller = Object.create(BookmarkController.prototype)
    controller.bookmarkService = {
      getUserBookmarkWithDetail: async () => row,
      deleteBookmark: async () => {
        row = null
        return 'ok'
      }
    }
    const response = await controller.handleUserDeleteBookmarkRequest(
      f.ctx,
      new Request('https://api.test/v1/bookmark/del', { method: 'POST', headers: { 'X-Device-ID': 'device-1' }, body: JSON.stringify({ bookmark_id: 12 }) })
    )
    await f.flush()
    expect(response.status).toBe(200)
    expect(row).toBeNull()
    expect(f.records).toMatchObject([{ event_name: 'bookmark_deleted', properties: { bookmark_id: 'bookmark-1', url_domain: 'example.test' } }])
  })

  test('an invalid save request still records the server-observed rejection', async () => {
    const f = setup()
    const controller = Object.create(BookmarkController.prototype)
    await controller.handleUserAddUrlBookmarkRequest(f.ctx, new Request('https://api.test/v1/bookmark/add_url', { method: 'POST', body: '{}' }))
    await f.flush()
    expect(f.records).toMatchObject([{ event_name: 'bookmark_save_failed', properties: { bookmark_id: null, error_class: 'bookmark_add' } }])
  })

  test('step failure uses the original request metadata, never an anonymous workflow identity', async () => {
    const f = setup()
    const service = Object.create(CrawlService.prototype)
    service.logsService = { track: vi.fn().mockResolvedValue(undefined) }
    service.bookmarkRepo = { getUserBookmarkWithDetail: vi.fn().mockResolvedValue(bookmark()) }
    await service.sendAddBookmarkStepEvent(7, 12, 'example.test', 'parsing', 'failed', 'parse failed', f.ctx)
    await f.flush()
    expect(f.records).toMatchObject([
      {
        event_name: 'bookmark_save_failed',
        user_id: 7,
        device_id: 'device-1',
        properties: { bookmark_id: 'bookmark-1', error_class: 'parsing', client_version: '2.0.11', locale: 'zh' }
      }
    ])
  })

  test('identity is fixed before asynchronous stream submission', async () => {
    const f = setup()
    submitServerEvent(f.ctx, undefined, 'user_logged_in', { method: 'google' })
    f.ctx.setUserInfo(8, 80, 'another@example.test', 'en')
    await f.flush()
    expect(f.records[0].user_id).toBe(7)
  })
})
