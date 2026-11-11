import { VectorPreferenceObject } from '@/entry/core/vectorPreferenceObject'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import { ContentRecommendationService } from '@/domain/contentRecommendation'
import { VectorPreferenceClient } from '@/infra/repository/vectorPreferenceClient'
import type { PreferenceCall, PreferenceStore } from '@/utils/preferenceLedger'

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
const counters = { batches: 0, rebuilds: 0, rowReads: 0, articleReads: 0, mutations: 0, subscriptionReads: 0 }
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
  listRecentUserActions: async () => [],
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
  async maintainPreference(store: PreferenceStore, calls: PreferenceCall[]) {
    counters.batches++
    return super.maintainPreference(store, calls)
  }
}

export class FixturePreferenceObject extends VectorPreferenceObject {
  protected async open() {
    return { service: new CountingService(repo as never, {} as never, {} as never, index as never, new VectorPreferenceClient(this.env)), close: async () => {} }
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

  seedLegacy(version = 1) {
    if (version === 2) {
      this.ctx.storage.sql.exec('CREATE TABLE preference_state_v2 (id INTEGER PRIMARY KEY, seq INTEGER NOT NULL)')
      this.ctx.storage.sql.exec('CREATE TABLE preference_entry_v2 (bookmark_id INTEGER PRIMARY KEY, token TEXT NOT NULL)')
      return
    }
    this.ctx.storage.sql.exec('CREATE TABLE preference_state (id INTEGER PRIMARY KEY, seq INTEGER NOT NULL)')
    this.ctx.storage.sql.exec('CREATE TABLE preference_entry (bookmark_id INTEGER PRIMARY KEY, member INTEGER NOT NULL)')
    this.ctx.storage.sql.exec('INSERT INTO preference_state (id, seq) VALUES (1, 1)')
  }

  inspect() {
    const sql = this.ctx.storage.sql
    const tables = sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'preference_%' ORDER BY name").toArray()
    const has = (name: string) => tables.some(table => table.name === name)
    const entries = has('preference_entry_v3')
      ? sql
          .exec<{
            bookmark_id: number
            weight: number
            share_group: number
            token: string
          }>('SELECT bookmark_id, weight, share_group, token FROM preference_entry_v3 ORDER BY bookmark_id')
          .toArray()
      : []
    const state = has('preference_state_v3') ? sql.exec<{ seq: number; raw: ArrayBuffer; counts: string }>('SELECT seq, raw, counts FROM preference_state_v3').toArray() : []
    const plan = has('preference_entry_v3')
      ? sql
          .exec<{ detail: string }>("EXPLAIN QUERY PLAN SELECT published_at FROM preference_entry_v3 WHERE token <> '' AND share_group = ? ORDER BY published_at DESC LIMIT 1", 1)
          .toArray()
          .map(row => row.detail)
          .join(';')
      : ''
    const vector = (id: string) => (stored.has(id) ? Array.from(stored.get(id)!.values) : null)
    return {
      tables: tables.map(table => table.name),
      entries,
      seq: state[0]?.seq ?? null,
      rawBytes: state[0] ? state[0].raw.byteLength : null,
      counts: state[0] ? JSON.parse(state[0].counts) : null,
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
