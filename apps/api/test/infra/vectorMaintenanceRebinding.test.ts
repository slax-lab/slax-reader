import { describe, expect, it, vi } from 'vitest'
import { DBSyncBatchOperation } from '@/infra/repository/dbSyncBatch'
import { SyncOrchestrator } from '@/domain/orchestrator/sync'

function fixture(failure?: 'rollback' | 'retry', saveUuid = 'save-a') {
  const now = new Date('2026-11-04T00:00:00Z')
  const source = {
    id: 99,
    uuid: 'shared-99',
    target_url: 'https://example.test/shared',
    private_user: 0,
    content_key: 'html/body/shared-99.html',
    content_md_key: 'text/body/shared-99.txt',
    title: 'Shared',
    status: 'success',
    created_at: now,
    updated_at: now,
    published_at: now
  }
  let bookmarks: any[] = [source]
  let relations: any[] = [
    { id: 1, uuid: 'save-a', user_id: 7, bookmark_id: 99, type: 0, is_starred: true, deleted_at: null, metadata: { preserved: 'A' } },
    { id: 2, uuid: 'save-b', user_id: 8, bookmark_id: 99, type: 0, is_starred: true, deleted_at: null, metadata: { preserved: 'B' } }
  ]
  let nextId = 100
  let attempts = 0
  let committed = false
  const pending: Promise<unknown>[] = []
  const hydrate = (row: any) => (row ? structuredClone({ ...row, bookmark: bookmarks.find(bookmark => bookmark.id === row.bookmark_id) }) : null)
  const selectRelation = (where: any) =>
    relations.find(row => {
      if (where.id !== undefined) return row.id === where.id
      if (where.uuid !== undefined) return row.uuid === where.uuid && (where.user_id === undefined || row.user_id === where.user_id)
      const pair = where.user_id_bookmark_id
      return pair && row.user_id === pair.user_id && row.bookmark_id === pair.bookmark_id
    })
  const db: any = {
    sr_bookmark: {
      findUnique: vi.fn(async ({ where }) => {
        const target = where.target_url_private_user
        return structuredClone(bookmarks.find(row => row.target_url === target.target_url && row.private_user === target.private_user) || null)
      }),
      create: vi.fn(async ({ data }) => {
        const row = { ...data, id: ++nextId }
        bookmarks.push(row)
        return structuredClone(row)
      }),
      upsert: vi.fn(async ({ where }) => {
        const target = where.target_url_private_user
        return structuredClone(bookmarks.find(row => row.target_url === target.target_url && row.private_user === target.private_user))
      })
    },
    sr_user_bookmark: {
      findFirst: vi.fn(async ({ where }) =>
        hydrate(
          where.bookmark
            ? relations.find(
                row =>
                  row.user_id === where.user_id &&
                  bookmarks.some(bookmark => bookmark.id === row.bookmark_id && bookmark.target_url === where.bookmark.target_url && bookmark.private_user === where.bookmark.private_user)
              )
            : selectRelation(where)
        )
      ),
      findUnique: vi.fn(async ({ where }) => hydrate(selectRelation(where))),
      findUniqueOrThrow: vi.fn(async ({ where }) => {
        const row = hydrate(selectRelation(where))
        if (!row) throw new Error('missing relation')
        return row
      }),
      update: vi.fn(async ({ where, data }) => {
        const row = selectRelation(where)
        Object.assign(row, data)
        return hydrate(row)
      }),
      upsert: vi.fn(async ({ where, update }) => {
        const row = selectRelation(where)
        Object.assign(row, update)
        return hydrate(row)
      }),
      findMany: vi.fn()
    },
    sr_user_bookmark_tag: { updateMany: vi.fn() },
    sr_user_delete_bookmark: {
      updateMany: vi.fn(),
      deleteMany: vi.fn(async () => {
        if (failure === 'rollback') throw new Error('rollback after rebinding')
        if (failure === 'retry' && attempts === 1) throw Object.assign(new Error('unique conflict after rebinding'), { code: 'P2002' })
      })
    },
    sr_bookmark_share: { updateMany: vi.fn() },
    sr_bookmark_import_relation: { updateMany: vi.fn() },
    sr_bookmark_summary: { deleteMany: vi.fn() },
    sr_user_bookmark_overview: { deleteMany: vi.fn() },
    $queryRaw: vi.fn().mockResolvedValue([]),
    $transaction: vi.fn(async (callback: (tx: any) => Promise<unknown>) => {
      const before = structuredClone({ bookmarks, relations })
      attempts++
      try {
        const result = await callback(db)
        committed = true
        return result
      } catch (error) {
        bookmarks = before.bookmarks
        relations = before.relations
        throw error
      }
    })
  }
  const createBatch = vi.fn(async () => {
    expect(committed).toBe(true)
    return []
  })
  const ctx = {
    env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { createBatch } },
    execution: { waitUntil: (work: Promise<unknown>) => pending.push(work) },
    get: () => ({ source: 'api' })
  } as any
  const observer = vi.fn((Object.create(SyncOrchestrator.prototype) as any).syncCommitObserver(ctx))
  const operation = {
    type: 'create_bookmark' as const,
    userId: 7,
    bookmarkUuid: saveUuid,
    data: { targetUrl: source.target_url, title: source.title, thumbnail: '', description: '', isArchive: false, isNewBookmark: false }
  }
  return {
    repo: new DBSyncBatchOperation(() => db),
    db,
    observer,
    createBatch,
    operation,
    source,
    rows: () => structuredClone({ bookmarks, relations }),
    flush: () => Promise.all(pending)
  }
}
const targets = (f: ReturnType<typeof fixture>) => f.createBatch.mock.calls.flatMap(args => (args as unknown as [any[]])[0].map(item => item.params.target))

describe('local-first historical bookmark rebinding maintenance', () => {
  it('REST save repository returns committed rebindings without dispatching', async () => {
    const { BookmarkRepo } = await import('@/infra/repository/dbBookmark')
    const f = fixture()
    f.db.sr_bookmark.updateMany = vi.fn().mockResolvedValue({ count: 1 })
    const repo = new BookmarkRepo({} as any, () => f.db)
    const result = await repo.createBookmark({ title: 'Saved', target_url: f.source.target_url, host_url: 'example.test', private_user: 7 } as any, 'pending')
    expect(result.rebindings).toEqual([{ userId: 7, previousBookmarkId: 99, bookmarkId: 101 }])
    expect(f.createBatch).not.toHaveBeenCalled()
  })

  it('direct fork lookup returns committed legacy rebindings without dispatching', async () => {
    const { BookmarkForkRepo } = await import('@/infra/repository/dbBookmarkFork')
    const f = fixture()
    const repo = new BookmarkForkRepo(() => f.db)
    const result = await repo.existing(7, f.source.target_url)
    expect(result?.rebindings).toEqual([{ userId: 7, previousBookmarkId: 99, bookmarkId: 101 }])
    expect(f.createBatch).not.toHaveBeenCalled()
  })

  it('dispatches old A/X cleanup after rebinding but waits for A/Y capture, never touching B/X', async () => {
    const f = fixture()
    await f.repo.executeOrderedOperations([f.operation], f.observer)
    await f.flush()
    const { bookmarks, relations } = f.rows()
    expect(relations.find(row => row.user_id === 7)).toMatchObject({ uuid: 'save-a', bookmark_id: 101, metadata: { preserved: 'A' } })
    expect(relations.find(row => row.user_id === 8)).toMatchObject({ uuid: 'save-b', bookmark_id: 99, metadata: { preserved: 'B' } })
    expect(bookmarks.find(row => row.id === 99)).toEqual(f.source)
    expect(bookmarks.find(row => row.id === 101)).toMatchObject({ private_user: 7, status: 'failed', content_md_key: '' })
    expect(bookmarks.find(row => row.id === 101).content_key).not.toBe(f.source.content_key)
    expect(targets(f)).toEqual([{ kind: 'article', userId: 7, id: 99 }])
    expect(f.db.sr_user_bookmark.findMany).not.toHaveBeenCalled()
    expect(f.observer.mock.calls[0][0]).toEqual([expect.objectContaining({ rebindings: [{ userId: 7, previousBookmarkId: 99, bookmarkId: 101 }] })])
  })

  it('resolves a fresh upload snapshot by user and owner-scoped target and still dispatches maintenance', async () => {
    const f = fixture(undefined, 'new-upload-id')
    await f.repo.executeOrderedOperations([f.operation], f.observer)
    await f.flush()
    expect(targets(f)).toEqual([{ kind: 'article', userId: 7, id: 99 }])
    expect(f.observer.mock.calls[0][0]).toEqual([
      expect.objectContaining({
        before: null,
        after: expect.objectContaining({ uuid: 'save-a', user_id: 7, bookmark_id: 101 }),
        rebindings: [{ userId: 7, previousBookmarkId: 99, bookmarkId: 101 }]
      })
    ])
  })

  it('keeps UUID lookup for operations other than a fresh create snapshot', async () => {
    const f = fixture(undefined, 'new-upload-id')
    const snapshot = (f.repo as any).eventSnapshot.bind(f.repo)
    expect(await snapshot(f.db, { type: 'update_bookmark', userId: 7, bookmarkUuid: 'new-upload-id', data: { is_starred: true } })).toBeNull()
    expect(await snapshot(f.db, { type: 'delete_bookmark', userId: 7, bookmarkUuid: 'new-upload-id' })).toBeNull()
    expect(
      await snapshot(f.db, {
        type: 'create_bookmark',
        userId: 7,
        bookmarkUuid: 'new-upload-id',
        data: { targetUrl: f.source.target_url, title: '', thumbnail: '', description: '', isArchive: false, isNewBookmark: true }
      })
    ).toBeNull()
    expect(
      await snapshot(f.db, {
        type: 'create_bookmark',
        userId: 7,
        bookmarkUuid: 'new-upload-id',
        data: { targetUrl: f.source.target_url, title: '', thumbnail: '', description: '', isArchive: false, isNewBookmark: false, readerSourceUuid: 'source-uuid' }
      })
    ).toBeNull()
  })

  it('does not dispatch captured old or new identities when a later operation rolls back', async () => {
    const f = fixture('rollback')
    await expect(f.repo.executeOrderedOperations([f.operation], f.observer)).rejects.toThrow('rollback after rebinding')
    await f.flush()
    expect(f.db.sr_bookmark.create).toHaveBeenCalledTimes(1)
    expect(f.observer).not.toHaveBeenCalled()
    expect(f.createBatch).not.toHaveBeenCalled()
    expect(f.rows().relations.map(row => [row.user_id, row.bookmark_id])).toEqual([
      [7, 99],
      [8, 99]
    ])
    expect(f.rows().bookmarks).toEqual([f.source])
  })

  it('clears identities from a rolled-back attempt before the existing transaction retry', async () => {
    const f = fixture('retry')
    await f.repo.executeOrderedOperations([f.operation], f.observer)
    await f.flush()
    expect(f.db.$transaction).toHaveBeenCalledTimes(2)
    expect(targets(f)).toEqual([{ kind: 'article', userId: 7, id: 99 }])
    expect(f.rows().relations.map(row => [row.user_id, row.bookmark_id])).toEqual([
      [7, 102],
      [8, 99]
    ])
  })
})
