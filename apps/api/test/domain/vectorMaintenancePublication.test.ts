import { describe, expect, it, vi } from 'vitest'
import { PGlite } from '@electric-sql/pglite'
import { Prisma, type PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { ShareService } from '@/domain/share'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import { CollectionController } from '@/handler/http/collectionController'
import { CollectionRepo } from '@/infra/repository/dbCollection'
import { VectorMaintenanceRepo } from '@/infra/repository/dbVectorMaintenance'
import { CollectionJob } from '@/handler/cron/collectionJob'
import { memoryPreferences } from '../helpers/preferenceMemory'

function context() {
  const pending: Promise<unknown>[] = []
  const create = vi.fn().mockResolvedValue({ id: 'instance' })
  const createBatch = vi.fn(async (items: unknown[]) => Promise.all(items.map(item => create(item))))
  const ctx = {
    env: { VECTOR_V5_MAINTENANCE_WORKFLOW: { createBatch } },
    execution: { waitUntil: (work: Promise<unknown>) => pending.push(work) },
    getUserId: () => 7,
    hashIds: { decodeId: () => 99 }
  }
  return { ctx: ctx as any, create, createBatch, flush: () => Promise.all(pending) }
}

describe('publication maintenance hooks', () => {
  it.each([true, false])('the actual share_collect toggle dispatches publication after enable=%s commits', async enable => {
    const { UserService } = await import('@/domain/user')
    const { ctx, create, flush } = context()
    const row = {
      id: 5,
      display_name: 'Owner collection',
      avatar: 'avatar',
      description: 'Description',
      collection_code: 'owner7',
      status: enable ? 1 : 0,
      show_marks: true,
      allow_marks: false,
      show_profile: true
    }
    const enableUserShareCollect = vi.fn().mockResolvedValue(row)
    const service = Object.assign(Object.create(UserService.prototype), {
      userRepoData: { getInfoByUserId: vi.fn().mockResolvedValue({ name: 'Owner' }) },
      collectionRepo: { enableUserShareCollect }
    })
    await expect(service.enableUserSetting(ctx, 'share_collect', enable)).resolves.toEqual({
      show_name: row.display_name,
      avatar: row.avatar,
      description: row.description,
      collection_code: row.collection_code,
      status: row.status,
      show_marks: row.show_marks,
      allow_marks: row.allow_marks,
      show_profile: row.show_profile
    })
    await flush()
    expect(enableUserShareCollect).toHaveBeenCalledExactlyOnceWith(7, enable, 'Owner', 1)
    expect(create).toHaveBeenCalledTimes(1)
    expect(create.mock.calls[0][0].params.target).toEqual({ kind: 'collection', id: 5 })
    expect(enableUserShareCollect.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0])
  })

  it('a failed share_collect toggle does not dispatch publication work', async () => {
    const { UserService } = await import('@/domain/user')
    const { ctx, create, flush } = context()
    const service = Object.assign(Object.create(UserService.prototype), {
      userRepoData: { getInfoByUserId: vi.fn().mockResolvedValue({ name: 'Owner' }) },
      collectionRepo: { enableUserShareCollect: vi.fn().mockRejectedValue(new Error('toggle failed')) }
    })
    await expect(service.enableUserSetting(ctx, 'share_collect', false)).rejects.toThrow('toggle failed')
    await flush()
    expect(create).not.toHaveBeenCalled()
  })

  it('unrelated user settings do not dispatch Collection publication', async () => {
    const { UserService } = await import('@/domain/user')
    const { ctx, create, flush } = context()
    const updatePlatformSetting = vi.fn().mockResolvedValue(undefined)
    const service = Object.assign(Object.create(UserService.prototype), { updatePlatformSetting })
    await expect(service.enableUserSetting(ctx, 'platform_setting', true)).resolves.toBe('ok')
    await flush()
    expect(updatePlatformSetting).toHaveBeenCalledWith(ctx, 'platform_setting', true)
    expect(create).not.toHaveBeenCalled()
  })

  it('collection setting edits dispatch no vector maintenance', async () => {
    const { ctx, create, flush } = context()
    const updateUserShareCollect = vi.fn().mockResolvedValue(undefined)
    const controller = new CollectionController({ userHasCollection: vi.fn().mockResolvedValue({ id: 5 }) } as any, { updateUserShareCollect } as any)
    await controller.handleUserSettingShareCollectRequest(
      ctx,
      new Request('https://reader.test/setting', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Collection', status: 0 }) })
    )
    await flush()
    expect(updateUserShareCollect).toHaveBeenCalledOnce()
    expect(create).not.toHaveBeenCalled()
  })

  it.each(['success', 'pending'])('REST share disable admits only completed actor body: %s', async status => {
    const { ctx, create, flush } = context()
    const updateBookmarkShareIsEnable = vi.fn().mockResolvedValue(undefined)
    await new ShareService({ updateBookmarkShareIsEnable, getBookmarkById: vi.fn().mockResolvedValue({ status }) } as any, {} as any).deleteBookmarkShare(ctx, 123)
    await flush()
    expect(updateBookmarkShareIsEnable).toHaveBeenCalledWith(99, 7, false)
    expect(create.mock.calls.map(([args]) => args.params.target)).toEqual(status === 'success' ? [{ kind: 'article', userId: 7, id: 99 }] : [])
  })

  it('REST share updates refresh current actor metadata after commit', async () => {
    const { ctx, create, flush } = context()
    const updateBookmarkShare = vi.fn().mockResolvedValue({ allow_comment: true, show_comment: true, show_userinfo: true, share_code: 'code' })
    const repo = {
      getUserBookmark: vi.fn().mockResolvedValue({ user_id: 7 }),
      getBookmarkById: vi.fn().mockResolvedValue({ moderation_result: 0, status: 'success' }),
      getBookmarkShareByBookmarkId: vi.fn().mockResolvedValue({ user_id: 7 }),
      updateBookmarkShare
    }
    await new ShareService(repo as any, {} as any).updateBookmarkShare(ctx, { bookmark_id: 123, show_comment_line: true, show_userinfo: true, allow_action: true })
    await flush()
    expect(updateBookmarkShare.mock.invocationCallOrder[0]).toBeLessThan(create.mock.invocationCallOrder[0])
    expect(create.mock.calls[0][0].params.target).toEqual({ kind: 'article', userId: 7, id: 99 })
  })

  it('snapshot-sharing changes dispatch all current owner members without recomputing inline', async () => {
    const { UserService } = await import('@/domain/user')
    const { ctx, create, flush } = context()
    const updateShareEnabled = vi.fn().mockResolvedValue(undefined)
    const service = Object.create(UserService.prototype)
    service.userRepo = { updateShareEnabled }
    service.collectionRepo = { getUserShareCollect: vi.fn().mockResolvedValue({ id: 5 }) }
    await service.updateShareEnabled(ctx, false)
    await flush()
    expect(updateShareEnabled).toHaveBeenCalledWith(7, false)
    expect(create.mock.calls[0][0].params.target).toEqual({ kind: 'collection', id: 5 })
  })
})

describe('existing collection expiry maintenance', () => {
  it('updates all changed subscriptions in one statement without vector dispatch', async () => {
    const { ctx, create, createBatch } = context()
    let committed = false
    const db = {
      $queryRaw: vi.fn(async () => {
        committed = true
        return [{ user_id: 7 }, { user_id: 8 }]
      })
    }
    const repo = new CollectionRepo(() => db as any)
    const job = new CollectionJob({ recomputeSubscriberActiveStatus: () => repo.recomputeSubscriberActive() } as any)
    create.mockImplementation(async () => {
      expect(committed).toBe(true)
      return { id: 'instance' }
    })
    await job.recomputeCollectionSubscriberActive(ctx)
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
    const sql = (db.$queryRaw.mock.calls[0] as unknown as [TemplateStringsArray])[0].join('')
    expect(sql).toContain('UPDATE sr_user_collection_subscriber')
    expect(sql).toContain('RETURNING user_id')
    expect(sql).toContain('SELECT DISTINCT user_id FROM changed')
    expect(sql).not.toContain('LIMIT')
    expect(committed).toBe(true)
    expect(create).not.toHaveBeenCalled()
    expect(createBatch).not.toHaveBeenCalled()
  })

  it('expiry revocation does not depend on an available Workflow binding', async () => {
    const { ctx, createBatch } = context()
    let revoked = false
    const db = {
      $queryRaw: vi.fn(async () => {
        revoked = true
        return [{ user_id: 7 }]
      })
    }
    const repo = new CollectionRepo(() => db as any)
    const job = new CollectionJob({ recomputeSubscriberActiveStatus: () => repo.recomputeSubscriberActive() } as any)
    createBatch.mockImplementation(async () => {
      expect(revoked).toBe(true)
      throw new Error('dispatch failed')
    })
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      await expect(job.recomputeCollectionSubscriberActive(ctx)).resolves.toBeUndefined()
      expect(revoked).toBe(true)
      expect(db.$queryRaw).toHaveBeenCalledTimes(1)
      expect(log).not.toHaveBeenCalled()
      expect(createBatch).not.toHaveBeenCalled()
    } finally {
      log.mockRestore()
    }
  })

  it('does not cap database updates at two thousand or create per-user jobs', async () => {
    const { ctx, createBatch, create } = context()
    const changed = Array.from({ length: 2105 }, (_, index) => ({ user_id: index + 1 }))
    const db = { $queryRaw: vi.fn().mockResolvedValue(changed) }
    const repo = new CollectionRepo(() => db as any)
    const job = new CollectionJob({ recomputeSubscriberActiveStatus: () => repo.recomputeSubscriberActive() } as any)
    await job.recomputeCollectionSubscriberActive(ctx)
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
    expect(createBatch).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('does not dispatch if the SQL update fails or changes no rows', async () => {
    const { ctx, createBatch } = context()
    const service = { recomputeSubscriberActiveStatus: vi.fn().mockRejectedValueOnce(new Error('database unavailable')).mockResolvedValueOnce([]) }
    const job = new CollectionJob(service as any)
    await expect(job.recomputeCollectionSubscriberActive(ctx)).rejects.toThrow('database unavailable')
    await expect(job.recomputeCollectionSubscriberActive(ctx)).resolves.toBeUndefined()
    expect(createBatch).not.toHaveBeenCalled()
  })
})

describe('maintenance repository eligibility boundaries', () => {
  it('excludes incomplete source captures from every Collection aggregation and publication enumeration', async () => {
    const { VectorMaintenanceRepo } = await import('@/infra/repository/dbVectorMaintenance')
    const query = vi.fn().mockResolvedValue([])
    const repo = new VectorMaintenanceRepo(() => ({ $queryRaw: query }) as any)
    await repo.listUserArticles(7, 20, 25)
    await repo.findUserPreferenceRows(7, [1])
    await repo.listUserCollections(8, 0, 25)
    await repo.findCollection(3)
    expect(query).toHaveBeenCalledTimes(4)
    for (const [strings] of query.mock.calls) expect((strings as TemplateStringsArray).join('')).toContain("b.status = 'success'")
  })

  it('enumerates deletion identities with keyset bounds even after account tombstone and relation trash', async () => {
    const { VectorMaintenanceRepo } = await import('@/infra/repository/dbVectorMaintenance')
    const rows = [{ id: 21, bookmark_id: 99 }]
    const query = vi.fn().mockResolvedValue(rows)
    const repo = new VectorMaintenanceRepo(() => ({ $queryRaw: query }) as any)
    expect(await repo.listUserBookmarkIds(7, 20, 50)).toEqual(rows)
    const [strings, ...values] = query.mock.calls[0]
    const sql = (strings as TemplateStringsArray).join('?')
    expect(sql).toContain('SELECT id, bookmark_id FROM sr_user_bookmark')
    expect(sql).toContain('WHERE user_id = ? AND id > ? ORDER BY id LIMIT ?')
    expect(sql).not.toContain('JOIN')
    expect(sql).not.toContain('deleted_at')
    expect(sql).not.toContain('status')
    expect(values).toEqual([7, 20, 50])
  })
})

const disposableSchema = `
  CREATE TABLE sr_user(id int PRIMARY KEY, deleted_at timestamp, snapshot_sharing boolean DEFAULT true);
  CREATE TABLE sr_bookmark(id int PRIMARY KEY, uuid text, title text DEFAULT '', private_user int DEFAULT 0, status text DEFAULT 'success', moderation_result int DEFAULT 0, updated_at timestamp DEFAULT now(), published_at timestamp DEFAULT now());
  CREATE TABLE sr_user_bookmark(id serial, user_id int, bookmark_id int, is_starred boolean DEFAULT false, deleted_at timestamp, type int DEFAULT 0, created_at timestamp DEFAULT now(), starred_at timestamp, PRIMARY KEY(user_id, bookmark_id));
  CREATE TABLE sr_bookmark_share(bookmark_id int, user_id int, is_enable boolean, PRIMARY KEY(bookmark_id, user_id));
  CREATE TABLE sr_user_collection(id int PRIMARY KEY, owner_id int, status int DEFAULT 1, collection_code text DEFAULT '', created_at timestamp DEFAULT now());
  CREATE TABLE sr_user_collection_subscriber(id serial, user_id int, collection_id int, is_deleted boolean DEFAULT false, is_cancelled boolean DEFAULT false, is_active boolean DEFAULT true, auto_renew boolean DEFAULT true, subscription_end_time timestamp DEFAULT now() + interval '1 year', updated_at timestamp DEFAULT now());
`
const axis = (index = 0) => Array.from({ length: 1024 }, (_, position) => (position === index ? 1 : 0))

async function withDisposableDb(run: (pg: PGlite) => Promise<void>) {
  const pg = new PGlite()
  try {
    await pg.exec(disposableSchema)
    await run(pg)
  } finally {
    await pg.close()
  }
}

function disposablePrisma(pg: PGlite) {
  return {
    async $queryRaw(strings: TemplateStringsArray, ...values: unknown[]) {
      const query = Prisma.sql(strings, ...values)
      return (await pg.query(query.text, query.values)).rows
    }
  } as unknown as HyperdrivePrismaClient
}

function disposableIndex() {
  const stored = new Map<string, VectorizeVector>()
  return {
    stored,
    get: vi.fn(async (_kind: string, ids: string[]) => ids.flatMap(id => (stored.has(id) ? [stored.get(id)!] : []))),
    upsert: vi.fn(async (_kind: string, vectors: VectorizeVector[]) => {
      for (const vector of vectors) stored.set(vector.id, structuredClone(vector))
      return { mutationId: crypto.randomUUID() }
    }),
    delete: vi.fn(async (_kind: string, ids: string[]) => {
      for (const id of ids) stored.delete(id)
      return { mutationId: crypto.randomUUID() }
    }),
    query: vi.fn()
  }
}

describe('disposable PostgreSQL Collection and expiry subcases', () => {
  it('counts a multi-chunk Collection member representative once, independent of chunk count', async () => {
    await withDisposableDb(async pg => {
      await pg.exec(`
        INSERT INTO sr_user(id) VALUES (7),(8);
        INSERT INTO sr_user_collection(id,owner_id,status,collection_code) VALUES (6,7,1,'c6'),(7,8,1,'c7');
        INSERT INTO sr_bookmark(id,private_user,status,moderation_result,published_at,updated_at) VALUES
          (100,7,'success',0,'2026-01-01T00:00:00Z','2026-01-02T00:00:00Z'),
          (101,7,'success',0,'2026-02-01T00:00:00Z','2026-02-02T00:00:00Z');
        INSERT INTO sr_user_bookmark(user_id,bookmark_id,is_starred,type) VALUES (7,100,true,0),(7,101,true,0);
      `)
      const index = disposableIndex()
      index.stored.set('a:7:100', { id: 'a:7:100', values: axis(0), metadata: { kind: 'article', part_count: 3 } })
      index.stored.set('a:7:100:c:0', { id: 'a:7:100:c:0', values: axis(1), metadata: { kind: 'chunk', part_index: 0 } })
      index.stored.set('a:7:100:c:1', { id: 'a:7:100:c:1', values: axis(2), metadata: { kind: 'chunk', part_index: 1 } })
      index.stored.set('a:7:100:c:2', { id: 'a:7:100:c:2', values: axis(3), metadata: { kind: 'chunk', part_index: 2 } })
      index.stored.set('a:7:101', { id: 'a:7:101', values: axis(4), metadata: { kind: 'article', part_count: 1 } })
      const service = (preferences =>
        preferences.bind(new VectorMaintenanceService(new VectorMaintenanceRepo(() => disposablePrisma(pg)), {} as any, {} as any, index as any, preferences.client)))(
        memoryPreferences()
      )
      const result = await service.refreshCollection(6)
      expect(result).toMatchObject({ state: 'written', target: { kind: 'collection', id: 6 } })
      expect(index.get.mock.calls).toEqual([
        ['article', ['a:7:100', 'a:7:101']],
        ['collection', ['c:6']]
      ])
      expect(index.get.mock.calls[0][1].some(id => id.includes(':c:'))).toBe(false)
      expect(index.get).toHaveBeenCalledTimes(2)
      const values = index.stored.get('c:6')!.values
      expect(values[0]).toBeCloseTo(Math.SQRT1_2, 12)
      expect(values[4]).toBeCloseTo(Math.SQRT1_2, 12)
      expect(values.filter((_value, position) => position !== 0 && position !== 4).every(value => value === 0)).toBe(true)
      expect(index.stored.get('c:6')!.metadata?.published_at).toBe(Date.parse('2026-02-02T00:00:00Z'))
      expect(index.delete).not.toHaveBeenCalled()
    })
  })

  it('updates only expired subscriptions in the disposable database without vector dispatch through the existing cron', async () => {
    await withDisposableDb(async pg => {
      await pg.exec(`
        INSERT INTO sr_user(id) VALUES (7),(8),(9);
        INSERT INTO sr_user_collection(id,owner_id,status,collection_code) VALUES (6,7,1,'c6'),(7,8,1,'c7');
        INSERT INTO sr_user_collection_subscriber(id,user_id,collection_id,is_active,subscription_end_time,updated_at) VALUES
          (1,7,7,true, now() - interval '1 day', now()),
          (2,8,7,true, now() + interval '1 day', now()),
          (3,9,7,false, now() - interval '1 day', now());
      `)
      const repo = new CollectionRepo(() => disposablePrisma(pg))
      const job = new CollectionJob({ recomputeSubscriberActiveStatus: () => repo.recomputeSubscriberActive() } as any)
      const { ctx, create, createBatch } = context()
      await job.recomputeCollectionSubscriberActive(ctx)
      const rows = (await pg.query('SELECT user_id, is_active FROM sr_user_collection_subscriber ORDER BY user_id')).rows
      expect(rows).toEqual([
        { user_id: 7, is_active: false },
        { user_id: 8, is_active: true },
        { user_id: 9, is_active: false }
      ])
      expect(createBatch).not.toHaveBeenCalled()
      expect(create).not.toHaveBeenCalled()
      await job.recomputeCollectionSubscriberActive(ctx)
      expect(createBatch).not.toHaveBeenCalled()
    })
  })

  it('removes an expired subscription from the user Collection preference without touching article preference or Collection vectors', async () => {
    await withDisposableDb(async pg => {
      await pg.exec(`
        INSERT INTO sr_user(id) VALUES (7),(8);
        INSERT INTO sr_user_collection(id,owner_id,status,collection_code) VALUES (6,7,1,'c6'),(7,8,1,'c7');
        INSERT INTO sr_bookmark(id,private_user,status,moderation_result,published_at,updated_at) VALUES
          (100,7,'success',0,now(),now()),
          (101,8,'success',0,now(),now());
        INSERT INTO sr_user_bookmark(user_id,bookmark_id,is_starred,type) VALUES (7,100,true,0),(8,101,true,0);
        INSERT INTO sr_user_collection_subscriber(id,user_id,collection_id,is_active,subscription_end_time,updated_at) VALUES
          (1,7,7,true,now() - interval '1 day',now());
      `)
      const index = disposableIndex()
      index.stored.set('u:7:article', { id: 'u:7:article', namespace: 'user-article', values: axis(0) })
      index.stored.set('u:7:collection', { id: 'u:7:collection', namespace: 'user-collection', values: axis(1) })
      index.stored.set('c:7', { id: 'c:7', values: axis(1), metadata: { kind: 'collection', recommendable: true, published_at: Date.now() } })
      const service = (preferences =>
        preferences.bind(new VectorMaintenanceService(new VectorMaintenanceRepo(() => disposablePrisma(pg)), {} as any, {} as any, index as any, preferences.client)))(
        memoryPreferences()
      )
      expect(await service.readUser(7, 'collection')).toBeNull()
      expect(index.delete).not.toHaveBeenCalled()
      expect(index.get).not.toHaveBeenCalled()
      expect(index.stored.get('u:7:article')?.values).toEqual(axis(0))
      expect(index.stored.get('c:7')?.values).toEqual(axis(1))
      await pg.exec("UPDATE sr_user_collection_subscriber SET subscription_end_time=now() + interval '1 year'")
      expect(await service.readUser(7, 'collection')).toEqual(axis(1))
      expect(index.get).toHaveBeenCalledExactlyOnceWith('collection', ['c:7'])
      expect(index.stored.get('u:7:collection')?.values).toEqual(axis(1))
      expect(index.stored.get('u:7:article')?.values).toEqual(axis(0))
      expect(index.stored.get('c:7')?.values).toEqual(axis(1))
      await pg.exec("UPDATE sr_user_collection_subscriber SET subscription_end_time=now() - interval '1 day'")
      expect(await service.readUser(7, 'collection')).toBeNull()
      expect(index.stored.has('u:7:collection')).toBe(true)
      expect(index.upsert).not.toHaveBeenCalled()
      expect(index.delete).not.toHaveBeenCalled()
      expect(index.stored.get('u:7:article')?.values).toEqual(axis(0))
      expect(index.stored.get('c:7')?.values).toEqual(axis(1))
    })
  })
})
