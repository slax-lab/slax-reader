import { container } from '@/decorators/di'
import '@/di/generated/dependency'
import core from '@/entry/core'
import { DatabaseRegistry } from '@/di/data'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
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

const unit = (axis = 0) => Array.from({ length: 1024 }, (_, index) => (index === axis ? 1 : 0))
const stored = new Map<string, VectorizeVector>()

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
  findCollection: async (id: number) => ({ id, owner_id: 7, published_at: 1 }),
  listUserArticles: async () => [],
  listRecentUserActions: async () => [],
  listCollectionMembers: async () => [],
  listUserCollections: async () => []
}

const sources = {
  fingerprint: async () => ({}),
  articleInputs: async function* () {
    yield { text: 'Runtime stored article body' }
  },
  pdfInput: async () => null
}

const embedding = {
  embed: async (inputs: unknown[]) => inputs.map(() => [{ values: unit(), weight: 1, modality: 'text' }]),
  pdf: async function* () {}
}

const index = {
  get: async (_kind: string, ids: string[]) => ids.flatMap(id => (stored.has(id) ? [stored.get(id)!] : [])),
  upsert: async (_kind: string, vectors: VectorizeVector[]) => {
    for (const vector of vectors) stored.set(vector.id, vector)
    return { mutationId: 'runtime-upsert' }
  },
  delete: async (_kind: string, ids: string[]) => {
    for (const id of ids) stored.delete(id)
    return { mutationId: 'runtime-delete' }
  },
  query: async () => []
}

const service = new VectorMaintenanceService(repo as never, sources as never, embedding as never, index as never)
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
container.register(DatabaseRegistry, {
  useValue: {
    register(_ctx: unknown, target: { register: (token: unknown, provider: unknown) => void }) {
      target.register(PRISIMA_HYPERDRIVE_CLIENT, { useValue: prisma })
    }
  }
})

export default core
