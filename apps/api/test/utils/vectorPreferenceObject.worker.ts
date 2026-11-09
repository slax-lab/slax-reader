import { VectorPreferenceObject } from '@/entry/core/vectorPreferenceObject'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import { VectorPreferenceClient } from '@/infra/repository/vectorPreferenceClient'
import type { PreferenceCall, PreferenceStore } from '@/utils/preferenceLedger'

// Fixture data boundaries live in the object's isolate. Storage, RPC delivery, the queue and the
// maintenance engine are the real implementations.
const unit = (axis: number) => Array.from({ length: 1024 }, (_, index) => (index === axis ? 1 : 0.01 * ((index * 7 + axis) % 5)))
const articles = new Map<number, { starred: boolean; member: boolean }>()
const stored = new Map<string, VectorizeVector>()
const counters = { batches: 0, rebuilds: 0, rowReads: 0 }
const wait = () => new Promise(resolve => setTimeout(resolve, 25))
const after = <T extends { id: number }>(rows: T[], cursor: number, limit: number) => rows.filter(row => row.id > cursor).slice(0, limit)

const repo = {
  findUserPreferenceRows: async (_userId: number, ids: number[]) => {
    counters.rowReads++
    await wait()
    return ids.filter(id => articles.has(id)).map(id => ({ id, is_starred: articles.get(id)!.starred, member: articles.get(id)!.member }))
  },
  listUserArticles: async (_userId: number, cursor: number, limit: number) => {
    counters.rebuilds++
    return after(
      [...articles].map(([id, row]) => ({ id, is_starred: row.starred })).sort((a, b) => a.id - b.id),
      cursor,
      limit
    )
  },
  listCollectionMembers: async (_userId: number, cursor: number, limit: number) =>
    after(
      [...articles].filter(([, row]) => row.member).map(([id]) => ({ id })),
      cursor,
      limit
    ),
  listRecentUserActions: async () => [],
  listOwnerCollections: async () => [{ id: 201 }],
  findCollection: async (id: number) => (id === 201 ? { id, owner_id: 8, published_at: 1 } : undefined)
}

const index = {
  get: async (_kind: string, ids: string[]) => ids.flatMap(id => (stored.has(id) ? [structuredClone(stored.get(id)!)] : [])),
  upsert: async (_kind: string, vectors: VectorizeVector[]) => {
    for (const vector of vectors) stored.set(vector.id, structuredClone(vector))
    return { mutationId: 'fixture-upsert' }
  },
  delete: async (_kind: string, ids: string[]) => {
    for (const id of ids) stored.delete(id)
    return { mutationId: 'fixture-delete' }
  },
  query: async () => []
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

  setArticle(id: number, starred: boolean, member: boolean, axis: number) {
    articles.set(id, { starred, member })
    stored.set(`a:8:${id}`, { id: `a:8:${id}`, values: unit(axis) })
  }

  deleteArticle(id: number) {
    const previous = stored.get(`a:8:${id}`)?.values
    articles.delete(id)
    stored.delete(`a:8:${id}`)
    return previous ? Array.from(previous) : undefined
  }

  inspect() {
    const tables = this.ctx.storage.sql.exec<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'preference_%' ORDER BY name").toArray()
    const entries = tables.some(table => table.name === 'preference_entry')
      ? this.ctx.storage.sql
          .exec<{ bookmark_id: number; weight: number; member: number; token: string }>('SELECT bookmark_id, weight, member, token FROM preference_entry ORDER BY bookmark_id')
          .toArray()
      : []
    const state = tables.some(table => table.name === 'preference_state')
      ? this.ctx.storage.sql.exec<{ seq: number; raw: ArrayBuffer }>('SELECT seq, raw FROM preference_state').toArray()
      : []
    const vector = (id: string) => (stored.has(id) ? Array.from(stored.get(id)!.values) : null)
    return {
      tables: tables.map(table => table.name),
      entries,
      seq: state[0]?.seq ?? null,
      rawBytes: state[0] ? state[0].raw.byteLength : null,
      user: vector('u:8:article'),
      userVersion: stored.get('u:8:article')?.metadata?.state_version ?? null,
      collection: vector('c:201'),
      counters: { ...counters }
    }
  }
}

type Fixture = { setArticle(...args: unknown[]): Promise<void>; deleteArticle(id: number): Promise<number[] | undefined>; inspect(): Promise<unknown> }

export default {
  async fetch(request: Request, env: Env) {
    const client = new VectorPreferenceClient(env)
    const fixture = env.VECTOR_V5_PREFERENCE!.get(env.VECTOR_V5_PREFERENCE!.idFromName('8')) as unknown as Fixture
    const body = (await request.json()) as { op: string; [key: string]: any }
    const result =
      body.op === 'set'
        ? await fixture.setArticle(body.id, body.starred, body.member, body.axis)
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
