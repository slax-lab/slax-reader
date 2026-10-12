import { beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ auth: vi.fn(), query: vi.fn(), business: vi.fn(), init: vi.fn() }))
vi.mock('@/middleware/auth', () => ({ authToken: mocks.auth }))
vi.mock('@/domain/orchestrator/content', () => ({ ContentOrchestrator: class {} }))
vi.mock('@/domain/logs', () => ({ LogsService: class {} }))
vi.mock('@/domain/share', () => ({ ShareService: class {} }))
vi.mock('@/domain/bookmark', () => ({ BookmarkService: class {} }))
vi.mock('@/domain/collection', () => ({ CollectionService: class {} }))
vi.mock('@/handler/http/collectionController', () => ({ CollectionController: { collectionCodeIsValidate: () => true } }))
vi.mock('@/middleware/requestLog', () => ({ requestLog: vi.fn() }))
vi.mock('@/di/generated/dependency', async () => {
  const { PRISIMA_HYPERDRIVE_CLIENT } = await import('@/const/symbol')
  const { ContentOrchestrator } = await import('@/domain/orchestrator/content')
  return { initializeInfrastructure: (ctx: any, scope: any) => {
    mocks.init()
    scope.registerInstance(PRISIMA_HYPERDRIVE_CLIENT, { $queryRaw: mocks.query })
    scope.registerInstance(ContentOrchestrator, { getContentMeta: mocks.business })
  } }
})
import { handleContentRequest } from '@/handler/http/contentHandler'
import { UnauthorizedError } from '@/const/err'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.auth.mockImplementation(async ctx => { ctx.setUserInfo(42, 84, '', 'en') })
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
