import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, test, vi } from 'vitest'
import { API_ROOT } from '../../script/root'

vi.mock('cloudflare:workers', () => ({
  DurableObject: class {
    constructor(
      protected ctx: unknown,
      protected env: unknown
    ) {}
  }
}))

vi.mock('@/utils/activeUser', () => ({ requireActiveUser: vi.fn(async () => undefined) }))

import * as retired from '@/entry/retired'
import { Container } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { getRouter as aiRouter } from '@/di/generated/ai/aiRouter'
import { getRouter as readerRouter } from '@/di/generated/core/readerRouter'
import { EDGE_IDENTITY_HEADER, EDGE_SECRET_HEADER, encodeEdgeIdentity } from '@/const/edge'

describe('retired Durable Object namespaces', () => {
  test('normal Core and Edge entries no longer export the removed MCP class; only the transitional Core entry does', async () => {
    const read = (file: string) => fs.readFileSync(path.join(API_ROOT, file), 'utf8')
    for (const file of ['src/entry/core/index.ts', 'src/entry/edge/index.ts']) expect(read(file)).not.toContain('SlaxMcpServer')
    expect(read('src/entry/transition/core.ts')).toContain("export { SlaxMcpServer } from '../retired'")
    expect(fs.existsSync(path.join(API_ROOT, 'src/entry/transition/edge.ts'))).toBe(false)
  })

  test.each(['SlaxJieba', 'SlaxWebSocketServer', 'ScreenshotBrowser', 'SlaxMcpServer'] as const)('%s keeps its name and answers 410 without behavior', async name => {
    const Stub = retired[name]
    const object = new Stub({} as never, {} as never)
    const response = await object.fetch()
    expect(response.status).toBe(410)
    expect(Object.getOwnPropertyNames(Stub.prototype)).toEqual(['constructor'])
  })
})

describe('removed MCP endpoint', () => {
  // Signed in through Edge, so the request passes authentication and reaches route matching.
  const env = { EDGE_SHARED_SECRET: 'edge-secret', HASH_IDS_SALT: 'salt', FRONT_END_URL: 'http://localhost:3000' } as unknown as Env
  const request = () =>
    new Request('https://api-reader.slax.com/v1/mcp/sse', {
      headers: {
        [EDGE_SECRET_HEADER]: 'edge-secret',
        [EDGE_IDENTITY_HEADER]: encodeEdgeIdentity({ deId: 7, enId: 7, email: 'reader@example.com', lang: 'en', audience: 'reader' })
      }
    })

  test.each([
    ['Core', readerRouter],
    ['AI', aiRouter]
  ] as const)('%s answers /v1/mcp/sse with the existing not-found response', async (_tier, router) => {
    const response = (await router(new Container()).fetch(request(), new ContextManager({ waitUntil: () => undefined } as unknown as ExecutionContext, env))) as Response
    expect(response.status).toBe(404)
  })
})
