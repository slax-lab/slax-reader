import { beforeEach, describe, expect, it, vi } from 'vitest'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { SearchService } from '@/domain/search'
import { VectorizeRepo } from '@/infra/repository/dbVectorize'

const normalizer = vi.hoisted(() => ({ fulltext: vi.fn(), semantic: vi.fn() }))
vi.mock('@/utils/hybridSearch/normalizer', () => ({
  Normalizer: class {
    processFulltext = normalizer.fulltext
    processSemantic = normalizer.semantic
  }
}))

function deferred<T = void>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((ok, fail) => {
    resolve = ok
    reject = fail
  })
  return { promise, resolve, reject }
}

function repository(contentKey = 'current-body') {
  const row = { id: 42, content_key: contentKey, write_version: 4, published_version: 3 }
  const committedStages: unknown[][] = []
  let changes: unknown[][] = []
  const query = vi.fn(async (_sql: TemplateStringsArray, id: number, key: string) => (id === row.id && key === row.content_key ? [row] : []))
  const db = {
    $executeRaw: vi.fn(async (...args: unknown[]) => {
      changes.push(args)
      return 1
    }),
    $queryRaw: query,
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => {
      changes = []
      try {
        const result = await fn(db)
        committedStages.push(...changes)
        return result
      } catch (error) {
        changes = []
        throw error
      }
    })
  }
  const repo = Object.create(BookmarkRepo.prototype) as BookmarkRepo
  ;(repo as any).prismaPg = () => db
  const pending = vi.spyOn(repo, 'markBookmarkSearchIndexPending').mockResolvedValue(undefined)
  return { repo, db, row, committedStages, pending }
}

function serviceState() {
  let bookmark = { id: 42, title: 'Current', target_url: 'https://example.com', content_key: 'body-v1', content_md_key: 'md-v1' }
  let pending = true
  const repo = {
    markBookmarkSearchIndexPending: vi.fn(async () => {
      pending = true
    }),
    getBookmarkById: vi.fn(async () => ({ ...bookmark })),
    getBookmarkUserIds: vi.fn(async () => [8]),
    getVectorShard: vi.fn(async () => ({ bucket_idx: 0 })),
    upsertVectorShard: vi.fn(),
    commitBookmarkSearchIndex: vi.fn(async (_id: number, key: string, publish: (assert: () => Promise<void>) => Promise<unknown>) => {
      if (bookmark.content_key !== key) return { committed: false }
      const value = await publish(async () => {
        if (bookmark.content_key !== key) throw new Error('lease lost')
      })
      pending = false
      return { committed: true, value }
    }),
    listPendingBookmarkIndexStages: vi.fn(async () => (pending ? [{ bookmark_id: 42 }] : [])),
    touchPendingBookmarkIndexStages: vi.fn(async () => {})
  }
  const fulltext = { createBookmarkRaw: vi.fn(async () => {}), upsertUserBookmarks: vi.fn(async () => {}) }
  const vector = { deleteVector: vi.fn(async () => {}), upsertVector: vi.fn(async () => {}) }
  const ctx = {
    env: {
      OSS: { get: vi.fn(async (key: string) => ({ text: async () => (key === 'md-v1' ? 'Old committed body' : 'Newest committed body') })) },
      KV: { delete: vi.fn(async () => {}) }
    }
  }
  const makeService = () => new SearchService(repo as any, {} as any, fulltext as any, vector as any)
  return {
    repo,
    fulltext,
    vector,
    ctx,
    service: makeService(),
    restart: makeService,
    pending: () => pending,
    update: (next: Partial<typeof bookmark>) => {
      bookmark = { ...bookmark, ...next }
    }
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  normalizer.fulltext.mockImplementation(async (title: string, body: string) => [
    { raw_title: title, normalized_title: title, raw_content: body, normalized_content: body, shard_idx: 0 }
  ])
  normalizer.semantic.mockImplementation(async (id: number) => [{ id: `${id}_0`, embedding: [0.5] }])
})

describe('search index publication fence', () => {
  it('marks indexed only after external work finishes and uses published revision even when a newer save is pending', async () => {
    const state = repository()
    const external = deferred()
    const started = deferred()
    const publish = vi.fn(async (assertLease: () => Promise<void>) => {
      await assertLease()
      started.resolve()
      await external.promise
    })
    const result = state.repo.commitBookmarkSearchIndex(42, 'current-body', publish)
    await started.promise
    expect(state.committedStages).toHaveLength(0)
    external.resolve()
    await expect(result).resolves.toMatchObject({ committed: true })
    expect(state.committedStages).toHaveLength(2)
    expect(state.committedStages[0].at(-1)).toBe(3)
  })

  it('does not start external writes after a different body has been committed', async () => {
    const state = repository('new-body')
    const publish = vi.fn()
    await expect(state.repo.commitBookmarkSearchIndex(42, 'old-body', publish)).resolves.toEqual({ committed: false })
    expect(publish).not.toHaveBeenCalled()
    expect(state.committedStages).toHaveLength(0)
  })

  it('does not mark a failed external write indexed and durably requeues current content', async () => {
    const state = repository()
    await expect(
      state.repo.commitBookmarkSearchIndex(42, 'current-body', async () => {
        throw new Error('D1 unavailable')
      })
    ).rejects.toThrow('D1 unavailable')
    expect(state.committedStages).toHaveLength(0)
    expect(state.pending).toHaveBeenCalledWith(42)
  })

  it('waits for a timed-out external write to settle before requeueing the latest body', async () => {
    const state = repository()
    const timeout = deferred<never>()
    const external = deferred()
    const started = deferred()
    const originalTransaction = state.db.$transaction.getMockImplementation()!
    state.db.$transaction.mockImplementation(fn => Promise.race([originalTransaction(fn), timeout.promise]))
    const result = state.repo.commitBookmarkSearchIndex(42, 'current-body', async assertLease => {
      started.resolve()
      await external.promise
      await assertLease()
    })
    const assertion = expect(result).rejects.toThrow('transaction timed out')
    await started.promise
    timeout.reject(new Error('transaction timed out'))
    await Promise.resolve()
    expect(state.pending).not.toHaveBeenCalled()
    state.row.content_key = 'newest-body'
    state.db.$queryRaw.mockRejectedValue(new Error('transaction closed'))
    external.resolve()
    await assertion
    expect(state.pending).toHaveBeenCalledWith(42)
    expect(state.committedStages).toHaveLength(0)
  })
})

describe('search projections from committed content', () => {
  it('rejects delayed old normalization without replacing the newer index', async () => {
    const state = serviceState()
    const slow = deferred<any[]>()
    const started = deferred()
    normalizer.fulltext.mockImplementationOnce(async () => {
      started.resolve()
      return slow.promise
    })
    const oldAttempt = state.service.addSearchRecordByBmId(state.ctx as any, 42)
    await started.promise
    state.update({ content_key: 'body-v2', content_md_key: 'md-v2', title: 'Newest' })
    await state.service.indexCurrentBookmark(state.ctx as any, 42)
    slow.resolve([{ raw_title: 'Old', normalized_title: 'Old', raw_content: 'stale', normalized_content: 'stale' }])
    expect((await oldAttempt).every(result => result.status === 'rejected')).toBe(true)
    expect(state.fulltext.createBookmarkRaw).toHaveBeenCalledOnce()
    expect(state.fulltext.createBookmarkRaw.mock.calls[0][0][0].rawContent).toBe('Newest committed body')
    expect(state.vector.upsertVector).toHaveBeenCalledOnce()
  })

  it('ignores caller-provided parser content and reads the published R2 object', async () => {
    const state = serviceState()
    await state.service.addSearchRecord(state.ctx as any, 42, 'stale title', 'uncommitted body')
    expect(normalizer.fulltext).toHaveBeenCalledWith('Current', 'Old committed body')
    expect(state.fulltext.upsertUserBookmarks).toHaveBeenCalledWith(42, [8])
    expect(state.ctx.env.KV.delete).toHaveBeenCalledWith('search:bm_rows:8')
  })

  it('keeps failed work pending and a restarted service repairs from the newest committed body', async () => {
    const state = serviceState()
    state.vector.upsertVector.mockRejectedValueOnce(new Error('Vectorize unavailable'))
    expect((await state.service.addSearchRecordByBmId(state.ctx as any, 42)).every(result => result.status === 'rejected')).toBe(true)
    expect(state.pending()).toBe(true)
    state.update({ content_key: 'body-v2', content_md_key: 'md-v2' })
    await expect(state.restart().repairPendingIndexes(state.ctx as any)).resolves.toBe(1)
    expect(state.pending()).toBe(false)
    expect(state.fulltext.createBookmarkRaw.mock.lastCall![0][0].rawContent).toBe('Newest committed body')
    expect(state.repo.touchPendingBookmarkIndexStages).toHaveBeenCalledWith(42)
  })

  it('preserves durable work when normalizers return empty output', async () => {
    const state = serviceState()
    normalizer.semantic.mockResolvedValueOnce([])
    await expect(state.service.indexCurrentBookmark(state.ctx as any, 42)).rejects.toThrow('normalization failed')
    expect(state.pending()).toBe(true)
    expect(state.fulltext.createBookmarkRaw).not.toHaveBeenCalled()
  })

  it('indexes textless PDFs by title but retries a missing non-empty R2 key', async () => {
    const state = serviceState()
    state.update({ content_key: 'pdf/body/current.pdf', content_md_key: '' })
    await state.service.indexCurrentBookmark(state.ctx as any, 42)
    expect(normalizer.fulltext).toHaveBeenCalledWith('Current', '')
    expect(state.ctx.env.OSS.get).not.toHaveBeenCalled()
    state.update({ content_md_key: 'missing-text' })
    state.ctx.env.OSS.get.mockResolvedValueOnce(null as any)
    await expect(state.service.indexCurrentBookmark(state.ctx as any, 42)).rejects.toBeDefined()
    expect(state.pending()).toBe(true)
  })
})

describe('Vectorize mutation failures', () => {
  it('propagates upsert errors so the durable index stage is not marked successful', async () => {
    const repo = new VectorizeRepo((() => [
      {
        upsert: async () => {
          throw new Error('provider failed')
        }
      }
    ]) as any)
    await expect(repo.upsertVector(42, 0, [{ vecId: '42_0', vector: [0.5] }])).rejects.toThrow('provider failed')
    await expect(repo.upsertVector(42, 1, [{ vecId: '42_0', vector: [0.5] }])).rejects.toThrow('Invalid Vectorize shard')
  })
})
