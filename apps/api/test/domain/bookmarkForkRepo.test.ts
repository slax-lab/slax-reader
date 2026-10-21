import { describe, expect, it, vi } from 'vitest'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'

const article = { target_url: 'https://example.com/a', title: 'A', host_url: 'example.com', site_name: 'Example', content_icon: '', content_cover: '', description: '' }

function setup(previous: any = null, currentVersion = 2) {
  let operation: any = previous
    ? {
        id: 1,
        user_id: 11,
        source_uuid: 'source',
        target_bookmark_id: 80,
        target_uuid: 'stable-uuid',
        write_version: 2,
        write_mode: 'overwritten',
        attempt_token: 'old-attempt',
        staged_keys: ['old-object'],
        status: 'failed',
        updated_at: new Date(0),
        result: null,
        ...previous
      }
    : null
  let bookmark = previous ? { id: 80, write_version: currentVersion, published_version: 1 } : null
  const matchesOperation = (where: any) =>
    operation &&
    (!where.id || operation.id === where.id) &&
    (!where.attempt_token || operation.attempt_token === where.attempt_token) &&
    (!where.cleanup_token || where.cleanup_token === operation.cleanup_token) &&
    (!where.status || (typeof where.status === 'string' ? operation.status === where.status : where.status.in.includes(operation.status))) &&
    (!where.updated_at || operation.updated_at < where.updated_at.lt)
  const db = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(async (strings: unknown, ...values: any[]) => {
      const sql = Array.isArray(strings) ? String(strings[0]) : ''
      if (sql.includes('UPDATE sr_bookmark_fork_operation')) {
        const [keys, operationId, attemptToken] = values
        if (!operation || operation.id !== operationId || operation.attempt_token !== attemptToken || operation.status !== 'copying') return []
        operation.staged_keys = keys
        return [{ target_bookmark_id: operation.target_bookmark_id, write_version: operation.write_version }]
      }
      return bookmark ? [{ ...bookmark }] : []
    }),
    sr_bookmark_fork_operation: {
      findUnique: vi.fn(async () => (operation ? { ...operation } : null)),
      findFirst: vi.fn(async ({ where }: any) => (matchesOperation(where) ? { target_bookmark_id: 80, write_version: operation.write_version } : null)),
      findMany: vi.fn(async () => (operation ? [{ ...operation }] : [])),
      create: vi.fn(async ({ data }: any) => {
        operation = { id: 1, result: null, ...data }
        return { ...operation }
      }),
      update: vi.fn(async ({ data }: any) => {
        operation = { ...operation, ...data }
        return { ...operation }
      }),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (!matchesOperation(where)) return { count: 0 }
        operation = { ...operation, ...data }
        return { count: 1 }
      })
    },
    sr_bookmark: {
      findUnique: vi.fn(async () => (bookmark ? { ...bookmark } : null)),
      upsert: vi.fn(async () => {
        bookmark ||= { id: 80, write_version: 0, published_version: 0 }
        return { id: 80 }
      }),
      update: vi.fn(async () => {
        bookmark!.write_version++
        return { write_version: bookmark!.write_version }
      })
    },
    sr_user_bookmark: { upsert: vi.fn(async () => ({ uuid: 'stable-uuid' })) },
    sr_bookmark_object_stage: { upsert: vi.fn() },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const snapshot = structuredClone({ operation, bookmark })
      try {
        return await fn(db)
      } catch (error) {
        ;({ operation, bookmark } = snapshot)
        throw error
      }
    }
  }
  const repo = new BookmarkForkRepo(() => db as any)
  return { repo, db, operation: () => operation, bookmark: () => bookmark }
}

describe('Fork operation retry fencing', () => {
  it('copies only safe creation metadata from the source, never its row identity or published pointers', async () => {
    const s = setup()
    await s.repo.begin(11, 'key', 'source', { ...article, id: 123, uuid: 'source-db-uuid', private_user: 7, write_version: 90, content_key: 'source-body' } as any, 0)
    const data = s.db.sr_bookmark.upsert.mock.calls[0][0].create
    expect(data).toMatchObject({ target_url: article.target_url, private_user: 11, status: 'pending' })
    expect(data).not.toHaveProperty('id')
    expect(data).not.toHaveProperty('uuid')
    expect(data).not.toHaveProperty('content_key')
    expect(data).not.toHaveProperty('write_version')
  })

  it('rejects retries superseded by a later direct save without reserving another version', async () => {
    const s = setup({}, 3)
    await expect(s.repo.begin(11, 'key', 'source', article, 0)).rejects.toBeTruthy()
    expect(s.db.sr_bookmark.update).not.toHaveBeenCalled()
    expect(s.operation().attempt_token).toBe('old-attempt')
    expect(s.bookmark()?.write_version).toBe(3)
  })

  it('reuses the original version with a fresh attempt token, preserving the destination UUID', async () => {
    const s = setup({ write_version: 2, published_version: 0 }, 2)
    const result = await s.repo.begin(11, 'key', 'source', article, 0)
    expect(result.write_version).toBe(2)
    expect(result.target_uuid).toBe('stable-uuid')
    expect(result.attempt_token).not.toBe('old-attempt')
    expect(s.db.sr_bookmark.update).not.toHaveBeenCalled()
    await s.repo.fail(result.id, 'old-attempt', 'late_failure')
    expect(s.operation().status).toBe('copying')
    await expect(s.repo.setStagedKeys(result.id, 'old-attempt', ['late-body'])).rejects.toBeTruthy()
    expect(s.db.sr_bookmark_object_stage.upsert).not.toHaveBeenCalled()
  })

  it('fences stale cleanup claims after a request starts a new copy attempt', async () => {
    const s = setup()
    const stale = { ...s.operation() }
    await s.repo.begin(11, 'key', 'source', article, 0)
    expect(await s.repo.claimCleanup(stale)).toBeNull()
    expect(s.operation().status).toBe('copying')
  })

  it('does not let an expired cleanup worker finish a replacement cleanup lease', async () => {
    const s = setup({}, 2)
    const stale = { ...s.operation(), updated_at: new Date(0) }
    s.operation().updated_at = new Date(0)
    const firstToken = await s.repo.claimCleanup(stale)
    expect(firstToken).toBeTruthy()
    s.operation().updated_at = new Date(0)
    const secondToken = await s.repo.claimCleanup({ ...s.operation() })
    expect(secondToken).toBeTruthy()
    await s.repo.fail(stale.id, stale.attempt_token, 'old_cleanup', true, firstToken!)
    expect(s.operation().status).toBe('cleaning')
    await s.repo.fail(stale.id, stale.attempt_token, 'done', true, secondToken!)
    expect(s.operation().status).toBe('abandoned')
  })

  it('rotates failed indexing retries without changing their durable state', async () => {
    const s = setup({ status: 'indexing', updated_at: new Date(0) }, 2)
    await s.repo.touchIndexing(1, 'old-attempt')
    expect(s.operation().status).toBe('indexing')
    expect(s.operation().updated_at.getTime()).toBeGreaterThan(0)
  })

  it('defers indexing retries until the five-minute repair window', async () => {
    const s = setup({ status: 'indexing', updated_at: new Date(Date.now() - 60_000) }, 2)
    s.db.sr_bookmark_fork_operation.findMany.mockImplementation(async ({ where }: any) => {
      const indexing = where.OR.find((item: any) => item.status === 'indexing')
      return s.operation()!.updated_at < indexing.updated_at.lt ? [{ ...s.operation() }] : []
    })
    expect(await s.repo.listPending()).toEqual([])

    s.operation()!.updated_at = new Date(Date.now() - 6 * 60_000)
    expect(await s.repo.listPending()).toHaveLength(1)
  })
})
