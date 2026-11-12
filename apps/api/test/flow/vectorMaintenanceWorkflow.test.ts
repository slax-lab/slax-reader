import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  initializeCore: vi.fn(),
  initializeInfrastructure: vi.fn(),
  clone: vi.fn(),
  resolve: vi.fn(),
  cleanup: vi.fn(),
  create: vi.fn(),
  createBatch: vi.fn(),
  service: {
    refreshArticles: vi.fn(),
    refreshArticlesWithPrevious: vi.fn(),
    refreshCollection: vi.fn(),
    applyCollection: vi.fn(),
    refreshUser: vi.fn(),
    verifyRefresh: vi.fn(),
    applyArticle: vi.fn()
  },
  repo: { listSubscriberUsers: vi.fn(), listOwnerCollections: vi.fn() }
}))
vi.mock('cloudflare:workers', () => ({
  WorkflowEntrypoint: class {
    constructor(
      public ctx: unknown,
      public env: unknown
    ) {}
  }
}))
vi.mock('@/decorators/di', () => ({ container: { clone: mocks.clone } }))
vi.mock('@/di/generated/dependency', () => ({ initializeCore: mocks.initializeCore, initializeInfrastructure: mocks.initializeInfrastructure }))
vi.mock('@/utils/context', () => ({
  ContextManager: class {
    cleanup = mocks.cleanup
    constructor(
      public execution: unknown,
      public env: unknown
    ) {}
  }
}))
vi.mock('@/domain/vectorMaintenance', () => ({ VectorMaintenanceService: class {} }))
vi.mock('@/infra/repository/dbVectorMaintenance', () => ({ VectorMaintenanceRepo: class {} }))

import { VectorMaintenanceWorkflow, requireRefreshSuccess, validateMaintenanceEvent, verifyVectorVisibility } from '@/entry/edge/workflows/vectorMaintenanceWorkflow'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import type { VectorMaintenanceEvent } from '@/domain/vectorMaintenanceHooks'
import type { VectorRefreshResult } from '@/utils/vectorMaintenanceTypes'

const step = () => {
  const names: string[] = []
  return {
    names,
    do: async (name: string, _options: unknown, callback: () => Promise<unknown>) => {
      names.push(name)
      return callback()
    }
  }
}
const run = (target: VectorMaintenanceEvent, execution = step(), eventId?: string) => {
  const workflow = new VectorMaintenanceWorkflow({} as any, { VECTOR_V5_MAINTENANCE_WORKFLOW: { create: mocks.create, createBatch: mocks.createBatch } } as any)
  return workflow.run({ payload: { eventId, target } } as any, execution as any)
}
const deleted = (target: VectorMaintenanceEvent): VectorRefreshResult => ({ target, state: 'deleted', vectorIds: ['vector'], mutationIds: ['delete'] })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.clone.mockReturnValue({ resolve: mocks.resolve })
  mocks.resolve.mockImplementation(token => (token === VectorMaintenanceService ? mocks.service : mocks.repo))
  mocks.cleanup.mockResolvedValue(undefined)
  mocks.service.verifyRefresh.mockResolvedValue(true)
  mocks.service.refreshArticles.mockImplementation(async rows => rows.map((row: any) => deleted({ kind: 'article', ...row })))
  mocks.service.refreshCollection.mockImplementation(async id => deleted({ kind: 'collection', id }))
  mocks.service.applyCollection.mockImplementation(async id => deleted({ kind: 'collection', id }))
  mocks.service.refreshUser.mockImplementation(async (id, preference) => deleted({ kind: 'user', id, preference }))
  mocks.service.refreshArticlesWithPrevious.mockImplementation(async rows => ({ results: rows.map((row: any) => deleted({ kind: 'article', ...row })), previous: {} }))
  mocks.service.applyArticle.mockImplementation(async ({ userId }) => [deleted({ kind: 'user', id: userId, preference: 'article' }), deleted({ kind: 'collection', id: 5 })])
  for (const query of Object.values(mocks.repo)) query.mockResolvedValue([])
})

describe('explicit maintenance business Workflow', () => {
  it('rejects obsolete generic and global article events', () => {
    for (const target of [
      { kind: 'content', bookmarkId: 99 },
      { kind: 'owner', userId: 7 },
      { kind: 'owner-publication', userId: 7 },
      { kind: 'article', id: 99 },
      { kind: 'user', id: 7, preference: 'mixed' }
    ]) {
      expect(() => validateMaintenanceEvent(target as any)).toThrow('invalid_vector_maintenance_event')
    }
    expect(() => validateMaintenanceEvent({ kind: 'article', userId: 7, id: 99 })).not.toThrow()
  })

  it('refreshes the article, its own article preference and owned Collection vectors without subscriber work', async () => {
    mocks.repo.listOwnerCollections.mockResolvedValue([{ id: 5 }])
    mocks.repo.listSubscriberUsers.mockResolvedValue([
      { id: 11, user_id: 8 },
      { id: 12, user_id: 9 }
    ])
    const execution = step()
    await run({ kind: 'article', userId: 7, id: 99 }, execution)
    expect(execution.names).toEqual(['article-write', 'article-visible', 'preference'])
    expect(mocks.service.refreshArticlesWithPrevious).toHaveBeenCalledExactlyOnceWith([{ userId: 7, id: 99 }])
    expect(mocks.service.applyArticle).toHaveBeenCalledExactlyOnceWith({ userId: 7, id: 99 }, undefined)
    expect(mocks.service.verifyRefresh).toHaveBeenCalledTimes(3)
    expect(mocks.service.refreshUser).not.toHaveBeenCalled()
    expect(mocks.service.refreshCollection).not.toHaveBeenCalled()
    expect(mocks.service.applyCollection).not.toHaveBeenCalled()
    expect(mocks.repo.listOwnerCollections).not.toHaveBeenCalled()
    expect(mocks.repo.listSubscriberUsers).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
    expect(mocks.createBatch).not.toHaveBeenCalled()
    expect(mocks.initializeCore).toHaveBeenCalledTimes(1)
    expect(mocks.clone).toHaveBeenCalledTimes(1)
    expect(mocks.resolve.mock.calls.map(([token]) => token)).toEqual([VectorMaintenanceService])
    expect(mocks.cleanup).toHaveBeenCalledTimes(1)
  })

  it.each([false, true])('does not enumerate owner Collection subscribers whether its result is changed or unchanged (unchanged=%s)', async unchanged => {
    mocks.repo.listOwnerCollections.mockResolvedValue([{ id: 5 }])
    mocks.repo.listSubscriberUsers.mockResolvedValue([{ id: 11, user_id: 8 }])
    if (unchanged)
      mocks.service.applyArticle.mockResolvedValue([
        {
          target: { kind: 'collection', id: 5 },
          state: 'written',
          vectorIds: ['c:5'],
          mutationIds: [],
          writeToken: 'a'.repeat(64),
          unchanged: true
        }
      ])
    const execution = step()
    await run({ kind: 'article', userId: 7, id: 99 }, execution)
    expect(execution.names).toEqual(['article-write', 'article-visible', 'preference'])
    expect(mocks.repo.listSubscriberUsers).not.toHaveBeenCalled()
    expect(mocks.service.applyArticle).toHaveBeenCalledExactlyOnceWith({ userId: 7, id: 99 }, undefined)
    expect(mocks.service.refreshUser).not.toHaveBeenCalled()
  })

  it.each([false, true])('does not enumerate subscribers for a direct Collection refresh whether changed or unchanged (unchanged=%s)', async unchanged => {
    mocks.repo.listSubscriberUsers.mockResolvedValue([{ id: 11, user_id: 8 }])
    if (unchanged)
      mocks.service.applyCollection.mockResolvedValue({
        target: { kind: 'collection', id: 5 },
        state: 'written',
        vectorIds: ['c:5'],
        mutationIds: [],
        writeToken: 'b'.repeat(64),
        unchanged: true
      })
    const execution = step()
    await run({ kind: 'collection', id: 5 }, execution)
    expect(execution.names).toEqual(['collection-5-write', 'collection-5-visible'])
    expect(mocks.repo.listSubscriberUsers).not.toHaveBeenCalled()
    expect(mocks.service.refreshUser).not.toHaveBeenCalled()
  })

  it('publishes a Collection from stored state in two steps without touching its members or rebuilding the owner', async () => {
    mocks.repo.listSubscriberUsers.mockResolvedValue([{ id: 1, user_id: 8 }])
    const execution = step()
    await run({ kind: 'collection', id: 5 }, execution)
    expect(execution.names).toEqual(['collection-5-write', 'collection-5-visible'])
    expect(mocks.service.applyCollection).toHaveBeenCalledExactlyOnceWith(5)
    expect(mocks.service.verifyRefresh).toHaveBeenCalledTimes(1)
    expect(mocks.service.refreshCollection).not.toHaveBeenCalled()
    expect(mocks.service.refreshArticles).not.toHaveBeenCalled()
    expect(mocks.service.refreshArticlesWithPrevious).not.toHaveBeenCalled()
    expect(mocks.service.applyArticle).not.toHaveBeenCalled()
    expect(mocks.repo.listSubscriberUsers).not.toHaveBeenCalled()
    expect(mocks.service.refreshUser).not.toHaveBeenCalled()
    expect(mocks.createBatch).not.toHaveBeenCalled()
  })

  it('does not let the subscriber count change Workflow steps or service calls', async () => {
    const runWithSubscribers = async (count: number) => {
      mocks.repo.listOwnerCollections.mockResolvedValue([{ id: 5 }])
      mocks.repo.listSubscriberUsers.mockResolvedValue(Array.from({ length: count }, (_, index) => ({ id: index + 1, user_id: index + 1000 })))
      const articleExecution = step()
      await run({ kind: 'article', userId: 7, id: 99 }, articleExecution)
      const collectionExecution = step()
      await run({ kind: 'collection', id: 5 }, collectionExecution)
      return {
        articleSteps: articleExecution.names,
        collectionSteps: collectionExecution.names,
        refreshUsers: mocks.service.refreshUser.mock.calls.map(call => [...call]),
        applied: mocks.service.applyArticle.mock.calls.map(call => [...call]),
        subscriberReads: mocks.repo.listSubscriberUsers.mock.calls.length
      }
    }
    const none = await runWithSubscribers(0)
    vi.resetAllMocks()
    mocks.clone.mockReturnValue({ resolve: mocks.resolve })
    mocks.resolve.mockImplementation(token => (token === VectorMaintenanceService ? mocks.service : mocks.repo))
    mocks.cleanup.mockResolvedValue(undefined)
    mocks.service.verifyRefresh.mockResolvedValue(true)
    mocks.service.refreshArticles.mockImplementation(async rows => rows.map((row: any) => deleted({ kind: 'article', ...row })))
    mocks.service.refreshCollection.mockImplementation(async id => deleted({ kind: 'collection', id }))
    mocks.service.applyCollection.mockImplementation(async id => deleted({ kind: 'collection', id }))
    mocks.service.refreshUser.mockImplementation(async (id, preference) => deleted({ kind: 'user', id, preference }))
    mocks.service.refreshArticlesWithPrevious.mockImplementation(async rows => ({ results: rows.map((row: any) => deleted({ kind: 'article', ...row })), previous: {} }))
    mocks.service.applyArticle.mockImplementation(async ({ userId }) => [deleted({ kind: 'user', id: userId, preference: 'article' }), deleted({ kind: 'collection', id: 5 })])
    mocks.repo.listSubscriberUsers.mockResolvedValue([])
    const many = await runWithSubscribers(503)
    expect(many).toEqual(none)
    expect(none.subscriberReads).toBe(0)
  })

  it('fails the Collection step when publication fails, so the Workflow retries it', async () => {
    mocks.service.applyCollection.mockResolvedValue({ target: { kind: 'collection', id: 5 }, state: 'failed', reason: 'missing_dependency:a:7:98', vectorIds: [], mutationIds: [] })
    await expect(run({ kind: 'collection', id: 5 })).rejects.toThrow('missing_dependency:a:7:98')
    expect(mocks.service.verifyRefresh).not.toHaveBeenCalled()
  })

  it('retires an old Collection-preference job without replaying cached materialization', async () => {
    const cached = new Map<string, unknown>([
      ['collection-preference-write', { target: { kind: 'user', id: 7, preference: 'collection' }, state: 'written', vectorIds: ['u:7:collection'], mutationIds: ['old'] }],
      ['collection-preference-visible', undefined]
    ])
    const names: string[] = []
    const execution = {
      names,
      do: async (name: string, _options: unknown, callback: () => Promise<unknown>) => {
        names.push(name)
        return cached.has(name) ? cached.get(name) : callback()
      }
    }
    await run({ kind: 'user', id: 7, preference: 'collection' }, execution)
    expect(names).toEqual(['retire-collection-preference-write', 'retire-collection-preference-visible'])
    expect(mocks.service.refreshUser).toHaveBeenCalledExactlyOnceWith(7, 'collection')
    expect(mocks.service.refreshCollection).not.toHaveBeenCalled()
    expect(mocks.service.refreshArticles).not.toHaveBeenCalled()
    expect(mocks.repo.listSubscriberUsers).not.toHaveBeenCalled()
  })

  it.each(['collection', 'article'] as const)('keeps explicit %s preference cleanup isolated', async preference => {
    await run({ kind: 'user', id: 7, preference })
    expect(mocks.service.refreshUser).toHaveBeenCalledExactlyOnceWith(7, preference)
    expect(mocks.service.refreshArticles).not.toHaveBeenCalled()
    expect(mocks.service.refreshCollection).not.toHaveBeenCalled()
    expect(mocks.repo.listSubscriberUsers).not.toHaveBeenCalled()
    expect(mocks.create).not.toHaveBeenCalled()
  })

  it('keeps visibility retry separate and never applies the preference after a failed article write', async () => {
    mocks.service.verifyRefresh.mockResolvedValue(false)
    const execution = step()
    const doStep = vi.spyOn(execution, 'do')
    await expect(run({ kind: 'article', userId: 7, id: 99 }, execution)).rejects.toThrow('vector_mutation_not_visible')
    expect(execution.names).toEqual(['article-write', 'article-visible'])
    expect(mocks.service.applyArticle).not.toHaveBeenCalled()
    expect(mocks.cleanup).toHaveBeenCalledTimes(1)
    mocks.service.verifyRefresh.mockResolvedValue(true)
    await doStep.mock.calls[1][2]()
    expect(mocks.service.refreshArticlesWithPrevious).toHaveBeenCalledTimes(1)

    mocks.service.refreshArticlesWithPrevious.mockResolvedValue({
      results: [{ target: { kind: 'article', userId: 7, id: 99 }, state: 'failed', reason: 'embedding_http_503', vectorIds: [], mutationIds: [] }],
      previous: {}
    })
    await expect(run({ kind: 'article', userId: 7, id: 99 })).rejects.toThrow('embedding_http_503')
    expect(mocks.service.applyArticle).not.toHaveBeenCalled()
  })

  it('hands the previous representative vector to the preference step and applies again when publication is not visible', async () => {
    const previous = Array.from({ length: 1024 }, (_, index) => (index === 3 ? 1 : 0))
    mocks.service.refreshArticlesWithPrevious.mockResolvedValue({ results: [deleted({ kind: 'article', userId: 7, id: 99 })], previous: { 'a:7:99': previous } })
    const execution = step()
    const doStep = vi.spyOn(execution, 'do')
    await run({ kind: 'article', userId: 7, id: 99 }, execution)
    expect(mocks.service.applyArticle).toHaveBeenCalledExactlyOnceWith({ userId: 7, id: 99 }, previous)
    mocks.service.verifyRefresh.mockResolvedValueOnce(false)
    await expect(doStep.mock.calls[2][2]()).rejects.toThrow('vector_mutation_not_visible')
    await doStep.mock.calls[2][2]()
    expect(mocks.service.applyArticle).toHaveBeenCalledTimes(3)
    expect(mocks.service.applyArticle).toHaveBeenLastCalledWith({ userId: 7, id: 99 }, previous)
  })

  it('fails the preference step when the owner Collection reports a missing dependency', async () => {
    mocks.service.applyArticle.mockResolvedValue([
      deleted({ kind: 'user', id: 7, preference: 'article' }),
      { target: { kind: 'collection', id: 5 }, state: 'failed', reason: 'missing_dependency:a:7:98', vectorIds: [], mutationIds: [] }
    ])
    await expect(run({ kind: 'article', userId: 7, id: 99 })).rejects.toThrow('missing_dependency:a:7:98')
  })

  it('rejects failed or missing vector writes before dependent refresh', async () => {
    const result: VectorRefreshResult = { target: { kind: 'article', userId: 7, id: 99 }, state: 'written', vectorIds: ['a:7:99'], mutationIds: ['write'] }
    expect(() => requireRefreshSuccess({ ...result, state: 'failed', reason: 'missing_dependency:a:7:99' })).toThrow('missing_dependency:a:7:99')
    expect(() => requireRefreshSuccess({ ...result, vectorIds: [] })).toThrow('vector_refresh_missing_ids')
    mocks.service.verifyRefresh.mockResolvedValue(false)
    await expect(verifyVectorVisibility(mocks.service as any, result)).rejects.toThrow('vector_mutation_not_visible')
  })

  it('cleans context on initialization failure', async () => {
    mocks.initializeInfrastructure.mockImplementation(() => {
      throw new Error('initialization failed')
    })
    await expect(run({ kind: 'user', id: 7, preference: 'collection' })).rejects.toThrow('initialization failed')
    expect(mocks.cleanup).toHaveBeenCalledTimes(1)
  })
})
