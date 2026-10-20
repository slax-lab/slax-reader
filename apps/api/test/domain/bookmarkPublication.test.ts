import { describe, expect, it, vi } from 'vitest'
import { BookmarkRepo, queueStatus } from '@/infra/repository/dbBookmark'
import { BookmarkForkRepo } from '@/infra/repository/dbBookmarkFork'

function matches(row: any, where: any): boolean {
  return Object.entries(where).every(([key, value]: [string, any]) => {
    if (key === 'OR') return value.some((condition: any) => matches(row, condition))
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('lt' in value) return row[key] < value.lt
      if ('lte' in value) return row[key] <= value.lte
      if ('gt' in value) return row[key] > value.gt
      if ('in' in value) return value.in.includes(row[key])
    }
    return row[key] === value
  })
}

function store(version = 1) {
  let record = {
    id: 42,
    private_user: 10,
    title: 'old',
    content_key: 'old-body',
    content_md_key: 'old-text',
    status: 'success',
    moderation_result: 1,
    write_version: version,
    published_version: version
  }
  let forks = [{ target_bookmark_id: 42, status: 'current', source_uuid: 'source-one' }]
  let stages: any[] = []
  let summaries = ['old summary', 'old outline']
  let overviews = ['old overview']
  let mediaRefs = ['old media']
  let relations = [{ id: 7, metadata: { pdf_document_id: 'old-pdf' }, type: 2 }]
  const db = {
    $queryRaw: vi.fn(async (strings: unknown, ...values: any[]) => {
      const sql = Array.isArray(strings) ? String(strings[0]) : ''
      if (sql.includes('UPDATE sr_bookmark_object_stage')) {
        const token = values[0]
        const stageId = values[1]
        const stage = stages.find(item => item.id === stageId)
        if (!stage || stage.status === 'published' || stage.content_key === record.content_key || stage.updated_at >= new Date(Date.now() - 60 * 60_000)) return []
        stage.status = 'cleaning'
        stage.cleanup_token = token
        stage.updated_at = new Date()
        return [{ id: stage.id }]
      }
      return [{ ...record }]
    }),
    $executeRaw: vi.fn(async (strings: unknown, ...values: any[]) => {
      // The repository uses tagged SQL for relation/pointer maintenance. Keep
      // this lightweight double stateful so lease fencing tests exercise the
      // same observable transitions as PostgreSQL.
      const sql = Array.isArray(strings) ? strings.join('') : ''
      if (sql.includes('UPDATE sr_user_bookmark SET type = 0')) {
        Object.assign(relations[0], { type: 0, metadata: {} })
        return 1
      }
      if (sql.includes('DELETE FROM sr_bookmark_object_stage')) {
        const [stageId, token] = values
        const stage = stages.find(item => item.id === stageId)
        if (stage?.status === 'cleaning' && stage.cleanup_token === token && stage.cleanup_completed_at && stage.cleanup_completed_at < new Date(Date.now() - 24 * 3600_000)) {
          stages = stages.filter(item => item.id !== stageId)
          return 1
        }
        return 0
      }
      if (sql.includes('cleanup_completed_at')) {
        // The first statement in completeStageCleanup is the one that may
        // purge a settled tombstone. The second one changes the lease state.
        const requestedStatus = values[0]
        const stageId = values[2]
        const token = values[3]
        const stage = stages.find(item => item.id === stageId)
        if (stage && stage.status === 'cleaning' && stage.cleanup_token === token) {
          stage.status = requestedStatus
          stage.cleanup_token = null
          stage.cleanup_completed_at = requestedStatus === 'deleted' ? (stage.cleanup_completed_at ?? new Date()) : stage.cleanup_completed_at
          return 1
        }
        return 0
      }
      return 1
    }),
    sr_bookmark_fork_operation: {
      updateMany: async () => ({ count: 1 }),
      update: async () => ({})
    },
    sr_user_delete_bookmark: { deleteMany: async () => ({ count: 0 }) },
    sr_bookmark: {
      update: async ({ data }: any) => {
        record = { ...record, ...data, write_version: record.write_version + (data.write_version?.increment ?? 0) }
        return { ...record }
      },
      updateMany: async ({ where, data }: any) => {
        if (!matches(record, where)) return { count: 0 }
        record = { ...record, ...data }
        return { count: 1 }
      },
      findFirst: async ({ where }: any) => (matches(record, where) ? { ...record } : null)
    },
    sr_bookmark_summary: {
      deleteMany: async () => {
        summaries = []
        return { count: 2 }
      }
    },
    sr_user_bookmark_overview: {
      deleteMany: async () => {
        overviews = []
        return { count: 1 }
      }
    },
    sr_media_article_ref: {
      deleteMany: async () => {
        mediaRefs = []
        return { count: 1 }
      }
    },
    sr_user_bookmark: {
      findUniqueOrThrow: async () => ({ ...relations[0] }),
      findMany: async () => relations.map(relation => ({ ...relation })),
      update: async ({ where, data }: any) => {
        const relation = relations.find(item => item.id === where.id)
        if (relation) Object.assign(relation, data)
        return relation
      }
    },
    sr_bookmark_fork: {
      updateMany: async ({ data }: any) => {
        forks = forks.map(fork => (fork.status === 'current' ? { ...fork, ...data } : fork))
        return { count: 1 }
      },
      create: async ({ data }: any) => {
        forks.push(data)
        return data
      }
    },
    sr_bookmark_object_stage: {
      upsert: async ({ where, create }: any) => {
        const existing = stages.find(stage => matches(stage, where))
        if (existing) return existing
        const row = { id: `stage-${stages.length}`, cleanup_token: null, cleanup_after: new Date(Date.now() - 2 * 60 * 60_000), created_at: new Date(), ...create }
        stages.push(row)
        return row
      },
      updateMany: async ({ where, data }: any) => {
        const found = stages.filter(stage => matches(stage, where))
        found.forEach(stage => Object.assign(stage, data))
        return { count: found.length }
      },
      findMany: async ({ where }: any) => stages.filter(stage => matches(stage, where))
    },
    $transaction: async (fn: (tx: any) => Promise<any>) => {
      const snapshot = structuredClone({ record, forks, stages, summaries, overviews, mediaRefs, relations })
      try {
        return await fn(db)
      } catch (error) {
        ;({ record, forks, stages, summaries, overviews, mediaRefs, relations } = snapshot)
        throw error
      }
    }
  }
  const repo = Object.create(BookmarkRepo.prototype) as BookmarkRepo
  ;(repo as any).prismaPg = () => db
  const cleanup = new BookmarkForkRepo(() => db as any)
  return {
    repo,
    cleanup,
    db,
    record: () => record,
    forks: () => forks,
    stages: () => stages,
    summaries: () => summaries,
    overviews: () => overviews,
    mediaRefs: () => mediaRefs,
    relations: () => relations
  }
}

describe('bookmark publication versions', () => {
  it('publishes a staged legacy revision only while the bookmark is still version zero', async () => {
    const state = store(0)
    await state.repo.stageBookmarkObjects(42, 0, 'legacy-revision', ['legacy-revision'])
    expect(await state.repo.publishBookmarkVersion(42, 0, { content_key: 'legacy-revision' })).toBe(true)
    expect(state.record()).toMatchObject({ content_key: 'legacy-revision', write_version: 0, published_version: 0 })
    expect(state.stages()[0].status).toBe('published')
  })

  it('rejects a delayed legacy revision after a private save reserves a new version', async () => {
    const state = store(0)
    await state.repo.stageBookmarkObjects(42, 0, 'late-legacy-revision', ['late-legacy-revision'])
    await state.repo.reserveBookmarkWrite(42)
    expect(await state.repo.publishBookmarkVersion(42, 0, { content_key: 'late-legacy-revision' })).toBe(false)
    expect(state.record()).toMatchObject({ content_key: 'old-body', write_version: 1, published_version: 0 })
    expect(state.stages()[0].status).toBe('staged')
  })

  it('reserves increasing versions without modifying the previously published body and metadata', async () => {
    const state = store()
    expect((await state.repo.reserveBookmarkWrite(42)).write_version).toBe(2)
    expect((await state.repo.reserveBookmarkWrite(42)).write_version).toBe(3)
    expect(state.record()).toMatchObject({ title: 'old', content_key: 'old-body', published_version: 1 })
  })

  it('rejects late writes and publishes only the current uncommitted version', async () => {
    const state = store()
    await state.repo.reserveBookmarkWrite(42)
    await state.repo.reserveBookmarkWrite(42)
    await state.repo.stageBookmarkObjects(42, 2, 'late-body', ['late-body'])
    expect(await state.repo.publishBookmarkVersion(42, 2, { title: 'late', content_key: 'late-body' })).toBe(false)
    expect(state.record().content_key).toBe('old-body')
    expect(state.summaries()).toHaveLength(2)
    expect(state.overviews()).toHaveLength(1)
    expect(state.mediaRefs()).toHaveLength(1)
    await state.repo.stageBookmarkObjects(42, 3, 'new-body', ['new-body'])
    expect(await state.repo.publishBookmarkVersion(42, 3, { title: 'new', content_key: 'new-body' })).toBe(true)
    expect(await state.repo.publishBookmarkVersion(42, 3, { title: 'duplicate' })).toBe(false)
    expect(await state.repo.publishBookmarkVersion(42, 3, { title: 'new', content_key: 'new-body' })).toBe(true)
    expect(state.record()).toMatchObject({ title: 'new', content_key: 'new-body', published_version: 3 })
    expect(state.record().moderation_result).toBe(0)
    expect(state.forks().filter(row => row.status === 'current')).toEqual([])
    expect(state.summaries()).toEqual([])
    expect(state.overviews()).toEqual([])
    expect(state.mediaRefs()).toEqual([])
    expect(state.relations()[0]).toMatchObject({ type: 0, metadata: {} })
  })

  it('resets the old moderation verdict only when a replacement PDF publishes successfully', async () => {
    const state = store()
    await state.repo.reserveBookmarkWrite(42)
    await state.repo.stageBookmarkObjects(42, 1, 'stale.pdf', ['stale.pdf'])
    expect(await state.repo.completePdfBookmarkVersion(42, 1, { content_key: 'stale.pdf', status: 'success' }, 'stale-doc')).toBe(false)
    expect(state.record().moderation_result).toBe(1)
    await state.repo.stageBookmarkObjects(42, 2, 'new.pdf', ['new.pdf'])
    expect(await state.repo.completePdfBookmarkVersion(42, 2, { content_key: 'new.pdf', status: 'success' }, 'new-doc')).toBe(true)
    expect(state.record()).toMatchObject({ content_key: 'new.pdf', moderation_result: 0 })
  })

  it('replaces an older moderation verdict when publishing an approved Fork snapshot', async () => {
    const state = store()
    await state.repo.reserveBookmarkWrite(42)
    await state.repo.stageBookmarkObjects(42, 2, 'approved-body', ['approved-body', 'approved-text'])
    const published = await state.cleanup.publish(
      {
        id: 1,
        user_id: 10,
        source_uuid: 'approved-source',
        target_bookmark_id: 42,
        target_uuid: 'stable-uuid',
        write_version: 2,
        attempt_token: 'attempt',
        write_mode: 'overwritten',
        status: 'copying',
        staged_keys: []
      },
      {
        title: 'Approved',
        content_key: 'approved-body',
        content_md_key: 'approved-text',
        content_word_count: 100,
        status: 'success',
        published_at: new Date(),
        site_name: 'Example'
      },
      null,
      { bookmark_uid: 'stable-uuid', bookmark_id: 42, write_mode: 'overwritten', fork_info: null },
      { type: 0 }
    )
    expect(published).toBe(true)
    expect(state.record()).toMatchObject({ content_key: 'approved-body', moderation_result: 0 })
  })

  it('atomically replaces attribution and rolls back pointers, summaries, media, and staging if lineage persistence fails', async () => {
    const state = store()
    await state.repo.reserveBookmarkWrite(42)
    await state.repo.stageBookmarkObjects(42, 2, 'new-body', ['new-body'])
    state.db.sr_bookmark_fork.create = async () => {
      throw new Error('database failure')
    }
    await expect(state.repo.publishBookmarkVersion(42, 2, { content_key: 'new-body' }, { source_uuid: 'two', target_user_id: 10 } as any)).rejects.toThrow('database failure')
    expect(state.record().content_key).toBe('old-body')
    expect(state.forks()[0]).toMatchObject({ status: 'current', source_uuid: 'source-one' })
    expect(state.summaries()).toHaveLength(2)
    expect(state.overviews()).toHaveLength(1)
    expect(state.mediaRefs()).toHaveLength(1)
    expect(state.stages()[0].status).toBe('staged')
    expect(state.relations()[0]).toMatchObject({ type: 2, metadata: { pdf_document_id: 'old-pdf' } })
  })

  it('keeps legacy successful content readable when a refresh fails', async () => {
    const state = store()
    await state.repo.reserveBookmarkWrite(42)
    expect(await state.repo.updateBookmarkVersionStatus(42, 2, queueStatus.FAILED)).toBe(false)
    expect(state.record().status).toBe('success')
    expect(await state.repo.isBookmarkVersionCurrent(42, 1)).toBe(false)
    expect(await state.repo.isBookmarkVersionCurrent(42, 2)).toBe(true)
  })

  it('does not publish a stage already claimed for object deletion', async () => {
    const state = store()
    await state.repo.reserveBookmarkWrite(42)
    await state.repo.stageBookmarkObjects(42, 2, 'new-body', ['new-body'])
    state.stages()[0].updated_at = new Date(Date.now() - 2 * 3600_000)
    const token = await state.cleanup.claimStageCleanup(state.stages()[0].id)
    expect(token).toBeTruthy()
    expect(await state.repo.publishBookmarkVersion(42, 2, { content_key: 'new-body' })).toBe(false)
    expect(state.record().content_key).toBe('old-body')
  })

  it('does not clean a published stage and fences an expired cleanup lease', async () => {
    const state = store()
    await state.repo.reserveBookmarkWrite(42)
    await state.repo.stageBookmarkObjects(42, 2, 'new-body', ['new-body'])
    await state.repo.publishBookmarkVersion(42, 2, { content_key: 'new-body' })
    state.stages()[0].updated_at = new Date(Date.now() - 2 * 3600_000)
    expect(await state.cleanup.claimStageCleanup(state.stages()[0].id)).toBeNull()
    await state.repo.stageBookmarkObjects(42, 1, 'abandoned-body', ['abandoned-body'])
    const stage = state.stages()[1]
    stage.updated_at = new Date(Date.now() - 2 * 3600_000)
    const firstToken = await state.cleanup.claimStageCleanup(stage.id)
    stage.updated_at = new Date(Date.now() - 2 * 3600_000)
    const secondToken = await state.cleanup.claimStageCleanup(stage.id)
    expect(secondToken).not.toBe(firstToken)
    await state.cleanup.completeStageCleanup(stage.id, firstToken!, 'deleted')
    expect(stage.status).toBe('cleaning')
    await state.cleanup.completeStageCleanup(stage.id, secondToken!, 'deleted')
    expect(stage.status).toBe('deleted')
  })
})
