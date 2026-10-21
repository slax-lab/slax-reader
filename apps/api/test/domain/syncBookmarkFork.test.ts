import { describe, expect, test, vi } from 'vitest'
import { SyncOrchestrator, type OrderedSyncOperation, type SyncChangeItem } from '@/domain/orchestrator/sync'
import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'
import { createMockCtx } from '@test/helpers/mockFactory'
import { SyncController } from '@/handler/http/syncController'

const sourceUid = '11111111-1111-4111-8111-111111111111'
const clientUid = '22222222-2222-4222-8222-222222222222'
const destinationUid = '33333333-3333-4333-8333-333333333333'
const readerUrl = `https://r.slax.com/b/${sourceUid}`
const create = (targetUrl: string, id = clientUid): SyncChangeItem => ({
  table: 'sr_user_bookmark', id, op: 'PUT', data: {
    archive_status: '0',
    metadata: JSON.stringify({ bookmark: { target_url: targetUrl, title: 'Article' } })
  }
})

function wire() {
  const dbSyncBatch = { executeOrderedOperations: vi.fn().mockResolvedValue([]) }
  const bookmarkForkService = { fork: vi.fn().mockResolvedValue({ bookmark_uid: destinationUid, bookmark_id: 42, write_mode: 'overwritten', fork_info: null }) }
  const crawlService = { createWorkflow: vi.fn().mockResolvedValue(undefined) }
  const searchService = { clearSearchCache: vi.fn().mockResolvedValue(undefined) }
  const orchestrator = Object.create(SyncOrchestrator.prototype) as SyncOrchestrator
  Object.assign(orchestrator, {
    userService: { getUserInfo: vi.fn().mockResolvedValue({ uuid: 'user-uuid' }) },
    dbSyncBatch, bookmarkForkService, crawlService, searchService,
    bookmarkSearchRepo: { upsertUserBookmark: vi.fn().mockResolvedValue(undefined) },
    logsService: { track: vi.fn().mockResolvedValue(undefined) },
    ga4Client: { trackEvent: vi.fn().mockResolvedValue(undefined) }
  })
  const ctx = createMockCtx({ userId: 7 })
  ctx.env.FRONT_END_URL = 'https://r.slax.com'
  return { orchestrator, ctx, dbSyncBatch, bookmarkForkService, crawlService }
}

describe('PowerSync Reader snapshot saves', () => {
  test('forks before inserting a Reader URL and remaps later bookmark and comment operations', async () => {
    const w = wire()
    await w.orchestrator.syncChanges(w.ctx, [
      create(readerUrl),
      { table: 'sr_user_bookmark', id: clientUid, op: 'PATCH', data: { is_starred: '1' } },
      { table: 'sr_bookmark_comment', id: 'comment-id', op: 'PUT', data: { user_bookmark_uuid: clientUid, type: '2', comment: 'Mine' } }
    ])
    expect(w.bookmarkForkService.fork).toHaveBeenCalledWith(w.ctx, { bookmark_uid: sourceUid }, `sync-fork:${clientUid}:${sourceUid}`, clientUid)
    const operations = w.dbSyncBatch.executeOrderedOperations.mock.calls.flatMap(call => call[0])
    expect(operations).not.toContainEqual(expect.objectContaining({ type: 'create_bookmark' }))
    expect(operations).toContainEqual(expect.objectContaining({ type: 'update_bookmark', bookmarkUuid: destinationUid, data: { is_starred: true } }))
    expect(operations).toContainEqual(expect.objectContaining({ type: 'create_comment', data: expect.objectContaining({ userBookmarkUuid: destinationUid }) }))
    expect(w.crawlService.createWorkflow).not.toHaveBeenCalled()
  })

  test('a rejected Fork creates no Reader URL row or crawl', async () => {
    const w = wire()
    w.bookmarkForkService.fork.mockRejectedValue(new Error('source is private'))
    await expect(w.orchestrator.syncChanges(w.ctx, [create(readerUrl)])).rejects.toThrow('source is private')
    expect(w.dbSyncBatch.executeOrderedOperations).not.toHaveBeenCalled()
    expect(w.crawlService.createWorkflow).not.toHaveBeenCalled()
  })

  test('preserves accepted direct/Fork write order within a mixed batch', async () => {
    const w = wire()
    const order: string[] = []
    w.dbSyncBatch.executeOrderedOperations.mockImplementation(async operations => {
      for (const operation of operations) order.push((operation as any).data.targetUrl ?? 'patch')
      return []
    })
    w.bookmarkForkService.fork.mockImplementation(async () => {
      order.push('fork')
      return { bookmark_uid: destinationUid, bookmark_id: 42, write_mode: 'overwritten', fork_info: null }
    })
    await w.orchestrator.syncChanges(w.ctx, [create('https://example.com/first', 'first'), create(readerUrl), create('https://example.com/last', 'last')])
    expect(order).toEqual(['https://example.com/first', 'fork', 'patch', 'https://example.com/last'])
  })

  test('passes the reserved version through to the crawl workflow', async () => {
    const w = wire()
    await w.orchestrator.sendRetryParseEvent(w.ctx, { bookmarkId: 42, targetUrl: 'https://example.com/article', userId: 7, writeVersion: 9 } as never)
    expect(w.crawlService.createWorkflow).toHaveBeenCalledWith(w.ctx.env, expect.objectContaining({ writeVersion: 9 }), 3, w.ctx)
  })

  test('validates all change shapes before an earlier Fork can commit', async () => {
    const w = wire()
    await expect(w.orchestrator.syncChanges(w.ctx, [create(readerUrl), { table: 'invalid-table', id: 'invalid', op: 'PUT', data: {} }])).rejects.toBeTruthy()
    expect(w.bookmarkForkService.fork).not.toHaveBeenCalled()
    expect(w.dbSyncBatch.executeOrderedOperations).not.toHaveBeenCalled()
  })

  test('rejects malformed later metadata before an earlier Fork commits', async () => {
    const w = wire()
    await expect(w.orchestrator.syncChanges(w.ctx, [create(readerUrl), {
      table: 'sr_user_bookmark', id: 'bad', op: 'PUT', data: { metadata: '{invalid' }
    }])).rejects.toBeTruthy()
    expect(w.bookmarkForkService.fork).not.toHaveBeenCalled()
    expect(w.dbSyncBatch.executeOrderedOperations).not.toHaveBeenCalled()
  })

  test('preserves escaped backslashes in ordinary bookmark metadata', async () => {
    const w = wire()
    const change = create('https://example.com/article')
    change.data!.metadata = JSON.stringify({ bookmark: { target_url: 'https://example.com/article', title: 'C:\\\\Users\\\\Reader' } })

    await w.orchestrator.syncChanges(w.ctx, [change])

    expect(w.dbSyncBatch.executeOrderedOperations.mock.calls[0][0]).toContainEqual(
      expect.objectContaining({ type: 'create_bookmark', data: expect.objectContaining({ title: 'C:\\\\Users\\\\Reader' }) })
    )
  })

  test('a direct save replay remaps later changes across a Fork boundary without crawling', async () => {
    const w = wire()
    w.dbSyncBatch.executeOrderedOperations.mockResolvedValueOnce([{
      bookmarkId: 42, targetUrl: 'https://example.com/article', userId: 7, writeVersion: 5,
      requestedBookmarkUuid: 'direct-client', bookmarkUuid: 'direct-stable', replayed: true
    }] as never)
    await w.orchestrator.syncChanges(w.ctx, [
      create('https://example.com/article', 'direct-client'), create(readerUrl),
      { table: 'sr_user_bookmark', id: 'direct-client', op: 'PATCH', data: { is_starred: '1' } }
    ])
    expect(w.dbSyncBatch.executeOrderedOperations.mock.calls[1][0]).toContainEqual(expect.objectContaining({ bookmarkUuid: 'direct-stable', data: { is_starred: true } }))
    expect(w.crawlService.createWorkflow).not.toHaveBeenCalled()
  })

  test('re-dispatches an unfinished direct save replay with its reserved version', async () => {
    const w = wire()
    w.dbSyncBatch.executeOrderedOperations.mockResolvedValueOnce([{
      bookmarkId: 42, targetUrl: 'https://example.com/article', userId: 7, writeVersion: 5,
      requestedBookmarkUuid: clientUid, bookmarkUuid: destinationUid, replayed: true, replayWorkflow: true
    }] as never)
    await w.orchestrator.syncChanges(w.ctx, [create('https://example.com/article')])
    expect(w.crawlService.createWorkflow).toHaveBeenCalledWith(
      w.ctx.env,
      expect.objectContaining({ bookmarkId: 42, url: 'https://example.com/article', writeVersion: 5 }),
      3,
      w.ctx
    )
  })

  test('rejects the sync batch when its workflow dispatch fails', async () => {
    const w = wire()
    w.dbSyncBatch.executeOrderedOperations.mockResolvedValueOnce([{
      bookmarkId: 42, targetUrl: 'https://example.com/article', userId: 7, writeVersion: 5,
      requestedBookmarkUuid: clientUid, bookmarkUuid: destinationUid, replayed: true, replayWorkflow: true
    }] as never)
    w.crawlService.createWorkflow.mockRejectedValueOnce(new Error('workflow unavailable'))
    await expect(w.orchestrator.syncChanges(w.ctx, [create('https://example.com/article')])).rejects.toMatchObject({ name: 'SyncWorkflowDispatchError' })
  })

  test('returns a retryable HTTP failure until the accepted sync save is dispatched', async () => {
    const w = wire()
    w.dbSyncBatch.executeOrderedOperations.mockResolvedValue([{
      bookmarkId: 42, targetUrl: 'https://example.com/article', userId: 7, writeVersion: 5,
      requestedBookmarkUuid: clientUid, bookmarkUuid: destinationUid, replayed: true, replayWorkflow: true
    }] as never)
    w.crawlService.createWorkflow.mockRejectedValueOnce(new Error('workflow unavailable'))
    const controller = new SyncController(w.orchestrator, { ensureUserNotDeleted: vi.fn().mockResolvedValue(undefined) } as never)
    const request = () => new Request('https://api.example.com/v1/sync/changes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([create('https://example.com/article')])
    })
    const failed = await controller.handleSyncSaveRequest(w.ctx, request())
    expect(failed.status).toBe(503)
    expect(await failed.json()).toMatchObject({ code: 503 })
    const recovered = await controller.handleSyncSaveRequest(w.ctx, request())
    expect(recovered.status).toBe(200)
    expect(await recovered.json()).toMatchObject({ code: 200, data: { status: true } })
    expect(w.crawlService.createWorkflow).toHaveBeenCalledTimes(2)
    for (const [, payload] of w.crawlService.createWorkflow.mock.calls) expect(payload).toMatchObject({ bookmarkId: 42, writeVersion: 5 })
  })

  test('keeps invalid sync input as a permanent HTTP 400 failure', async () => {
    const w = wire()
    const controller = new SyncController(w.orchestrator, { ensureUserNotDeleted: vi.fn().mockResolvedValue(undefined) } as never)
    const response = await controller.handleSyncSaveRequest(w.ctx, new Request('https://api.example.com/v1/sync/changes', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify([{ table: 'invalid-table', id: 'invalid', op: 'PUT', data: {} }])
    }))
    expect(response.status).toBe(400)
    expect(w.crawlService.createWorkflow).not.toHaveBeenCalled()
  })

  test('does not dispatch a completed direct save replay', async () => {
    const w = wire()
    await w.orchestrator.sendRetryParseEvent(w.ctx, {
      bookmarkId: 42, targetUrl: 'https://example.com/article', userId: 7,
      writeVersion: 5, replayed: true, replayWorkflow: false
    } as never)
    expect(w.crawlService.createWorkflow).not.toHaveBeenCalled()
  })

  test('applies the initial archive and star fields to the returned Fork destination', async () => {
    const w = wire()
    const change = create(readerUrl)
    change.data!.archive_status = '1'
    change.data!.is_starred = '1'
    await w.orchestrator.syncChanges(w.ctx, [change])
    const operations = w.dbSyncBatch.executeOrderedOperations.mock.calls.flatMap(call => call[0])
    expect(operations).toContainEqual(expect.objectContaining({ type: 'update_bookmark', bookmarkUuid: destinationUid, data: { archive_status: 1, is_starred: true } }))
  })
})

describe('PowerSync private publication reservation', () => {
  test('remaps same-batch patches and comments while repeated PUTs retain their operation identity', async () => {
    const repo = new DBSyncBatchOperation((() => ({ $transaction: async (callback: (tx: unknown) => Promise<void>) => callback({}) })) as never)
    const save = vi.spyOn(repo, 'executeCreateBookmark').mockResolvedValue({
      bookmarkId: 42, targetUrl: 'https://example.com/article', userId: 7, writeVersion: 5,
      requestedBookmarkUuid: clientUid, bookmarkUuid: destinationUid, replayed: true
    })
    const patch = vi.spyOn(repo, 'executeUpdateBookmark').mockResolvedValue(undefined)
    const comment = vi.spyOn(repo, 'executeCreateComment').mockResolvedValue(undefined)
    const put: OrderedSyncOperation = { type: 'create_bookmark', userId: 7, bookmarkUuid: clientUid, data: {
      targetUrl: 'https://example.com/article', title: 'Article', isArchive: false, isNewBookmark: true
    } }
    await repo.executeOrderedOperations([
      put,
      { type: 'update_bookmark', userId: 7, bookmarkUuid: clientUid, data: { is_starred: true } },
      { type: 'create_comment', userId: 7, commentUuid: 'comment', data: { userBookmarkUuid: clientUid } } as OrderedSyncOperation,
      put
    ])
    expect(save.mock.calls.map(call => (call[1] as typeof put).bookmarkUuid)).toEqual([clientUid, clientUid])
    expect(patch).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ bookmarkUuid: destinationUid }))
    expect(comment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ data: expect.objectContaining({ userBookmarkUuid: destinationUid }) }))
  })

  test('a replay resolves its stable destination without reserving after a newer Fork', async () => {
    const tx = {
      $executeRaw: vi.fn(),
      sr_bookmark_save_receipt: { findUnique: vi.fn().mockResolvedValue({ target_bookmark_id: 42, target_uuid: destinationUid, write_version: 5 }), create: vi.fn() },
      sr_bookmark: { upsert: vi.fn(), findUnique: vi.fn().mockResolvedValue({ target_url: 'https://example.com/article', write_version: 6, published_version: 6 }) }
    }
    const repo = new DBSyncBatchOperation((() => undefined) as never)
    const result = await repo.executeCreateBookmark(tx as never, { type: 'create_bookmark', bookmarkUuid: clientUid, userId: 7, data: {
      targetUrl: 'https://example.com/article', title: 'Article', isArchive: false, isNewBookmark: true
    } })
    expect(result).toMatchObject({ bookmarkId: 42, bookmarkUuid: destinationUid, requestedBookmarkUuid: clientUid, writeVersion: 5, replayed: true, replayWorkflow: false, targetUrl: 'https://example.com/article' })
    expect(tx.sr_bookmark.upsert).not.toHaveBeenCalled()
    expect(tx.sr_bookmark_save_receipt.create).not.toHaveBeenCalled()
  })

  test.each([
    { name: 'unfinished current write', current: { write_version: 5, published_version: 4 }, replayWorkflow: true },
    { name: 'published current write', current: { write_version: 5, published_version: 5 }, replayWorkflow: false },
    { name: 'superseded unfinished write', current: { write_version: 6, published_version: 4 }, replayWorkflow: false },
    { name: 'missing destination', current: null, replayWorkflow: false }
  ])('a receipt replay handles $name without reserving another version', async ({ current, replayWorkflow }) => {
    const tx = {
      $executeRaw: vi.fn(),
      sr_bookmark_save_receipt: { findUnique: vi.fn().mockResolvedValue({ target_bookmark_id: 42, target_uuid: destinationUid, write_version: 5 }), create: vi.fn() },
      sr_bookmark: {
        upsert: vi.fn(),
        findUnique: vi.fn().mockResolvedValue(current && { ...current, target_url: 'https://example.com/original' })
      }
    }
    const repo = new DBSyncBatchOperation((() => undefined) as never)
    const result = await repo.executeCreateBookmark(tx as never, {
      type: 'create_bookmark', bookmarkUuid: clientUid, userId: 7,
      data: { targetUrl: 'https://example.com/changed-payload', title: 'Article', isArchive: false, isNewBookmark: true }
    })
    expect(result).toMatchObject({ bookmarkId: 42, bookmarkUuid: destinationUid, requestedBookmarkUuid: clientUid, writeVersion: 5, replayed: true, replayWorkflow })
    if (current) expect(result?.targetUrl).toBe('https://example.com/original')
    expect(tx.sr_bookmark.upsert).not.toHaveBeenCalled()
    expect(tx.sr_bookmark_save_receipt.create).not.toHaveBeenCalled()
  })

  test('normalizes the private target and reserves a new version for a re-save', async () => {
    const tx = {
      $executeRaw: vi.fn(),
      sr_bookmark_save_receipt: { findUnique: vi.fn().mockResolvedValue(null), create: vi.fn() },
      sr_bookmark: { upsert: vi.fn().mockResolvedValue({ id: 42, write_version: 9, content_key: 'old-body' }) },
      sr_user_bookmark: { findUnique: vi.fn().mockResolvedValue(null), upsert: vi.fn().mockResolvedValue({ uuid: destinationUid }) },
      sr_user_delete_bookmark: { deleteMany: vi.fn() }
    }
    const repo = new DBSyncBatchOperation((() => undefined) as never)
    const operation: OrderedSyncOperation = { type: 'create_bookmark', userId: 7, bookmarkUuid: clientUid, data: {
      targetUrl: 'https://EXAMPLE.com:443/article', title: 'Article', isArchive: false, isNewBookmark: false
    } }
    const result = await repo.executeCreateBookmark(tx as never, operation)
    expect(tx.sr_bookmark.upsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { target_url_private_user: { target_url: 'https://example.com/article', private_user: 7 } },
      create: expect.objectContaining({ write_version: 1 }),
      update: expect.objectContaining({ write_version: { increment: 1 } })
    }))
    expect(result).toMatchObject({ bookmarkId: 42, targetUrl: 'https://example.com/article', userId: 7, writeVersion: 9 })
    expect(tx.sr_bookmark.upsert.mock.calls[0][0].update).not.toHaveProperty('content_key')
    expect(tx.sr_bookmark.upsert.mock.calls[0][0].update).not.toHaveProperty('title')
    expect(tx.sr_bookmark_save_receipt.create).toHaveBeenCalledWith({ data: expect.objectContaining({ user_id: 7, operation_key: `sync:${clientUid}`, target_uuid: destinationUid, write_version: 9 }) })
  })
})
