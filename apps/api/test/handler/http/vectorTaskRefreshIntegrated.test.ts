import { beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class {
    protected env: Env
    constructor(_ctx: unknown, env: Env) {
      this.env = env
    }
  },
  DurableObject: class {},
  WorkflowEntrypoint: class {}
}))
vi.mock('cloudflare:workflows', () => ({ NonRetryableError: class extends Error {} }))
vi.mock('agents/mcp', () => ({ McpAgent: class {} }))
vi.mock('@/utils/activeUser', () => ({ requireActiveUser: vi.fn(async () => undefined) }))

import { container } from '@/decorators/di'
import '@/di/generated/dependency'
import core from '@/entry/core'
import edge from '@/entry/edge'
import { Auth } from '@/utils/jwt'
import { Hashid } from '@/utils/hashids'
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
import { VectorMaintenanceService } from '@/domain/vectorMaintenance'
import { EDGE_IDENTITY_HEADER, EDGE_SECRET_HEADER, encodeEdgeIdentity } from '@/const/edge'
import { memoryPreferenceStates } from '../../helpers/preferenceStateMemory'

const SECRET = 'temporary-task-secret-7d2a'
const OTHER_SECRET = 'different-task-secret-3c9e'
const EDGE_SHARED_SECRET = 'edge-shared-secret'
const USER = 7
const unit = (axis = 0) => Array.from({ length: 1024 }, (_, index) => (index === axis ? 1 : 0))

const articleRow = {
  id: 41,
  user_id: USER,
  title: 'Stored article',
  content_key: '',
  content_md_key: 'text/41',
  private_user: 0,
  status: 'success',
  updated_at: new Date('2026-01-01T00:00:00Z'),
  published_at: new Date('2026-01-02T00:00:00Z'),
  recommendable: true
}

function boundary() {
  const stored = new Map<string, VectorizeVector>()
  const repo = {
    findArticles: vi.fn(async (_pairs: unknown[]) => [] as unknown[]),
    findCollection: vi.fn(async (_id: number) => undefined as { id: number; owner_id: number; published_at: number } | undefined),
    listUserArticles: vi.fn(async () => [] as { id: number; is_starred: boolean }[]),
    listRecentUserActions: vi.fn(async () => [] as { id: number; acted_at: Date }[]),
    listCollectionMembers: vi.fn(async () => [] as { id: number }[]),
    listUserCollections: vi.fn(async () => [] as { id: number }[])
  }
  const sources = {
    fingerprint: vi.fn(async () => ({}) as Record<string, unknown>),
    articleInputs: vi.fn(async function* () {
      yield { text: 'Stored article body' }
    }),
    pdfInput: vi.fn(async () => null)
  }
  const embedding = {
    embed: vi.fn(async (inputs: unknown[]) => inputs.map(() => [{ values: unit(), weight: 1, modality: 'text' }])),
    pdf: vi.fn(async function* () {})
  }
  const index = {
    stored,
    get: vi.fn(async (_kind: string, ids: string[]) => ids.flatMap(id => (stored.has(id) ? [stored.get(id)!] : []))),
    upsert: vi.fn(async (kind: string, vectors: VectorizeVector[]) => {
      for (const vector of vectors) stored.set(vector.id, vector)
      return { mutationId: `upsert-${kind}` }
    }),
    delete: vi.fn(async (kind: string, ids: string[]) => {
      for (const id of ids) stored.delete(id)
      return { mutationId: `delete-${kind}` }
    }),
    query: vi.fn(async () => [])
  }
  const service = new VectorMaintenanceService(repo as never, sources as never, embedding as never, index as never, memoryPreferenceStates())
  return { repo, sources, embedding, index, service, stored }
}

let current: ReturnType<typeof boundary>
let coreEnv: Env
let edgeEnv: Env

function execution() {
  const pending: Promise<unknown>[] = []
  const ctx = {
    waitUntil: vi.fn((work: Promise<unknown>) => pending.push(work)),
    passThroughOnException: vi.fn()
  } as unknown as ExecutionContext
  return { ctx, pending }
}

function coreRequest(path: string, body: unknown, headers: Record<string, string> = {}) {
  return new Request(`https://api-reader.slax.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body)
  })
}

const task = (secret = SECRET) => ({ 'X-Vector-Refresh-Secret': secret })

beforeAll(() => {
  container.register(BookmarkService, { useValue: {} })
  container.register(CollectionService, { useValue: {} })
  container.register(BookmarkOrchestrator, { useValue: {} })
  container.register(BookmarkAddOrchestrator, { useValue: {} })
  container.register(CollectionOrchestrator, { useValue: {} })
  container.register(ImportService, { useValue: {} })
  container.register(SearchService, { useValue: {} })
  container.register(TagService, { useValue: {} })
  container.register(UrlParserHandler, { useValue: {} })
  container.register(UserDeletionService, { useValue: {} })
  container.register(CrawlService, { useValue: {} })
  container.register(LogsService, { useValue: {} })
})

beforeEach(() => {
  current = boundary()
  container.register(VectorMaintenanceService, { useValue: current.service })
  coreEnv = {
    VECTOR_REFRESH_SECRET: SECRET,
    EDGE_SHARED_SECRET: EDGE_SHARED_SECRET,
    FRONT_END_URL: 'http://localhost:3000',
    HASH_IDS_SALT: 'test-salt',
    JWT_SECRET_TEXT: 'test-secret-32-bytes-minimum-long-string',
    JWT_ALGORITHMS: 'HS256',
    JWT_ISSUER: 'test',
    JWT_EXPIRES: '3600',
    RUN_ENV: 'test'
  } as unknown as Env
  // The task secret belongs to Core and the caller only; Edge must work without it.
  edgeEnv = {
    EDGE_SHARED_SECRET: EDGE_SHARED_SECRET,
    FRONT_END_URL: 'http://localhost:3000',
    HASH_IDS_SALT: 'test-salt',
    JWT_SECRET_TEXT: 'test-secret-32-bytes-minimum-long-string',
    JWT_ALGORITHMS: 'HS256',
    JWT_ISSUER: 'test',
    JWT_EXPIRES: '3600',
    RUN_ENV: 'test'
  } as unknown as Env
})

async function atCore(path: string, body: unknown, headers: Record<string, string> = {}) {
  const request = coreRequest(path, body, headers)
  const { ctx, pending } = execution()
  const response = await core.fetch(request, coreEnv, ctx)
  await Promise.all(pending)
  return { request, response, ctx }
}

async function throughEdge(path: string, body: unknown, headers: Record<string, string> = {}) {
  const coreFetch = vi.fn((request: Request) => core.fetch(request, coreEnv, execution().ctx))
  edgeEnv = { ...edgeEnv, CORE: { fetch: coreFetch } } as unknown as Env
  const { ctx, pending } = execution()
  const response = await edge.fetch(coreRequest(path, body, headers), edgeEnv, ctx)
  await Promise.all(pending)
  return { response, coreFetch, forwarded: coreFetch.mock.calls[0]?.[0] as Request | undefined }
}

function assertUntouched() {
  expect(current.repo.findArticles).not.toHaveBeenCalled()
  expect(current.repo.findCollection).not.toHaveBeenCalled()
  expect(current.repo.listUserArticles).not.toHaveBeenCalled()
  expect(current.repo.listCollectionMembers).not.toHaveBeenCalled()
  expect(current.repo.listUserCollections).not.toHaveBeenCalled()
  expect(current.sources.fingerprint).not.toHaveBeenCalled()
  expect(current.sources.articleInputs).not.toHaveBeenCalled()
  expect(current.embedding.embed).not.toHaveBeenCalled()
  expect(current.index.get).not.toHaveBeenCalled()
  expect(current.index.upsert).not.toHaveBeenCalled()
  expect(current.index.delete).not.toHaveBeenCalled()
}

describe('direct Core task routes through the generated router', () => {
  test('the bookmark action writes only the requested private article from repository and model fixtures', async () => {
    current.repo.findArticles.mockResolvedValue([articleRow])
    const { request, response } = await atCore('/v1/bookmark/vector/refresh', { user_id: USER, bookmark_id: 41 }, task())
    const body = (await response.json()) as { code: number; data: { state: string; target: unknown } }
    expect(body).toMatchObject({ code: 200, data: { state: 'written', target: { kind: 'article', userId: USER, id: 41 } } })
    expect(request.bodyUsed).toBe(true)
    expect(current.repo.findArticles).toHaveBeenCalledExactlyOnceWith([{ userId: USER, id: 41 }])
    expect(current.sources.fingerprint).toHaveBeenCalledOnce()
    expect(current.embedding.embed).toHaveBeenCalledOnce()
    expect(current.index.upsert).toHaveBeenCalledOnce()
    expect(current.index.upsert.mock.calls[0][0]).toBe('article')
    expect([...current.stored.keys()]).toEqual(['a:7:41'])
    expect(current.index.delete).not.toHaveBeenCalled()
    expect(current.repo.listUserArticles).not.toHaveBeenCalled()
    expect(current.repo.listCollectionMembers).not.toHaveBeenCalled()
  })

  test('the article-preference action reads existing vectors only and clears a stale empty preference', async () => {
    current.stored.set('u:7:article', { id: 'u:7:article', namespace: 'user-article', values: unit() })
    current.stored.set('u:7:article:centered', { id: 'u:7:article:centered', namespace: 'user-article', values: unit(1) })
    current.stored.set('u:7:collection', { id: 'u:7:collection', namespace: 'user-collection', values: unit(2) })
    const { response } = await atCore('/v1/bookmark/preference/refresh', { user_id: USER }, task())
    const body = (await response.json()) as { code: number; data: { state: string; target: unknown } }
    expect(body).toMatchObject({ code: 200, data: { state: 'deleted', target: { kind: 'user', id: USER, preference: 'article' } } })
    expect(current.repo.listUserArticles).toHaveBeenCalled()
    expect(current.repo.findArticles).not.toHaveBeenCalled()
    expect(current.embedding.embed).not.toHaveBeenCalled()
    expect(current.index.upsert).not.toHaveBeenCalled()
    expect([...current.stored.keys()]).toEqual(['u:7:collection'])
    expect(current.index.delete.mock.calls.map(([kind, ids]) => [kind, ids])).toEqual([['user', ['u:7:article', 'u:7:article:centered']]])
  })

  test('the Collection action aggregates only its own representation and clears an empty one', async () => {
    current.repo.findCollection.mockResolvedValue({ id: 81, owner_id: USER, published_at: 1 })
    current.stored.set('c:81', { id: 'c:81', values: unit() })
    const { response } = await atCore('/v1/collection/vector/refresh', { collection_id: 81 }, task())
    const body = (await response.json()) as { code: number; data: { state: string; target: unknown } }
    expect(body).toMatchObject({ code: 200, data: { state: 'deleted', target: { kind: 'collection', id: 81 } } })
    expect(current.repo.findCollection).toHaveBeenCalledExactlyOnceWith(81)
    expect(current.repo.listCollectionMembers).toHaveBeenCalledExactlyOnceWith(USER, 0, 100)
    expect(current.repo.findArticles).not.toHaveBeenCalled()
    expect(current.repo.listUserArticles).not.toHaveBeenCalled()
    expect(current.embedding.embed).not.toHaveBeenCalled()
    expect(current.index.upsert).not.toHaveBeenCalled()
    expect(current.stored.has('c:81')).toBe(false)
  })

  test('the Collection-preference action touches only that user collection preference', async () => {
    current.stored.set('u:7:article', { id: 'u:7:article', namespace: 'user-article', values: unit() })
    current.stored.set('u:7:collection', { id: 'u:7:collection', namespace: 'user-collection', values: unit() })
    const { response } = await atCore('/v1/collection/preference/refresh', { user_id: USER }, task())
    const body = (await response.json()) as { code: number; data: { state: string; target: unknown } }
    expect(body).toMatchObject({ code: 200, data: { state: 'deleted', target: { kind: 'user', id: USER, preference: 'collection' } } })
    expect(current.repo.listUserCollections).toHaveBeenCalled()
    expect(current.repo.listUserArticles).not.toHaveBeenCalled()
    expect(current.repo.findArticles).not.toHaveBeenCalled()
    expect(current.index.delete.mock.calls.map(([kind, ids]) => [kind, ids])).toEqual([['user', ['u:7:collection']]])
    expect([...current.stored.keys()]).toEqual(['u:7:article'])
  })

  test.each([
    ['missing header', {}],
    ['wrong header', task(OTHER_SECRET)],
    ['empty header', { 'X-Vector-Refresh-Secret': '' }],
    ['whitespace header', { 'X-Vector-Refresh-Secret': '   ' }]
  ])('%s denies before body processing, repository reads and maintenance', async (_label, headers) => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      const { request, response } = await atCore('/v1/bookmark/vector/refresh', { user_id: USER, bookmark_id: 41 }, headers as Record<string, string>)
      expect(response.status).toBe(401)
      expect(request.bodyUsed).toBe(false)
      assertUntouched()
      expect(JSON.stringify(log.mock.calls)).not.toContain(SECRET)
      expect(JSON.stringify(error.mock.calls)).not.toContain(SECRET)
    } finally {
      log.mockRestore()
      error.mockRestore()
    }
  })

  test('a valid Reader JWT without the task header cannot replace the secret', async () => {
    const token = await new Auth(coreEnv).sign({ id: String(new Hashid(coreEnv).encodeId(USER)), email: 'reader@example.com', lang: 'en' })
    const log = vi.spyOn(console, 'log').mockImplementation(() => {})
    try {
      const { request, response } = await atCore('/v1/bookmark/vector/refresh', { user_id: USER, bookmark_id: 41 }, { Authorization: `Bearer ${token}` })
      expect(response.status).toBe(401)
      expect(request.bodyUsed).toBe(false)
      expect(JSON.stringify(log.mock.calls)).not.toContain(token)
      assertUntouched()
    } finally {
      log.mockRestore()
    }
  })

  test('an API key alone cannot invoke a task route', async () => {
    const { response } = await atCore('/v1/bookmark/vector/refresh', { user_id: USER, bookmark_id: 41 }, { 'X-API-Key': 'reader-api-key' })
    expect(await response.json()).toMatchObject({ code: 403 })
    assertUntouched()
  })

  test('forwarded Edge identity headers cannot replace the task secret', async () => {
    const { request, response } = await atCore(
      '/v1/bookmark/vector/refresh',
      { user_id: USER, bookmark_id: 41 },
      {
        [EDGE_SECRET_HEADER]: EDGE_SHARED_SECRET,
        [EDGE_IDENTITY_HEADER]: encodeEdgeIdentity({ deId: USER, enId: 10000007, email: 'reader@example.com', lang: 'en', audience: 'reader' })
      }
    )
    expect(response.status).toBe(401)
    expect(request.bodyUsed).toBe(false)
    assertUntouched()
  })

  test.each([
    ['/v1/bookmark/vector/refresh/extra', 404],
    ['/v1/bookmark/vector/refreshfoo', 401],
    ['/x/v1/bookmark/vector/refresh', 401]
  ] as const)('the noncanonical path %s cannot reach a task handler (%i)', async (path, status) => {
    const { request, response } = await atCore(path, { user_id: USER, bookmark_id: 41 }, task())
    expect(response.status).toBe(status)
    expect(request.bodyUsed).toBe(false)
    assertUntouched()
  })

  test('a trailing-slash path rejects after the secret and before parsing', async () => {
    const { request, response } = await atCore('/v1/bookmark/vector/refresh/', { user_id: USER, bookmark_id: 41 }, task())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 400, data: 'ERROR_PARAM' })
    expect(request.bodyUsed).toBe(false)
    assertUntouched()
  })

  test('a valid Reader JWT on a trailing slash is rejected by the secret first', async () => {
    const token = await new Auth(coreEnv).sign({ id: String(new Hashid(coreEnv).encodeId(USER)), email: 'reader@example.com', lang: 'en' })
    const { request, response } = await atCore('/v1/bookmark/vector/refresh/', { user_id: USER, bookmark_id: 41 }, { Authorization: `Bearer ${token}` })
    expect(response.status).toBe(401)
    expect(request.bodyUsed).toBe(false)
    assertUntouched()
  })

  test('a GET on a canonical task path is not routed to a handler', async () => {
    const request = new Request('https://api-reader.slax.com/v1/bookmark/vector/refresh', { method: 'GET', headers: task() })
    const response = await core.fetch(request, coreEnv, execution().ctx)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ code: 404 })
    assertUntouched()
  })

  test.each([undefined, '', '   '])('a missing, empty or whitespace Core configuration fails closed (%j)', async secret => {
    coreEnv = { ...coreEnv, VECTOR_REFRESH_SECRET: secret } as unknown as Env
    const { request, response } = await atCore('/v1/bookmark/vector/refresh', { user_id: USER, bookmark_id: 41 }, task())
    expect(response.status).toBe(401)
    expect(request.bodyUsed).toBe(false)
    assertUntouched()
  })

  test('a pending verification result is reported without a second target write', async () => {
    current.repo.findArticles.mockResolvedValue([articleRow])
    current.index.get.mockResolvedValueOnce([]).mockResolvedValueOnce([])
    const { response } = await atCore('/v1/bookmark/vector/refresh', { user_id: USER, bookmark_id: 41 }, task())
    expect(await response.json()).toMatchObject({ data: { state: 'pending', target: { kind: 'article', userId: USER, id: 41 } } })
    expect(current.repo.findArticles).toHaveBeenCalledOnce()
    expect(current.index.upsert).toHaveBeenCalledOnce()
  })
})

describe('Edge anonymous forwarding preserves the task header', () => {
  test('Edge needs no task secret configuration', () => {
    expect('VECTOR_REFRESH_SECRET' in edgeEnv).toBe(false)
  })

  test.each([
    ['/v1/bookmark/vector/refresh', { user_id: USER, bookmark_id: 41 }],
    ['/v1/bookmark/preference/refresh', { user_id: USER }],
    ['/v1/collection/vector/refresh', { collection_id: 81 }],
    ['/v1/collection/preference/refresh', { user_id: USER }]
  ] as const)('%s forwards the custom header unchanged and reaches the real Controller/Domain', async (path, body) => {
    current.repo.findArticles.mockResolvedValue([articleRow])
    current.repo.findCollection.mockResolvedValue({ id: 81, owner_id: USER, published_at: 1 })
    const { response, coreFetch, forwarded } = await throughEdge(path, body, task())
    expect(response.status).toBe(200)
    expect((await response.json()).code).toBe(200)
    expect(coreFetch).toHaveBeenCalledOnce()
    expect(forwarded!.headers.get('X-Vector-Refresh-Secret')).toBe(SECRET)
    expect(forwarded!.headers.has('Authorization')).toBe(false)
    expect(forwarded!.headers.has(EDGE_IDENTITY_HEADER)).toBe(false)
    if (path.includes('bookmark/vector')) expect([...current.stored.keys()]).toEqual(['a:7:41'])
    if (path.includes('collection/vector')) expect(current.repo.findCollection).toHaveBeenCalledExactlyOnceWith(81)
    if (path.includes('bookmark/preference')) expect(current.repo.listUserArticles).toHaveBeenCalled()
    if (path.includes('collection/preference')) expect(current.repo.listUserCollections).toHaveBeenCalled()
  })

  test('a wrong task header is forwarded and denied by Core', async () => {
    const { response, coreFetch } = await throughEdge('/v1/bookmark/vector/refresh', { user_id: USER, bookmark_id: 41 }, task(OTHER_SECRET))
    expect(response.status).toBe(401)
    expect(coreFetch).toHaveBeenCalledOnce()
    assertUntouched()
  })

  test('a missing task header is forwarded and denied by Core', async () => {
    const { response, coreFetch } = await throughEdge('/v1/bookmark/vector/refresh', { user_id: USER, bookmark_id: 41 }, {})
    expect(response.status).toBe(401)
    expect(coreFetch).toHaveBeenCalledOnce()
    assertUntouched()
  })

  test('a valid Reader JWT is forwarded in user mode, but Core still requires the task header', async () => {
    const token = await new Auth(coreEnv).sign({ id: String(new Hashid(coreEnv).encodeId(USER)), email: 'reader@example.com', lang: 'en' })
    const { response, coreFetch, forwarded } = await throughEdge('/v1/bookmark/vector/refresh', { user_id: USER, bookmark_id: 41 }, { Authorization: `Bearer ${token}` })
    expect(response.status).toBe(401)
    expect(coreFetch).toHaveBeenCalledOnce()
    expect(forwarded!.headers.has('Authorization')).toBe(false)
    expect(forwarded!.headers.has(EDGE_IDENTITY_HEADER)).toBe(true)
    assertUntouched()
  })

  test('a JWT plus the task header keeps the header and succeeds', async () => {
    current.repo.findArticles.mockResolvedValue([articleRow])
    const token = await new Auth(coreEnv).sign({ id: String(new Hashid(coreEnv).encodeId(USER)), email: 'reader@example.com', lang: 'en' })
    const { response, coreFetch, forwarded } = await throughEdge('/v1/bookmark/vector/refresh', { user_id: USER, bookmark_id: 41 }, { Authorization: `Bearer ${token}`, ...task() })
    expect(response.status).toBe(200)
    expect(coreFetch).toHaveBeenCalledOnce()
    expect(forwarded!.headers.get('X-Vector-Refresh-Secret')).toBe(SECRET)
    expect([...current.stored.keys()]).toEqual(['a:7:41'])
  })

  test('a trailing slash with the task header is rejected after the secret', async () => {
    const { response } = await throughEdge('/v1/bookmark/vector/refresh/', { user_id: USER, bookmark_id: 41 }, task())
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ code: 400, data: 'ERROR_PARAM' })
    assertUntouched()
  })

  test('an API key is forwarded but Core rejects it for task routes', async () => {
    const { response, coreFetch } = await throughEdge('/v1/bookmark/vector/refresh', { user_id: USER, bookmark_id: 41 }, { 'X-API-Key': 'reader-api-key' })
    expect(await response.json()).toMatchObject({ code: 403 })
    expect(coreFetch).toHaveBeenCalledOnce()
    assertUntouched()
  })

  test('a malformed task body reaches the Controller but performs no maintenance', async () => {
    const { response } = await throughEdge('/v1/bookmark/vector/refresh', { user_id: USER, bookmark_id: 41, preference: true }, task())
    expect(await response.json()).toMatchObject({ code: 400, data: 'ERROR_PARAM' })
    assertUntouched()
  })
})
