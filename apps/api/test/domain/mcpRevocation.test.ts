import { beforeEach, expect, test, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ callbacks: new Map<string, Function>(), query: vi.fn(), business: vi.fn(), cleanup: vi.fn() }))
vi.mock('agents/mcp', () => ({ McpAgent: class {} }))
vi.mock('@modelcontextprotocol/sdk/server/mcp.js', () => ({
  McpServer: class {
    tool(name: string, ...args: any[]) { mocks.callbacks.set(name, args.at(-1)) }
    registerResource(name: string, ...args: any[]) { mocks.callbacks.set(name, args.at(-1)) }
    resource(name: string, ...args: any[]) { mocks.callbacks.set(name, args.at(-1)) }
    prompt(name: string, ...args: any[]) { mocks.callbacks.set(name, args.at(-1)) }
  }, ResourceTemplate: class {}
}))
vi.mock('@/domain/bookmark', () => ({ BookmarkService: class {} }))
vi.mock('@/domain/search', () => ({ SearchService: class {} }))
vi.mock('@/utils/parser', () => ({ ContentParser: {} }))
vi.mock('@/di/generated/dependency', async () => {
  const { PRISIMA_HYPERDRIVE_CLIENT } = await import('@/const/symbol')
  const { BookmarkService } = await import('@/domain/bookmark')
  const { SearchService } = await import('@/domain/search')
  return {
    initializeCore: vi.fn(),
    initializeInfrastructure: (ctx: any, scope: any) => {
      ctx.onCleanup(mocks.cleanup)
      scope.registerInstance(PRISIMA_HYPERDRIVE_CLIENT, { $queryRaw: mocks.query })
      scope.registerInstance(BookmarkService, { bookmarkList: mocks.business })
      scope.registerInstance(SearchService, { hybridSearch: mocks.business })
    }
  }
})
import { SlaxMcpServer } from '@/domain/orchestrator/mcp'
beforeEach(() => {
  vi.clearAllMocks()
  mocks.callbacks.clear()
  mocks.query.mockResolvedValue([{ id: 42 }])
  mocks.business.mockResolvedValue([])
  mocks.cleanup.mockResolvedValue(undefined)
})
async function setup() {
  const server = new SlaxMcpServer({} as any, {} as any)
  Object.assign(server, { env: { HASH_IDS_SALT: 'salt' }, props: { userId: 42, lang: 'en' } })
  await server.init()
  return server
}
test('an established MCP connection rechecks each invocation in a new scope', async () => {
  await setup()
  const call = mocks.callbacks.get('list_bookmark')!
  await call({ query: '', page: 1 })
  expect(mocks.business).toHaveBeenCalledOnce()
  mocks.query.mockResolvedValue([])
  await expect(call({ query: '', page: 1 })).rejects.toMatchObject({ errCode: 401 })
  expect(mocks.business).toHaveBeenCalledOnce()
  expect(mocks.cleanup).toHaveBeenCalledTimes(2)
})
test.each(['bookmark_overview', 'bookmark_content', 'about', 'slax'])('%s denies deleted users before a resource or prompt is produced', async name => {
  await setup()
  mocks.query.mockResolvedValue([])
  await expect(mocks.callbacks.get(name)!(new URL('bookmark://content/1'))).rejects.toMatchObject({ errCode: 401 })
  expect(mocks.business).not.toHaveBeenCalled()
  expect(mocks.cleanup).toHaveBeenCalledOnce()
})
test('DB failures and missing props fail closed', async () => {
  const server = await setup()
  mocks.query.mockRejectedValue(new Error('db unavailable'))
  await expect(mocks.callbacks.get('list_bookmark')!({ query: '', page: 1 })).rejects.toThrow('db unavailable')
  Object.assign(server, { props: undefined })
  await expect(mocks.callbacks.get('about')!(new URL('about://slax'))).rejects.toThrow('identity is missing')
  expect(mocks.business).not.toHaveBeenCalled()
})
