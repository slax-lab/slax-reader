import { describe, expect, it, vi } from 'vitest'
import { SyncOrchestrator, type SyncChangeItem } from '@/domain/orchestrator/sync'
import { BookmarkNotFoundError } from '@/const/err'
import { ErrorName } from '@slax-reader/contracts'
import { forkError } from '@/utils/bookmarkForkError'
import { createMockCtx } from '@test/helpers/mockFactory'

const source = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const clientUuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const targetUrl = `https://reader.test/b/${source}`
const create = (url = targetUrl): SyncChangeItem => ({
  table: 'sr_user_bookmark', id: clientUuid, op: 'PUT',
  data: { metadata: JSON.stringify({ bookmark: { target_url: url, title: url } }) }
})
const edit = (id: string): SyncChangeItem => ({ table: 'sr_user_bookmark', id, op: 'PATCH', data: { is_starred: '1' } })

function setup() {
  const order: string[] = []
  const tx = {}
  const dbSyncBatch = {
    hasPersistedReaderSave: vi.fn(async () => false),
    executeCreateBookmark: vi.fn(async (_tx: unknown, op: any) => { order.push(`failed:${op.bookmarkUuid}`) }),
    executeOrderedOperations: vi.fn(async (operations: any[], _observer?: unknown, reader?: any) => {
      const callbacks = []
      for (const op of operations) {
        if (reader && op.type === 'create_bookmark' && op.data.readerSourceUuid) {
          const callback = await reader(tx, op)
          if (callback) callbacks.push(callback)
        } else order.push(`${op.type}:${op.bookmarkUuid}`)
      }
      order.push('commit')
      for (const callback of callbacks) await callback()
      return []
    })
  }
  const forkService = { dispatch: vi.fn(async () => { order.push('dispatch') }), reserve: vi.fn(async () => {
    order.push('reserve')
    return { bookmark_uid: clientUuid, bookmark_id: 10, disposition: 'created' }
  }) }
  const orchestrator = Object.assign(Object.create(SyncOrchestrator.prototype), {
    userService: { getUserInfo: vi.fn(async () => ({ uuid: 'user' })) },
    dbSyncBatch, forkService,
    searchService: { clearSearchCache: vi.fn() }, logsService: { track: vi.fn(async () => {}) }
  }) as SyncOrchestrator
  const ctx = createMockCtx({ userId: 7 })
  ctx.env.FRONT_END_URL = 'https://reader.test'
  return { orchestrator, ctx, dbSyncBatch, forkService, order, tx }
}

describe('Reader creates through the existing PowerSync upload endpoint', () => {
  it('admits the source with the local UUID between preceding and dependent mutations', async () => {
    const { orchestrator, ctx, forkService, order, tx } = setup()
    await orchestrator.syncChanges(ctx, [edit('previous'), create(), edit(clientUuid)])
    expect(order).toEqual(['update_bookmark:previous', 'reserve', `update_bookmark:${clientUuid}`, 'commit', 'dispatch'])
    expect(forkService.reserve).toHaveBeenCalledWith(ctx, source, clientUuid, tx)
  })

  it('keeps an ordinary-only batch together and does not dispatch it as Fork', async () => {
    const { orchestrator, ctx, dbSyncBatch, forkService } = setup()
    await orchestrator.syncChanges(ctx, [create('https://example.com/article'), edit(clientUuid)])
    expect(dbSyncBatch.executeOrderedOperations).toHaveBeenCalledOnce()
    expect(dbSyncBatch.executeOrderedOperations.mock.calls[0][0]).toHaveLength(2)
    expect(forkService.reserve).not.toHaveBeenCalled()
  })

  it('persists source rejection through the existing failed-save writer and continues the batch', async () => {
    const { orchestrator, ctx, forkService, dbSyncBatch, order } = setup()
    forkService.reserve.mockRejectedValueOnce(BookmarkNotFoundError())
    await orchestrator.syncChanges(ctx, [create(), edit('unrelated')])
    expect(dbSyncBatch.executeOrderedOperations.mock.calls[0][0][0]).toMatchObject({
      type: 'create_bookmark', bookmarkUuid: clientUuid, data: { readerSourceUuid: source, targetUrl }
    })
    expect(order).toEqual([`failed:${clientUuid}`, 'update_bookmark:unrelated', 'commit'])
  })

  it('acknowledges a persisted Reader save without rechecking its source on replay', async () => {
    const { orchestrator, ctx, dbSyncBatch, forkService, order } = setup()
    dbSyncBatch.hasPersistedReaderSave.mockResolvedValueOnce(true)
    await orchestrator.syncChanges(ctx, [create(), edit('unrelated')])
    expect(forkService.reserve).not.toHaveBeenCalled()
    expect(order).toEqual(['update_bookmark:unrelated', 'commit'])
  })

  it('acknowledges a busy destination without creating a failure placeholder', async () => {
    const { orchestrator, ctx, forkService, order } = setup()
    forkService.reserve.mockRejectedValueOnce(forkError(ErrorName.FORK_DESTINATION_IN_PROGRESS))
    await orchestrator.syncChanges(ctx, [create(), edit('unrelated')])
    expect(order).toEqual(['update_bookmark:unrelated', 'commit'])
  })

  it('leaves infrastructure failures retryable without running later operations', async () => {
    const { orchestrator, ctx, forkService, order } = setup()
    forkService.reserve.mockRejectedValueOnce(new Error('database disconnected'))
    await expect(orchestrator.syncChanges(ctx, [create(), edit('later')])).rejects.toThrow('database disconnected')
    expect(order).toEqual([])
  })
})
