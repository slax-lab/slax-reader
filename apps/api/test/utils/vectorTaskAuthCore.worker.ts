import { container } from '@/decorators/di'
import '@/di/generated/dependency'
import core from '@/entry/core'
import { DatabaseRegistry } from '@/di/data'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import { ContentRecommendationService } from '@/domain/contentRecommendation'
import { BookmarkService } from '@/domain/bookmark'
import { CollectionService } from '@/domain/collection'
import { BookmarkOrchestrator } from '@/domain/orchestrator/bookmark'
import { BookmarkAddOrchestrator } from '@/domain/orchestrator/bookmarkAdd'
import { CollectionOrchestrator } from '@/domain/orchestrator/collection'
import { ImportService } from '@/domain/import'
import { SearchService } from '@/domain/search'
import { TagService } from '@/domain/tag'
import { UrlParserHandler } from '@/domain/orchestrator/urlParser'
import { UserDeletionService } from '@/domain/userDeletion'
import { CrawlService } from '@/domain/crawl'
import { LogsService } from '@/domain/logs'
import { memoryPreferences } from '../helpers/preferenceMemory'

const unit = (axis = 0) => Array.from({ length: 1024 }, (_, index) => (index === axis ? 1 : 0))
const counts = { upserts: 0, deletes: 0, embeddings: 0, reads: [] as string[][], users: [] as number[] }
const subscriptions = new Map<number, Set<number>>([
  [7, new Set([201])],
  [8, new Set([201, 202])],
  [9, new Set([203])]
])
const collectionIds: Record<string, number> = { source201: 201, source202: 202, candidate301: 301 }
const stored = new Map<string, VectorizeVector>([
  ['a:8:101', { id: 'a:8:101', values: unit(1) }],
  ['c:201', { id: 'c:201', values: unit(2) }]
])

const repo = {
  findArticles: async (pairs: Array<{ userId: number; id: number }>) =>
    pairs.map(pair => ({
      id: pair.id,
      user_id: pair.userId,
      title: 'Runtime article',
      content_key: '',
      content_md_key: `text/${pair.id}`,
      private_user: 0,
      status: 'success',
      updated_at: new Date('2026-01-01T00:00:00Z'),
      published_at: new Date('2026-01-02T00:00:00Z'),
      recommendable: true
    })),
  findCollection: async (id: number) => ({ id, owner_id: 7, published_at: 1, sharing: true }),
  listUserArticles: async (userId: number) =>
    userId === 8
      ? [
          { id: 101, is_starred: true, share_group: 'none' },
          { id: 102, is_starred: false, share_group: 'none' }
        ]
      : userId === 9
        ? [{ id: 103, is_starred: false, share_group: 'none' }]
        : [],
  listRecentUserActions: async () => [],
  listOwnerCollections: async (userId: number) => (userId === 7 ? [{ id: 81 }] : []),
  listUserCollections: async (userId: number, after: number, limit: number) => {
    counts.users.push(userId)
    return [...(subscriptions.get(userId) ?? [])]
      .sort((a, b) => a - b)
      .filter(id => id > after)
      .slice(0, limit)
      .map(id => ({ id }))
  }
}

const sources = {
  fingerprint: async () => ({}),
  articleInputs: async function* () {
    yield { text: 'Runtime stored article body' }
  },
  pdfInput: async () => null
}

const embedding = {
  embed: async (inputs: unknown[]) => {
    counts.embeddings++
    return inputs.map(() => [{ values: unit(), weight: 1, modality: 'text' }])
  },
  pdf: async function* () {}
}

const index = {
  get: async (_kind: string, ids: string[]) => {
    counts.reads.push([...ids])
    return ids.flatMap(id => (stored.has(id) ? [structuredClone(stored.get(id)!)] : []))
  },
  upsert: async (_kind: string, vectors: VectorizeVector[]) => {
    counts.upserts++
    for (const vector of vectors) stored.set(vector.id, vector)
    return { mutationId: 'runtime-upsert' }
  },
  delete: async (_kind: string, ids: string[]) => {
    counts.deletes++
    for (const id of ids) stored.delete(id)
    return { mutationId: 'runtime-delete' }
  },
  query: async (_kind: string, vector: number[]) => [301, 302, 303].map(id => ({ id: `c:${id}`, score: vector[id === 301 ? 2 : id === 302 ? 3 : 0] }))
}

const service = (preferences => preferences.bind(new VectorMaintenanceService(repo as never, sources as never, embedding as never, index as never, preferences.client)))(
  memoryPreferences()
)
const prisma = { $queryRaw: async () => [{ id: 7 }] }

for (const dependency of [
  BookmarkService,
  CollectionService,
  BookmarkOrchestrator,
  BookmarkAddOrchestrator,
  CollectionOrchestrator,
  ImportService,
  SearchService,
  TagService,
  UrlParserHandler,
  UserDeletionService,
  CrawlService,
  LogsService
])
  container.register(dependency, { useValue: {} })

container.register(VectorMaintenanceService, { useValue: service })
const recommendationRepo = {
  getCollectionCandidates: async (ids: number[], userId: number) =>
    ids.filter(id => !subscriptions.get(userId)?.has(id)).map(id => ({ id, collection_code: `candidate${id}`, display_name: `Collection ${id}`, description: '' })),
  getRecentMembers: async (ids: number[]) =>
    ids.map(id => ({ id, user_id: 20, uuid: `article-${id}`, title: 'Preview', target_url: `https://example.invalid/${id}`, collection_id: id }))
}
container.register(ContentRecommendationService, { useValue: new ContentRecommendationService(recommendationRepo as never, service) })
container.register(CollectionOrchestrator, {
  useValue: {
    subscribeUserCollection: async (ctx: { getUserId(): number }, code: string) => {
      const userId = ctx.getUserId()
      if (!subscriptions.has(userId)) subscriptions.set(userId, new Set())
      subscriptions.get(userId)!.add(collectionIds[code])
      return { subscribe: true }
    },
    unsubscribeUserCollection: async (ctx: { getUserId(): number }, code: string) => {
      subscriptions.get(ctx.getUserId())?.delete(collectionIds[code])
    }
  }
})
container.register(CollectionService, {
  useValue: {
    deleteUserCollectionSubscribe: async (ctx: { getUserId(): number }, code: string) => {
      subscriptions.get(ctx.getUserId())?.delete(collectionIds[code])
    },
    getUserCollectionSubscribed: async (ctx: { getUserId(): number }, code: string) => ({
      subscribed: subscriptions.get(ctx.getUserId())?.has(collectionIds[code]) ?? false,
      deleted: false
    })
  }
})

container.register(DatabaseRegistry, {
  useValue: {
    register(_ctx: unknown, target: { register: (token: unknown, provider: unknown) => void }) {
      target.register(PRISIMA_HYPERDRIVE_CLIENT, { useValue: prisma })
    }
  }
})

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    if (new URL(request.url).pathname === '/__fixture') {
      const body = await request.json<{ op: string; id?: number; axis?: number }>()
      if (body.op === 'seed') {
        subscriptions.set(7, new Set([201]))
        for (const [id, axis] of [
          [201, 2],
          [202, 3],
          [301, 2],
          [302, 3],
          [303, 0]
        ])
          stored.set(`c:${id}`, { id: `c:${id}`, values: unit(axis) })
        stored.set('u:7:collection', { id: 'u:7:collection', namespace: 'user-collection', values: unit(0) })
      } else if (body.op === 'source') {
        if (body.axis === undefined) stored.delete(`c:${body.id}`)
        else stored.set(`c:${body.id}`, { id: `c:${body.id}`, values: unit(body.axis) })
      }
      if (body.op !== 'stats') {
        counts.upserts = counts.deletes = counts.embeddings = 0
        counts.reads = []
        counts.users = []
      }
      return Response.json({ ...counts, legacy: stored.has('u:7:collection') })
    }
    return core.fetch(request, env, ctx)
  }
}
