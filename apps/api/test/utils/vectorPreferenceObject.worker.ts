import { VectorPreferenceObject } from '@/entry/core/vectorPreferenceObject'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import { ContentRecommendationService } from '@/domain/contentRecommendation'
import { VectorPreferenceClient } from '@/infra/repository/vectorPreferenceClient'
import { VectorPreferenceStores } from '@/infra/repository/vectorPreferenceStore'
import type { LocalPreference, PreferenceCall, PreferenceStore } from '@/utils/preferenceLedger'

// Fixture data boundaries live in the object's isolate. Storage, RPC delivery, the queue and the
// maintenance engine are the real implementations.
const unit = (axis: number) => Array.from({ length: 1024 }, (_, index) => (index === axis ? 1 : 0.01 * ((index * 7 + axis) % 5)))
type Group = 'none' | 'shared' | 'inherited'
const articles = new Map<number, { starred: boolean; group: Group }>()
const stored = new Map<string, VectorizeVector>(
  [
    [301, 12],
    [302, 14]
  ].map(([id, axis]) => [`c:${id}`, { id: `c:${id}`, values: unit(axis) }])
)
let subscribed = true
const counters = { batches: 0, rebuilds: 0, rowReads: 0, articleReads: 0, mutations: 0, subscriptionReads: 0, recentReads: 0, actionReads: 0 }
const recentRead = new Set<string>()
const owner = { sharing: true, active: true }
const wait = () => new Promise(resolve => setTimeout(resolve, 25))
const after = <T extends { id: number }>(rows: T[], cursor: number, limit: number) => rows.filter(row => row.id > cursor).slice(0, limit)

const repo = {
  isUserActive: async () => true,
  findUserPreferenceRows: async (_userId: number, ids: number[]) => {
    counters.rowReads++
    await wait()
    return ids.filter(id => articles.has(id)).map(id => ({ id, is_starred: articles.get(id)!.starred, share_group: articles.get(id)!.group }))
  },
  listUserArticles: async (_userId: number, cursor: number, limit: number) => {
    counters.rebuilds++
    return after(
      [...articles].map(([id, row]) => ({ id, is_starred: row.starred, share_group: row.group })).sort((a, b) => a.id - b.id),
      cursor,
      limit
    )
  },
  listRecentUserActions: async () => {
    counters.actionReads++
    return []
  },
  listUserCollections: async (userId: number, cursor: number) => {
    counters.subscriptionReads++
    const members = [...articles.values()].some(row => row.group === 'shared' || (row.group === 'inherited' && owner.sharing))
    return userId === 9 && subscribed && owner.active && members && cursor < 201 ? [{ id: 201 }] : []
  },
  listOwnerCollections: async () => [{ id: 201 }],
  findCollection: async (id: number) => (id === 201 && owner.active ? { id, owner_id: 8, published_at: 1, sharing: owner.sharing } : undefined)
}

const index = {
  get: async (kind: string, ids: string[]) => {
    if (kind === 'article') counters.articleReads++
    if (kind === 'article' && ids.some(id => recentRead.has(id))) counters.recentReads++
    return ids.flatMap(id => (stored.has(id) ? [structuredClone(stored.get(id)!)] : []))
  },
  upsert: async (_kind: string, vectors: VectorizeVector[]) => {
    counters.mutations++
    for (const vector of vectors) stored.set(vector.id, structuredClone(vector))
    return { mutationId: 'fixture-upsert' }
  },
  delete: async (_kind: string, ids: string[]) => {
    counters.mutations++
    for (const id of ids) stored.delete(id)
    return { mutationId: 'fixture-delete' }
  },
  query: async () => [301, 302].map(id => ({ id: `c:${id}`, score: 1 }))
}

class CountingService extends VectorMaintenanceService {
  async maintainPreference(store: PreferenceStore, calls: PreferenceCall[], legacy?: LocalPreference | null) {
    counters.batches++
    return super.maintainPreference(store, calls, legacy)
  }
}

export class FixturePreferenceObject extends VectorPreferenceObject {
  protected async open() {
    return {
      service: new CountingService(repo as never, {} as never, {} as never, index as never, new VectorPreferenceClient(this.env)),
      stores: new VectorPreferenceStores(this.env),
      close: async () => {}
    }
  }

  setArticle(id: number, starred: boolean, group: Group, axis: number, vector = true) {
    const previous = stored.get(`a:8:${id}`)?.values
    articles.set(id, { starred, group })
    if (vector) stored.set(`a:8:${id}`, { id: `a:8:${id}`, values: unit(axis) })
    else stored.delete(`a:8:${id}`)
    return previous ? Array.from(previous) : undefined
  }

  setOwner(sharing: boolean, active: boolean) {
    owner.sharing = sharing
    owner.active = active
  }

  deleteArticle(id: number) {
    const previous = stored.get(`a:8:${id}`)?.values
    articles.delete(id)
    stored.delete(`a:8:${id}`)
    return previous ? Array.from(previous) : undefined
  }

  async readSubscriber() {
    const before = { ...counters }
    const { service } = await this.open()
    const preference = await service.readCollectionPreference(9)
    const recommendations = await new ContentRecommendationService(
      {
        getCollectionCandidates: async (ids: number[]) => ids.map(id => ({ id, collection_code: `candidate${id}`, display_name: `Candidate ${id}`, description: '' })),
        getRecentMembers: async (ids: number[]) =>
          ids.map(id => ({ id, user_id: 20, uuid: `article-${id}`, title: 'Preview', target_url: `https://example.invalid/${id}`, collection_id: id }))
      } as never,
      service
    ).collections(9, 'collection', 1)
    return { preference, recommendations, before, after: { ...counters }, materialized: stored.has('u:9:collection') }
  }

  setSubscription(value: boolean) {
    subscribed = value
  }

  async seedLegacy(version = 1) {
    const sql = this.ctx.storage.sql
    if (version === 1) {
      sql.exec('CREATE TABLE preference_state (id INTEGER PRIMARY KEY, seq INTEGER NOT NULL)')
      sql.exec('CREATE TABLE preference_entry (bookmark_id INTEGER PRIMARY KEY, member INTEGER NOT NULL)')
      sql.exec('INSERT INTO preference_state (id, seq) VALUES (1, 1)')
      return
    }
    const db = this.env.DB
    const state = await db.prepare('SELECT * FROM slax_vector_preference_state WHERE user_id = 8').first<Record<string, any>>()
    const entries = (await db.prepare('SELECT * FROM slax_vector_preference_entry WHERE user_id = 8').all<Record<string, any>>()).results
    if (!state) throw new Error('legacy seed requires D1 state')
    const v3 = version === 3
    sql.exec(
      `CREATE TABLE preference_state_v${version} (id INTEGER PRIMARY KEY, seq INTEGER NOT NULL, mean_version TEXT NOT NULL, raw BLOB NOT NULL, centered BLOB NOT NULL, shared BLOB NOT NULL, inherited BLOB NOT NULL, counts TEXT NOT NULL, interests TEXT NOT NULL)`
    )
    sql.exec(
      v3
        ? 'CREATE TABLE preference_entry_v3 (bookmark_id INTEGER PRIMARY KEY, weight INTEGER NOT NULL, share_group INTEGER NOT NULL, token TEXT NOT NULL, contribution BLOB NOT NULL, published_at REAL NOT NULL, actions TEXT NOT NULL, acted_at REAL NOT NULL)'
        : 'CREATE TABLE preference_entry_v2 (bookmark_id INTEGER PRIMARY KEY, weight INTEGER NOT NULL, share_group INTEGER NOT NULL, token TEXT NOT NULL)'
    )
    const buffer = (value: any) => (value ? new Uint8Array(value).buffer : new ArrayBuffer(0))
    sql.exec(
      `INSERT INTO preference_state_v${version} VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)`,
      state.seq,
      state.mean_version,
      buffer(state.raw),
      buffer(state.centered),
      buffer(state.shared),
      buffer(state.inherited),
      state.counts,
      state.interests
    )
    for (const row of entries)
      if (v3)
        sql.exec(
          'INSERT INTO preference_entry_v3 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          row.bookmark_id,
          row.weight,
          row.share_group,
          row.token,
          new ArrayBuffer(8192),
          row.published_at,
          '[]',
          0
        )
      else sql.exec('INSERT INTO preference_entry_v2 VALUES (?, ?, ?, ?)', row.bookmark_id, row.weight, row.share_group, row.token)
    await db.batch([db.prepare('DELETE FROM slax_vector_preference_state WHERE user_id = 8'), db.prepare('DELETE FROM slax_vector_preference_entry WHERE user_id = 8')])
  }

  async inspect() {
    const tables = this.ctx.storage.sql
      .exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'preference_%' ORDER BY name")
      .toArray()
      .map(table => table.name)
    const db = this.env.DB
    const entries = (
      await db
        .prepare('SELECT bookmark_id, weight, share_group, token FROM slax_vector_preference_entry WHERE user_id = 8 ORDER BY bookmark_id')
        .all<{ bookmark_id: number; weight: number; share_group: number; token: string }>()
    ).results
    const state = await db
      .prepare('SELECT seq, raw, counts FROM slax_vector_preference_state WHERE user_id = 8')
      .first<{ seq: number; raw: number[] | ArrayBuffer; counts: string }>()
    const plan = (
      await db
        .prepare(
          "EXPLAIN QUERY PLAN SELECT published_at FROM slax_vector_preference_entry WHERE user_id = ? AND share_group = ? AND token <> '' ORDER BY published_at DESC LIMIT 1"
        )
        .bind(8, 1)
        .all<{ detail: string }>()
    ).results
      .map(row => row.detail)
      .join(';')
    const vector = (id: string) => (stored.has(id) ? Array.from(stored.get(id)!.values) : null)
    const raw = state?.raw as any
    return {
      tables,
      doBytes: this.ctx.storage.sql.databaseSize,
      entries,
      seq: state?.seq ?? null,
      rawBytes: raw ? (raw.byteLength ?? raw.length) : null,
      counts: state ? JSON.parse(state.counts) : null,
      plan,
      user: vector('u:8:article'),
      userVersion: stored.get('u:8:article')?.metadata?.state_version ?? null,
      collection: vector('c:201'),
      counters: { ...counters }
    }
  }
}

type Fixture = {
  setArticle(...args: unknown[]): Promise<void>
  setOwner(sharing: boolean, active: boolean): Promise<void>
  deleteArticle(id: number): Promise<number[] | undefined>
  seedLegacy(version?: number): Promise<void>
  readSubscriber(): Promise<unknown>
  setSubscription(value: boolean): Promise<void>
  inspect(): Promise<unknown>
}

export default {
  async fetch(request: Request, env: Env) {
    const client = new VectorPreferenceClient(env)
    const fixture = env.VECTOR_V5_PREFERENCE!.get(env.VECTOR_V5_PREFERENCE!.idFromName('8')) as unknown as Fixture
    const body = (await request.json()) as { op: string; [key: string]: any }
    if (body.op === 'subscriber') return Response.json(await fixture.readSubscriber())
    if (body.op === 'subscribe') {
      await fixture.setSubscription(body.value)
      return Response.json(null)
    }
    const result =
      body.op === 'set'
        ? await fixture.setArticle(body.id, body.starred, body.group, body.axis, body.vector ?? true)
        : body.op === 'owner'
          ? await fixture.setOwner(body.sharing, body.active)
          : body.op === 'legacy'
            ? await fixture.seedLegacy(body.version)
            : body.op === 'publish'
              ? await client.publish(8, { user: false, collections: [201] })
              : body.op === 'delete'
                ? await fixture.deleteArticle(body.id)
                : body.op === 'apply'
                  ? await client.apply(8, body.id, body.previous)
                  : body.op === 'burst'
                    ? await Promise.all((body.ids as number[]).map(id => client.apply(8, id)))
                    : body.op === 'rebuild'
                      ? await client.rebuild(8, { user: true, collections: 'all' })
                      : await fixture.inspect()
    return Response.json(result ?? null)
  }
}
