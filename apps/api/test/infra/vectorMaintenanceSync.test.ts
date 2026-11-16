import { describe, expect, it, vi } from 'vitest'
import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'
import { SyncOrchestrator } from '@/domain/orchestrator/sync'

function setup() {
  const pending: Promise<unknown>[] = []
  let committed = false
  const createBatch = vi.fn(async () => {
    expect(committed).toBe(true)
    return []
  })
  const relations = [
    {
      uuid: 'save-7',
      user_id: 7,
      bookmark_id: 99,
      type: 0,
      is_starred: false,
      archive_status: 0,
      deleted_at: null,
      bookmark: { target_url: 'https://example.com/article', status: 'success' }
    },
    {
      uuid: 'save-8',
      user_id: 8,
      bookmark_id: 99,
      type: 0,
      is_starred: false,
      archive_status: 0,
      deleted_at: null,
      bookmark: { target_url: 'https://example.com/article', status: 'success' }
    }
  ]
  const findFirst = vi.fn(async ({ where }) => structuredClone(relations.find(row => row.uuid === where.uuid && row.user_id === where.user_id) ?? null))
  const update = vi.fn(async ({ where, data }) => {
    const row = relations.find(row => row.uuid === where.uuid && row.user_id === where.user_id)!
    Object.assign(row, data)
    return row
  })
  const db = {
    sr_user_bookmark: { findFirst, update },
    $transaction: vi.fn(async (callback: any) => {
      const result = await callback(db)
      committed = true
      return result
    })
  }
  const ctx = {
    env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { createBatch } },
    execution: { waitUntil: (work: Promise<unknown>) => pending.push(work) },
    getUserId: () => 7,
    get: () => ({ source: 'api' })
  } as any
  const repo = new DBSyncBatchOperation(() => db as any)
  const orchestrator = new SyncOrchestrator(
    { getUserInfo: vi.fn().mockResolvedValue({ uuid: 'user-7' }) } as any,
    repo,
    {} as any,
    { clearSearchCache: vi.fn() } as any,
    {} as any,
    {} as any,
    { track: vi.fn().mockResolvedValue(undefined) } as any,
    {} as any,
    {} as any
  )
  const observer = vi.fn((orchestrator as any).syncCommitObserver(ctx))
  return { repo, orchestrator, observer, db, ctx, createBatch, findFirst, update, flush: () => Promise.all(pending) }
}
const targets = (createBatch: ReturnType<typeof vi.fn>) => createBatch.mock.calls.flatMap(([batch]) => batch.map((item: any) => item.params.target))

describe('local-first private vector dispatch', () => {
  it('the real syncChanges entry passes only operations and the business observer to the repository', async () => {
    const { repo, orchestrator, ctx, flush, createBatch } = setup()
    const execute = vi.spyOn(repo, 'executeOrderedOperations')
    await orchestrator.syncChanges(ctx, [{ table: 'sr_user_bookmark', op: 'PATCH', id: 'save-7', data: { is_starred: '1' } }])
    await flush()
    expect(execute).toHaveBeenCalledWith(
      [expect.objectContaining({ type: 'update_bookmark', userId: 7, bookmarkUuid: 'save-7', data: expect.objectContaining({ is_starred: true }) })],
      expect.any(Function)
    )
    expect(targets(createBatch)).toEqual([{ kind: 'article', mode: 'relation', userId: 7, id: 99 }])
  })

  it('returns before and after identities to the observer only after transaction commit', async () => {
    const { repo, observer, createBatch, findFirst, flush } = setup()
    await repo.executeOrderedOperations([{ type: 'update_bookmark', userId: 7, bookmarkUuid: 'save-7', data: { is_starred: true } }], observer)
    await flush()
    expect(findFirst).toHaveBeenCalledTimes(2)
    expect(observer.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        before: expect.objectContaining({ user_id: 7, bookmark_id: 99, is_starred: false }),
        after: expect.objectContaining({ user_id: 7, bookmark_id: 99, is_starred: true })
      })
    ])
    expect(targets(createBatch)).toEqual([{ kind: 'article', mode: 'relation', userId: 7, id: 99 }])
  })

  it.each([0, 1] as const)('leaves archive status %s preference-neutral', async archive_status => {
    const { repo, observer, createBatch, flush } = setup()
    await repo.executeOrderedOperations([{ type: 'update_bookmark', userId: 7, bookmarkUuid: 'save-7', data: { archive_status } }], observer)
    await flush()
    expect(observer).toHaveBeenCalledTimes(1)
    expect(createBatch).not.toHaveBeenCalled()
  })

  it.each(['pending', 'success'])('admission follows committed source status: %s', async status => {
    const createBatch = vi.fn().mockResolvedValue([])
    const pending: Promise<unknown>[] = []
    const ctx = {
      env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { createBatch } },
      execution: { waitUntil: (work: Promise<unknown>) => pending.push(work) },
      get: () => ({ source: 'api' })
    }
    const observer = (Object.create(SyncOrchestrator.prototype) as any).syncCommitObserver(ctx)
    observer([{ operation: { type: 'create_bookmark', userId: 7 }, before: null, after: { user_id: 7, bookmark_id: 99, type: 0, bookmark: { status } } }], new Date().toISOString())
    await Promise.all(pending)
    expect(targets(createBatch)).toEqual(status === 'success' ? [{ kind: 'article', userId: 7, id: 99 }] : [])
  })

  it('does not invoke observer or dispatch rolled-back writes', async () => {
    const { repo, observer, createBatch, update } = setup()
    update.mockRejectedValueOnce(new Error('rollback'))
    await expect(repo.executeOrderedOperations([{ type: 'delete_bookmark', userId: 7, bookmarkUuid: 'save-7', data: undefined }], observer)).rejects.toThrow('rollback')
    expect(observer).not.toHaveBeenCalled()
    expect(createBatch).not.toHaveBeenCalled()
  })

  it('dispatches trash and restore and keeps identical bookmark IDs separate by owner', async () => {
    const { repo, observer, createBatch, flush } = setup()
    await repo.executeOrderedOperations(
      [
        { type: 'delete_bookmark', userId: 7, bookmarkUuid: 'save-7', data: undefined },
        { type: 'restore_bookmark', userId: 8, bookmarkUuid: 'save-8', data: undefined }
      ],
      observer
    )
    await flush()
    expect(targets(createBatch)).toEqual([
      { kind: 'article', mode: 'relation', userId: 7, id: 99 },
      { kind: 'article', userId: 8, id: 99 }
    ])
  })

  it('performs no vector dispatch or snapshot queries without an observer', async () => {
    const { repo, createBatch, findFirst } = setup()
    await repo.executeOrderedOperations([{ type: 'update_bookmark', userId: 7, bookmarkUuid: 'save-7', data: { is_starred: true } }])
    expect(findFirst).not.toHaveBeenCalled()
    expect(createBatch).not.toHaveBeenCalled()
  })
})
