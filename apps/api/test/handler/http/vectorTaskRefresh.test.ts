import { beforeEach, describe, expect, test, vi } from 'vitest'
import { BookmarkController } from '../../../src/handler/http/bookmarkController'
import { CollectionController } from '../../../src/handler/http/collectionController'
import { auth, isWhitelisted } from '../../../src/middleware/auth'
import { requireVectorRefreshSecret } from '../../../src/utils/vectorRefreshAuth'
import { EDGE_IDENTITY_HEADER, EDGE_SECRET_HEADER, encodeEdgeIdentity } from '../../../src/const/edge'
import { ErrorName } from '../../../src/const/err'
import { ContextManager } from '../../../src/utils/context'
import { Auth } from '../../../src/utils/jwt'
import { Hashid } from '../../../src/utils/hashids'
import type { Container } from '../../../src/decorators/di'

const SECRET = 'task-secret-1f4b9c'
const canonical = [
  '/v1/bookmark/vector/refresh',
  '/v1/bookmark/preference/refresh',
  '/v1/collection/vector/refresh',
  '/v1/collection/preference/refresh'
] as const

const env = (secret: string | undefined = SECRET) => ({ VECTOR_REFRESH_SECRET: secret }) as unknown as Env

function refreshRequest(
  path: string,
  body: unknown = {},
  options: { secret?: string; method?: string; headers?: Record<string, string> } = {}
) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json', ...options.headers }
  const secret = options.secret === undefined ? SECRET : options.secret
  if (secret !== null) headers['X-Vector-Refresh-Secret'] = secret
  const method = options.method ?? 'POST'
  return new Request(`https://api-reader.slax.com${path}`, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body) })
}

function denied(fn: () => unknown) {
  try {
    fn()
  } catch (error) {
    expect(error).toMatchObject({ name: ErrorName.UNAUTHORIZED, errCode: 401 })
    return
  }
  throw new Error('expected the task secret to deny')
}

function maintenance() {
  return {
    refreshArticles: vi.fn(async (identities: Array<{ userId: number; id: number }>) => [
      { target: { kind: 'article', userId: identities[0].userId, id: identities[0].id }, state: 'written', vectorIds: [], mutationIds: [] }
    ]),
    refreshUser: vi.fn(async (id: number, preference: string) => ({ target: { kind: 'user', id, preference }, state: 'written', vectorIds: [], mutationIds: [] })),
    refreshCollection: vi.fn(async (id: number) => ({ target: { kind: 'collection', id }, state: 'written', vectorIds: [], mutationIds: [] })),
    verifyRefresh: vi.fn(async () => true)
  }
}

function bookmark(mock = maintenance()) {
  const controller = Object.assign(Object.create(BookmarkController.prototype), { vectorMaintenanceService: mock })
  return { controller, mock }
}

function collection(mock = maintenance()) {
  const controller = Object.assign(Object.create(CollectionController.prototype), { vectorMaintenanceService: mock })
  return { controller, mock }
}

function context(secret: string | undefined = SECRET) {
  return new ContextManager({} as ExecutionContext, env(secret))
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('requireVectorRefreshSecret', () => {
  test.each(canonical)('%s accepts the exact custom header secret without any user credential', path => {
    expect(() => requireVectorRefreshSecret(refreshRequest(path), env())).not.toThrow()
    expect(() => requireVectorRefreshSecret(refreshRequest(path, {}, { headers: { Authorization: 'Bearer reader.jwt' } }), env())).not.toThrow()
  })

  test.each([null, '', ' ', '\t', 'Bearer task-secret-1f4b9c', 'task-secret-1f4b9c0', 'TASK-SECRET-1F4B9C'])(
    'missing, blank, prefixed or wrong supplied header %j is rejected',
    secret => {
      const request = refreshRequest(canonical[0], {}, { secret: secret as string | null })
      denied(() => requireVectorRefreshSecret(request, env()))
      expect(request.bodyUsed).toBe(false)
    }
  )

  test.each([undefined, '', ' ', '\t'])('missing, empty or whitespace server configuration fails closed (%j)', secret => {
    denied(() => requireVectorRefreshSecret(refreshRequest(canonical[0]), { VECTOR_REFRESH_SECRET: secret } as unknown as Env))
  })

  test('a configured secret with surrounding whitespace cannot match the raw header digest', () => {
    // Fetch Headers trim leading/trailing whitespace in values, so this proves the configured
    // secret is hashed verbatim rather than trimmed before comparison.
    denied(() => requireVectorRefreshSecret(refreshRequest(canonical[0], {}, { secret: SECRET }), env(` ${SECRET} `)))
  })

  test('Authorization and X-API-Key never substitute for the custom header', () => {
    denied(() => requireVectorRefreshSecret(refreshRequest(canonical[0], {}, { secret: null, headers: { Authorization: `Bearer ${SECRET}` } }), env()))
    denied(() => requireVectorRefreshSecret(refreshRequest(canonical[0], {}, { secret: null, headers: { 'X-API-Key': SECRET } }), env()))
  })

  test('the helper itself is route-agnostic; Controllers enforce path and body order', () => {
    expect(() => requireVectorRefreshSecret(refreshRequest(`${canonical[0]}/`, {}, { method: 'GET' }), env())).not.toThrow()
  })
})

describe('anonymous whitelist and ordinary authentication', () => {
  test('the four task routes are whitelisted for anonymous Edge forwarding', () => {
    for (const path of canonical) expect(isWhitelisted(path)).toBe(true)
    expect(isWhitelisted(`${canonical[0]}/`)).toBe(true)
    expect(isWhitelisted('/v1/bookmark/list')).toBe(false)
  })

  test('anonymous requests reach the Controller without a user identity', async () => {
    const ctx = context()
    await auth(refreshRequest(canonical[0], { user_id: 7, bookmark_id: 41 }), ctx, { resolve: vi.fn() } as unknown as Container)
    expect(ctx.getUserId()).toBe(0)
  })

  test('a valid Reader JWT authenticates normally so the Controller can still require the task secret', async () => {
    const jwtEnv = { HASH_IDS_SALT: 'test', JWT_SECRET_TEXT: 'test-secret-32-bytes-minimum-long-string', JWT_ALGORITHMS: 'HS256', JWT_ISSUER: 'test', JWT_EXPIRES: '3600' } as unknown as Env
    const token = await new Auth(jwtEnv).sign({ id: String(new Hashid(jwtEnv).encodeId(7)), email: 'reader@example.com', lang: 'en' })
    const ctx = new ContextManager({} as ExecutionContext, { ...jwtEnv, VECTOR_REFRESH_SECRET: SECRET } as unknown as Env)
    const scope = { resolve: () => ({ $queryRaw: async () => [{ id: 7 }] }) } as unknown as Container
    await auth(refreshRequest(canonical[0], { user_id: 7, bookmark_id: 41 }, { secret: null, headers: { Authorization: `Bearer ${token}` } }), ctx, scope)
    expect(ctx.getUserId()).toBe(7)
  })

  test('an API key is not an allowed credential for task routes', async () => {
    const ctx = context()
    const scope = { resolve: vi.fn() } as unknown as Container
    await expect(
      auth(refreshRequest(canonical[0], { user_id: 7, bookmark_id: 41 }, { secret: null, headers: { 'X-API-Key': 'reader-api-key' } }), ctx, scope)
    ).rejects.toMatchObject({ name: ErrorName.API_KEY_ROUTE_NOT_ALLOWED, errCode: 403 })
    expect(scope.resolve).not.toHaveBeenCalled()
  })

  test('forwarded Edge identity is trusted for authentication but cannot replace the task secret', async () => {
    const ctx = new ContextManager({} as ExecutionContext, { VECTOR_REFRESH_SECRET: SECRET, EDGE_SHARED_SECRET: 'edge-shared' } as unknown as Env)
    const scope = { resolve: () => ({ $queryRaw: async () => [{ id: 7 }] }) } as unknown as Container
    const request = refreshRequest(canonical[0], { user_id: 7, bookmark_id: 41 }, {
      secret: null,
      headers: {
        [EDGE_SECRET_HEADER]: 'edge-shared',
        [EDGE_IDENTITY_HEADER]: encodeEdgeIdentity({ deId: 7, enId: 10000007, email: 'reader@example.com', lang: 'en', audience: 'reader' })
      }
    })
    await auth(request, ctx, scope)
    expect(ctx.getUserId()).toBe(7)
    denied(() => requireVectorRefreshSecret(request, env()))
    expect(request.bodyUsed).toBe(false)
  })

  test('the custom header alone does not authorize an unrelated route', async () => {
    const ctx = context()
    const request = refreshRequest('/v1/bookmark/list', {}, { method: 'GET' })
    await expect(auth(request, ctx, { resolve: vi.fn() } as unknown as Container)).rejects.toMatchObject({ name: ErrorName.UNAUTHORIZED, errCode: 401 })
  })
})

describe('single-target Controller actions', () => {
  test('bookmark vector refresh sends only its raw private pair', async () => {
    const { controller, mock } = bookmark()
    const response = await controller.handleUserBookmarkVectorRefreshRequest(context(), refreshRequest('/v1/bookmark/vector/refresh', { user_id: 7, bookmark_id: 9 }))
    expect(mock.refreshArticles).toHaveBeenCalledExactlyOnceWith([{ userId: 7, id: 9 }])
    expect(mock.refreshUser).not.toHaveBeenCalled()
    expect(mock.refreshCollection).not.toHaveBeenCalled()
    expect(mock.verifyRefresh).toHaveBeenCalledOnce()
    expect(await response.json()).toMatchObject({ code: 200, data: { target: { kind: 'article', userId: 7, id: 9 }, state: 'written' } })
  })

  test('bookmark preference refresh targets only that user article preference', async () => {
    const { controller, mock } = bookmark()
    const response = await controller.handleUserBookmarkPreferenceRefreshRequest(context(), refreshRequest('/v1/bookmark/preference/refresh', { user_id: 7 }))
    expect(mock.refreshUser).toHaveBeenCalledExactlyOnceWith(7, 'article')
    expect(mock.refreshArticles).not.toHaveBeenCalled()
    expect(mock.refreshCollection).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ code: 200, data: { target: { kind: 'user', id: 7, preference: 'article' } } })
  })

  test('collection vector refresh targets only that Collection', async () => {
    const { controller, mock } = collection()
    const response = await controller.handleUserCollectionVectorRefreshRequest(context(), refreshRequest('/v1/collection/vector/refresh', { collection_id: 30 }))
    expect(mock.refreshCollection).toHaveBeenCalledExactlyOnceWith(30)
    expect(mock.refreshArticles).not.toHaveBeenCalled()
    expect(mock.refreshUser).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ code: 200, data: { target: { kind: 'collection', id: 30 } } })
  })

  test('collection preference refresh targets only that user collection preference', async () => {
    const { controller, mock } = collection()
    const response = await controller.handleUserCollectionPreferenceRefreshRequest(context(), refreshRequest('/v1/collection/preference/refresh', { user_id: 7 }))
    expect(mock.refreshUser).toHaveBeenCalledExactlyOnceWith(7, 'collection')
    expect(mock.refreshArticles).not.toHaveBeenCalled()
    expect(mock.refreshCollection).not.toHaveBeenCalled()
    expect(await response.json()).toMatchObject({ code: 200, data: { target: { kind: 'user', id: 7, preference: 'collection' } } })
  })

  test.each([
    ['/v1/bookmark/vector/refresh', 'handleUserBookmarkVectorRefreshRequest', { user_id: 7, bookmark_id: 9 }, 'bookmark'],
    ['/v1/bookmark/preference/refresh', 'handleUserBookmarkPreferenceRefreshRequest', { user_id: 7 }, 'bookmark'],
    ['/v1/collection/vector/refresh', 'handleUserCollectionVectorRefreshRequest', { collection_id: 30 }, 'collection'],
    ['/v1/collection/preference/refresh', 'handleUserCollectionPreferenceRefreshRequest', { user_id: 7 }, 'collection']
  ] as const)('%s checks the secret before body, path and service', async (path, handler, body, kind) => {
    const { controller, mock } = kind === 'bookmark' ? bookmark() : collection()
    for (const secret of [null, '', 'wrong-secret', ' ']) {
      const request = refreshRequest(`${path}/`, '{not-json', { secret: secret as string | null })
      await expect((controller as any)[handler](context(), request)).rejects.toMatchObject({ name: ErrorName.UNAUTHORIZED, errCode: 401 })
      expect(request.bodyUsed).toBe(false)
    }
    const wrongConfig = refreshRequest(path, body, { secret: 'configured-other' })
    await expect((controller as any)[handler](context(SECRET), wrongConfig)).rejects.toMatchObject({ name: ErrorName.UNAUTHORIZED })
    for (const refresh of ['refreshArticles', 'refreshUser', 'refreshCollection']) expect(mock[refresh]).not.toHaveBeenCalled()
    expect(mock.verifyRefresh).not.toHaveBeenCalled()
  })

  const invalidIds = [undefined, null, 0, -1, 1.5, '12', true, [], {}, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity]
  test.each(invalidIds)('bookmark vector refresh rejects user_id %j before any write', async id => {
    const { controller, mock } = bookmark()
    const response = await controller.handleUserBookmarkVectorRefreshRequest(
      context(),
      refreshRequest('/v1/bookmark/vector/refresh', { user_id: id, bookmark_id: 9 })
    )
    expect(response.status).toBe(400)
    expect((await response.json()).data).toBe(ErrorName.ERROR_PARAM)
    expect(mock.refreshArticles).not.toHaveBeenCalled()
  })

  test.each(invalidIds)('bookmark vector refresh rejects bookmark_id %j before any write', async id => {
    const { controller, mock } = bookmark()
    const response = await controller.handleUserBookmarkVectorRefreshRequest(
      context(),
      refreshRequest('/v1/bookmark/vector/refresh', { user_id: 7, bookmark_id: id })
    )
    expect(response.status).toBe(400)
    expect((await response.json()).data).toBe(ErrorName.ERROR_PARAM)
    expect(mock.refreshArticles).not.toHaveBeenCalled()
  })

  test.each([
    ['bookmark vector', '/v1/bookmark/vector/refresh', 'handleUserBookmarkVectorRefreshRequest', { user_bookmark_id: 11 }],
    ['bookmark vector', '/v1/bookmark/vector/refresh', 'handleUserBookmarkVectorRefreshRequest', { user_id: 7, bookmark_id: 9, preference: true }],
    ['bookmark vector', '/v1/bookmark/vector/refresh', 'handleUserBookmarkVectorRefreshRequest', { user_id: 7, bookmark_id: 9, preference: false }],
    ['bookmark vector', '/v1/bookmark/vector/refresh', 'handleUserBookmarkVectorRefreshRequest', { user_id: 7, bookmark_id: 9, subscription_id: 2 }],
    ['bookmark vector', '/v1/bookmark/vector/refresh', 'handleUserBookmarkVectorRefreshRequest', { user_id: 7, bookmark_id: 9, user_bookmark_id: 3 }],
    ['bookmark vector', '/v1/bookmark/vector/refresh', 'handleUserBookmarkVectorRefreshRequest', { user_id: 7, bookmark_id: 9, targets: [{ kind: 'user', id: 7 }] }],
    ['bookmark vector', '/v1/bookmark/vector/refresh', 'handleUserBookmarkVectorRefreshRequest', { user_id: 7, bookmark_id: 9, extra: 1 }],
    ['bookmark vector', '/v1/bookmark/vector/refresh', 'handleUserBookmarkVectorRefreshRequest', [{ user_id: 7, bookmark_id: 9 }]],
    ['bookmark preference', '/v1/bookmark/preference/refresh', 'handleUserBookmarkPreferenceRefreshRequest', { user_id: 7, preference: 'article' }],
    ['bookmark preference', '/v1/bookmark/preference/refresh', 'handleUserBookmarkPreferenceRefreshRequest', { user_id: 7, bookmark_id: 9 }],
    ['bookmark preference', '/v1/bookmark/preference/refresh', 'handleUserBookmarkPreferenceRefreshRequest', [{ user_id: 7 }]],
    ['collection vector', '/v1/collection/vector/refresh', 'handleUserCollectionVectorRefreshRequest', { collection_id: 30, user_id: 7 }],
    ['collection vector', '/v1/collection/vector/refresh', 'handleUserCollectionVectorRefreshRequest', { subscription_id: 5 }],
    ['collection vector', '/v1/collection/vector/refresh', 'handleUserCollectionVectorRefreshRequest', [{ collection_id: 30 }]],
    ['collection preference', '/v1/collection/preference/refresh', 'handleUserCollectionPreferenceRefreshRequest', { subscription_id: 91 }],
    ['collection preference', '/v1/collection/preference/refresh', 'handleUserCollectionPreferenceRefreshRequest', { user_id: 7, subscription_id: 91 }],
    ['collection preference', '/v1/collection/preference/refresh', 'handleUserCollectionPreferenceRefreshRequest', { user_id: 7, preference: 'collection' }],
    ['collection preference', '/v1/collection/preference/refresh', 'handleUserCollectionPreferenceRefreshRequest', [{ user_id: 7 }]]
  ] as const)('%s rejects the superseded or multi-target body %j', async (_label, path, handler, body) => {
    const isBookmark = handler.startsWith('handleUserBookmark')
    const { controller, mock } = isBookmark ? bookmark() : collection()
    const response = await (controller as any)[handler](context(), refreshRequest(path, body))
    expect(response.status).toBe(400)
    expect((await response.json()).data).toBe(ErrorName.ERROR_PARAM)
    expect(mock.refreshArticles).not.toHaveBeenCalled()
    expect(mock.refreshUser).not.toHaveBeenCalled()
    expect(mock.refreshCollection).not.toHaveBeenCalled()
    expect(mock.verifyRefresh).not.toHaveBeenCalled()
  })

  test.each([
    ['/v1/bookmark/vector/refresh', 'handleUserBookmarkVectorRefreshRequest', { user_id: 7, bookmark_id: 9 }],
    ['/v1/bookmark/preference/refresh', 'handleUserBookmarkPreferenceRefreshRequest', { user_id: 7 }],
    ['/v1/collection/vector/refresh', 'handleUserCollectionVectorRefreshRequest', { collection_id: 30 }],
    ['/v1/collection/preference/refresh', 'handleUserCollectionPreferenceRefreshRequest', { user_id: 7 }]
  ] as const)('%s rejects a trailing-slash path after the secret and before parsing', async (path, handler, body) => {
    const isBookmark = handler.startsWith('handleUserBookmark')
    const { controller, mock } = isBookmark ? bookmark() : collection()
    const request = refreshRequest(`${path}/`, body)
    const response = await (controller as any)[handler](context(), request)
    expect(response.status).toBe(400)
    expect((await response.json()).data).toBe(ErrorName.ERROR_PARAM)
    expect(request.bodyUsed).toBe(false)
    expect(mock.refreshArticles).not.toHaveBeenCalled()
    expect(mock.refreshUser).not.toHaveBeenCalled()
    expect(mock.refreshCollection).not.toHaveBeenCalled()
  })

  test('invalid JSON is rejected without invoking the domain', async () => {
    const { controller, mock } = bookmark()
    const response = await controller.handleUserBookmarkVectorRefreshRequest(context(), refreshRequest('/v1/bookmark/vector/refresh', '{'))
    expect(response.status).toBe(400)
    expect((await response.json()).data).toBe(ErrorName.ERROR_PARAM)
    expect(mock.refreshArticles).not.toHaveBeenCalled()
  })

  test('a failed verification returns a pending result without a second target write', async () => {
    const { controller, mock } = bookmark()
    mock.verifyRefresh.mockResolvedValue(false)
    const response = await controller.handleUserBookmarkVectorRefreshRequest(context(), refreshRequest('/v1/bookmark/vector/refresh', { user_id: 7, bookmark_id: 9 }))
    expect(await response.json()).toMatchObject({ data: { state: 'pending', target: { kind: 'article', userId: 7, id: 9 } } })
    expect(mock.verifyRefresh).toHaveBeenCalledOnce()
  })

  test('a failed target skips verification and is reported truthfully', async () => {
    const { controller, mock } = bookmark()
    mock.refreshArticles.mockResolvedValue([
      { target: { kind: 'article', userId: 7, id: 9 }, state: 'failed', reason: 'source_not_ready', vectorIds: [], mutationIds: [] }
    ] as never)
    const response = await controller.handleUserBookmarkVectorRefreshRequest(context(), refreshRequest('/v1/bookmark/vector/refresh', { user_id: 7, bookmark_id: 9 }))
    expect(await response.json()).toMatchObject({ data: { state: 'failed', reason: 'source_not_ready' } })
    expect(mock.verifyRefresh).not.toHaveBeenCalled()
  })
})
