import core from '@/entry/core'
import { container } from '@/decorators/di'
import { DatabaseRegistry } from '@/di/data'
import { PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import { HybridSearchRepo } from '@/infra/repository/dbHybridSearch'
import { BookmarkSearchRepo } from '@/infra/repository/dbBookmarkSearch'
import { VectorEmbeddingClient } from '@/infra/external/vectorEmbedding'
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'

let activeEnv: Env | undefined
let activeAuditId = ''
const pendingAudits = new Set<Promise<unknown>>()
const unit = (axis = 0) => Array.from({ length: 1024 }, (_, index) => (index === axis ? 1 : 0))

const audit = (event: string, data: Record<string, unknown> = {}, auditId = activeAuditId): Promise<unknown> => {
  const binding = (activeEnv as unknown as { AUDIT?: Fetcher })?.AUDIT
  if (!binding) return Promise.resolve()
  const promise = binding
    .fetch('https://audit/event', { method: 'POST', body: JSON.stringify({ event, auditId, ...data }) })
    .then(() => undefined)
    .catch(() => undefined)
  pendingAudits.add(promise)
  void promise.finally(() => pendingAudits.delete(promise))
  return promise
}

const flushAudits = async () => {
  while (pendingAudits.size) await Promise.allSettled([...pendingAudits])
}

const mode = async (): Promise<string> => {
  const binding = (activeEnv as unknown as { AUDIT?: Fetcher })?.AUDIT
  if (!binding) return 'normal'
  const response = await binding.fetch('https://audit/mode')
  return ((await response.json()) as { mode: string }).mode
}

const articleRow = {
  bookmark_id: 10,
  user_id: 7,
  bookmark_user_uuid: 'own-uuid-10',
  cb_id: 77,
  title: 'Own alias 10',
  target_url: 'https://example.com/10',
  collection_id: null,
  collection_code: null,
  collection_readable: false
}

const repo = {
  titleCandidates: async (_userId: number, _keyword: string, limit: number, candidates?: Array<{ type: string; entity_id: string }>) => {
    if ((await mode()) === 'empty') return []
    const all = [
      { type: 'article', entity_id: '10', matched_title: 'Own alias 10' },
      { type: 'collection', entity_id: '30', matched_title: 'Collection subject' },
      { type: 'rss_feed', entity_id: 'feed-1', matched_title: 'Feed alias' },
      { type: 'rss_entry', entity_id: 'entry-1', matched_title: 'Entry' }
    ]
    const selected = candidates
      ? all.filter(candidate => candidates.some(reference => reference.type === candidate.type && reference.entity_id === candidate.entity_id))
      : all
    return selected.slice(0, limit)
  },
  articles: async (_userId: number, ids: number[]) =>
    ids.includes(10)
      ? [
          articleRow,
          {
            ...articleRow,
            user_id: 8,
            bookmark_user_uuid: 'owner-uuid',
            cb_id: 88,
            title: 'Owner alias 10',
            collection_id: 30,
            collection_code: 'code-30',
            collection_readable: true
          }
        ]
      : [],
  collections: async (_userId: number, ids: number[]) =>
    ids.includes(30) ? [{ collection_id: 30, collection_code: 'code-30', owner_id: 8, title: 'Collection subject' }] : [],
  rssFeeds: async (_userId: number, ids: string[]) => (ids.includes('feed-1') ? [{ feed_id: 'feed-1', subscription_id: 'sub-1', title: 'Feed alias' }] : []),
  rssEntries: async (_userId: number, ids: string[]) =>
    ids.includes('entry-1')
      ? [{ entry_id: 'entry-1', feed_id: 'feed-1', subscription_id: 'sub-1', title: 'Entry', source_title: 'Feed alias', article_url: 'https://example.com/e' }]
      : []
}

const fulltextRepo = {
  searchCandidatePage: async () => {
    const auditId = activeAuditId
    await audit('fulltext_page', {}, auditId)
    if ((await mode()) === 'fulltext_fail') throw new Error('fts unavailable')
    return [{ row_id: 1, bookmark_id: 10, score: 0.5, excerpt: 'indexed excerpt' }]
  }
}

const abortError = () => new DOMException('Aborted', 'AbortError')

const embedding = {
  query: async (_text: string, signal?: AbortSignal) => {
    const auditId = activeAuditId
    await audit('embedding_call', {}, auditId)
    const gate = (activeEnv as unknown as { TEST_GATE?: Fetcher })?.TEST_GATE
    if (gate) {
      const aborted = new Promise<never>((_, reject) => {
        const onAbort = () => {
          void audit('embedding_abort', {}, auditId)
          reject(abortError())
        }
        if (signal?.aborted) onAbort()
        else signal?.addEventListener('abort', onAbort, { once: true })
      })
      await Promise.race([gate.fetch('https://gate/embedding').then(() => undefined), aborted])
    }
    signal?.throwIfAborted()
    return unit()
  }
}

const vectors = {
  queryArticles: async () => {
    await audit('vector_article', {}, activeAuditId)
    return [
      { userId: 8, id: 99, score: 1 },
      { userId: 7, id: 10, score: 0.9 }
    ]
  },
  queryCollections: async () => {
    await audit('vector_collection', {}, activeAuditId)
    return [{ id: 30, score: 0.8 }]
  }
}

container.register(HybridSearchRepo, { useValue: repo })
container.register(BookmarkSearchRepo, { useValue: fulltextRepo })
container.register(VectorEmbeddingClient, { useValue: embedding })
container.register(VectorMaintenanceService, { useValue: vectors })
container.register(DatabaseRegistry, {
  useValue: {
    register(ctx: { env: Env; onCleanup: (callback: () => Promise<void>) => void }, target: { register: (token: unknown, provider: unknown) => void }) {
      const auditId = (ctx.env as unknown as { HYBRID_AUDIT_ID?: string }).HYBRID_AUDIT_ID ?? ''
      target.register(PRISIMA_HYPERDRIVE_CLIENT, { useValue: { $queryRaw: async () => [{ id: 7 }] } })
      ctx.onCleanup(async () => {
        await flushAudits()
        await audit('cleanup', {}, auditId)
      })
    }
  }
})

const tokenizer = {
  idFromName: (name: string) => name,
  get: () => ({
    fetch: async () => Response.json({ data: ['reader'] })
  })
}

const wrapEnv = (env: Env): Env =>
  new Proxy(env, {
    get(target, property, receiver) {
      if (property === 'SLAX_JIEBA') return tokenizer
      if (property === 'HYBRID_AUDIT_ID') return activeAuditId
      return Reflect.get(target, property, receiver)
    }
  }) as Env

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    activeEnv = env
    activeAuditId = request.headers.get('x-hybrid-audit-id') ?? ''
    const url = new URL(request.url)
    // Direct-socket requests carry the loopback host; normalize to the production host so
    // the real generated host router accepts them. This adapter exists only in the test worker.
    const normalized = new Request(`https://api-reader.slax.com${url.pathname}${url.search}`, request)
    let counted = false
    const auditId = activeAuditId
    const markAbort = () => {
      if (counted) return
      counted = true
      void audit('request_abort', {}, auditId)
    }
    request.signal.addEventListener('abort', markAbort, { once: true })
    normalized.signal.addEventListener('abort', markAbort, { once: true })
    return core.fetch(normalized, wrapEnv(env), ctx)
  },
  queue: core.queue,
  scheduled: core.scheduled
}
