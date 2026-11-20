import { afterEach, beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), business: vi.fn(), init: vi.fn() }))
vi.mock('@/middleware/auth', () => ({ authToken: mocks.auth }))
vi.mock('@/domain/orchestrator/content', () => ({ ContentOrchestrator: class {} }))
vi.mock('@/domain/logs', () => ({ LogsService: class {} }))
vi.mock('@/domain/share', () => ({ ShareService: class {} }))
vi.mock('@/domain/bookmark', () => ({ BookmarkService: class {} }))
vi.mock('@/domain/collection', () => ({ CollectionService: class {} }))
vi.mock('@/handler/http/collectionController', () => ({ CollectionController: { collectionCodeIsValidate: () => true } }))
vi.mock('@/middleware/requestLog', () => ({ requestLog: vi.fn() }))
vi.mock('@/di/generated/core/dependency', async () => {
  const { PRISIMA_HYPERDRIVE_CLIENT } = await import('@/const/symbol')
  const { ContentOrchestrator } = await import('@/domain/orchestrator/content')
  return {
    initializeInfrastructure: (ctx: any, scope: any) => {
      mocks.init()
      scope.registerInstance(PRISIMA_HYPERDRIVE_CLIENT, { $queryRaw: mocks.query })
      scope.registerInstance(ContentOrchestrator, { getContentMeta: mocks.business })
    }
  }
})
import { handleContentRequest } from '@/entry/core/contentHandler'
import { BookmarkNotFoundError, UnauthorizedError } from '@/const/err'
import { EDGE_RAY_ID_HEADER } from '@/const/edge'
afterEach(() => vi.restoreAllMocks())
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockImplementation(async ctx => {
    ctx.setUserInfo(42, 84, '', 'en')
  })
  mocks.query.mockResolvedValue([{ id: 42 }])
  mocks.business.mockResolvedValue({ title: 'allowed' })
})
function call(headers?: HeadersInit) {
  return handleContentRequest(new Request('https://content.internal/content/meta?uuid=abc', { headers }), { HASH_IDS_SALT: 'salt' } as Env, {} as ExecutionContext)
}
test('invalid tokens cannot downgrade to anonymous content', async () => {
  mocks.auth.mockRejectedValue(UnauthorizedError())
  expect((await call({ Authorization: 'Bearer bad' })).status).toBe(401)
  expect(mocks.business).not.toHaveBeenCalled()
})
test('deleted and missing users are rejected after infrastructure and token verification', async () => {
  mocks.query.mockResolvedValue([])
  expect((await call({ Authorization: 'Bearer token' })).status).toBe(401)
  expect(mocks.init.mock.invocationCallOrder[0]).toBeLessThan(mocks.auth.mock.invocationCallOrder[0])
  expect(mocks.business).not.toHaveBeenCalled()
})
test('database failures do not fall back to anonymous access', async () => {
  mocks.query.mockRejectedValue(new Error('DB unavailable'))
  expect((await call({ 'x-slax-token': 'token' })).status).toBe(500)
  expect(mocks.business).not.toHaveBeenCalled()
})
test('anonymous public access remains supported without a database identity lookup', async () => {
  expect((await call()).status).toBe(200)
  expect(mocks.query).not.toHaveBeenCalled()
  expect(mocks.business).toHaveBeenCalledOnce()
})

test('does not expose granular metadata stages when access is denied', async () => {
  mocks.business.mockImplementation(async (_ctx, _uuid, recordTiming) => {
    recordTiming('access-owner', 12)
    throw BookmarkNotFoundError()
  })
  const response = await call()
  expect(response.status).toBe(404)
  expect(response.headers.get('Server-Timing')).not.toContain('access-owner')
})

test('retains granular diagnostic stages for successful metadata', async () => {
  mocks.business.mockImplementation(async (_ctx, _uuid, recordTiming) => {
    recordTiming('access-owner', 12)
    return { title: 'allowed' }
  })
  expect((await call()).headers.get('Server-Timing')).toContain('core_access-owner;dur=12.0')
})

test('records successful Core metadata stages in prod without exposing response diagnostics', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  mocks.business.mockImplementation(async (_ctx, _uuid, recordTiming) => {
    recordTiming('access-owner', 12)
    return { title: 'allowed' }
  })
  const response = await handleContentRequest(
    new Request('https://content.internal/content/meta?uuid=private-bookmark', { headers: { [EDGE_RAY_ID_HEADER]: 'outer-ray' } }),
    { HASH_IDS_SALT: 'salt', RUN_TYPE: 'prod' } as Env,
    {} as ExecutionContext
  )
  expect(response.status).toBe(200)
  expect(response.headers.get('Server-Timing')).toBeNull()
  expect(info.mock.calls.map(call => call[1])).toEqual([
    expect.objectContaining({ scope: 'core', phase: 'entry', ray_id: 'outer-ray' }),
    expect.objectContaining({ scope: 'core', phase: 'response', status_code: 200, phases_ms: expect.objectContaining({ 'access-owner': 12 }) })
  ])
  expect(JSON.stringify(info.mock.calls)).not.toContain('private-bookmark')
})

test('records the actual denied metadata status without logging the error payload', async () => {
  const info = vi.spyOn(console, 'info').mockImplementation(() => {})
  mocks.business.mockRejectedValue(BookmarkNotFoundError())
  expect((await call()).status).toBe(404)
  expect(info.mock.calls[1][1]).toMatchObject({ scope: 'core', phase: 'response', status_code: 404, outcome: 'returned' })
  expect(info.mock.calls[1][1]).not.toHaveProperty('error')
})
