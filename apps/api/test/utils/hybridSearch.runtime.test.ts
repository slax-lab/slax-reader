import { request as httpRequest } from 'node:http'
import { builtinModules, createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'
import { Auth } from '@/utils/jwt'
import { Hashid } from '@/utils/hashids'

// Actual Workerd run over a Miniflare direct socket. Edge, the generated Core router, auth,
// SearchController, HybridSearchOrchestrator and HybridSearchService are real. Repository,
// fulltext, provider and native-index boundaries are fixtures in the test-only Core worker.
// Audit/mode state lives in a Node-side fetcher binding so service-binding isolates share it.

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare } = runtimeRequire('miniflare')
const { build } = runtimeRequire('esbuild')

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const JWT_ENV = {
  HASH_IDS_SALT: 'runtime-search-salt',
  JWT_SECRET_TEXT: 'test-secret-32-bytes-minimum-long-string',
  JWT_ALGORITHMS: 'HS256',
  JWT_ISSUER: 'test',
  JWT_EXPIRES: '3600'
} as unknown as Env

const builtins = new Set(builtinModules)
const nodeBuiltins = {
  name: 'node-builtins',
  setup(buildApi: { onResolve: Function }) {
    buildApi.onResolve({ filter: /^[^./].*/ }, (args: { path: string }) => {
      const bare = args.path.startsWith('node:') ? args.path.slice(5) : args.path
      if (builtins.has(bare.split('/')[0])) return { path: `node:${bare}`, external: true }
    })
  }
}
const nodeOnlyStubs = {
  name: 'node-only-stubs',
  setup(buildApi: { onResolve: Function; onLoad: Function }) {
    buildApi.onResolve({ filter: /^pg$/ }, () => ({ path: 'pg-stub', namespace: 'stub' }))
    buildApi.onResolve({ filter: /^@prisma\/adapter-pg$/ }, () => ({ path: 'pg-adapter-stub', namespace: 'stub' }))
    buildApi.onLoad({ filter: /.*/, namespace: 'stub' }, (args: { path: string }) => ({
      contents: args.path === 'pg-stub' ? 'export class Pool { constructor() {} }\nexport default { Pool }' : 'export class PrismaPg { constructor() {} }',
      loader: 'js'
    }))
  }
}

async function bundle(contents: string) {
  return (
    await build({
      stdin: { contents, resolveDir: ROOT, loader: 'ts' },
      bundle: true,
      write: false,
      platform: 'browser',
      format: 'esm',
      target: 'es2022',
      conditions: ['workerd', 'worker'],
      external: ['cloudflare:*'],
      loader: { '.wasm': 'binary' },
      plugins: [nodeBuiltins, nodeOnlyStubs],
      logLevel: 'silent'
    })
  ).outputFiles[0].text
}

const text = (value: string) => ({ type: 'text', value })

function workerConfig(name: string, mainModule: string, contents: string, env: Record<string, unknown>, extra: Record<string, unknown> = {}, flags: string[] = ['nodejs_compat', 'enable_request_signal']) {
  return {
    config: {
      name,
      type: 'worker',
      compatibilityDate: '2026-08-01',
      compatibilityFlags: flags,
      manifest: { mainModule, modulesRoot: ROOT, modules: { [mainModule]: { type: 'esm', contents } } },
      env,
      ...extra
    }
  }
}

let gate: Promise<Response> = Promise.resolve(new Response('ok'))
let releaseGate = () => {}
const resetGate = () => {
  gate = new Promise<Response>(resolve => (releaseGate = () => resolve(new Response('ok'))))
}

const auditState = {
  auditId: '',
  mode: 'normal',
  embeddingCalls: 0,
  embeddingAborts: 0,
  requestAborts: 0,
  fulltextPages: 0,
  vectorArticleCalls: 0,
  cleanupCount: 0,
  cleanupAt: null as number | null
}

let auditSequence = 0
const resetAudit = (mode = 'normal') => {
  auditSequence += 1
  Object.assign(auditState, {
    auditId: `run-${auditSequence}`,
    mode,
    embeddingCalls: 0,
    embeddingAborts: 0,
    requestAborts: 0,
    fulltextPages: 0,
    vectorArticleCalls: 0,
    cleanupCount: 0,
    cleanupAt: null
  })
}

const auditHandler = async (request: Request) => {
  const url = new URL(request.url)
  if (url.pathname === '/mode') return Response.json({ mode: auditState.mode })
  if (url.pathname !== '/event') return new Response('not found', { status: 404 })
  const event = (await request.json()) as { event: string; auditId?: string }
  if (event.auditId !== auditState.auditId) return Response.json({ ignored: true })
  switch (event.event) {
    case 'embedding_call':
      auditState.embeddingCalls += 1
      break
    case 'embedding_abort':
      auditState.embeddingAborts += 1
      break
    case 'request_abort':
      auditState.requestAborts += 1
      break
    case 'fulltext_page':
      auditState.fulltextPages += 1
      break
    case 'vector_article':
      auditState.vectorArticleCalls += 1
      break
    case 'cleanup':
      auditState.cleanupCount += 1
      auditState.cleanupAt = Date.now()
      break
  }
  return Response.json({ ok: true })
}

function sse(response: Response) {
  const reader = response.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  return {
    async next(): Promise<{ event: string; data: any } | null> {
      for (;;) {
        const boundary = buffer.indexOf('\n\n')
        if (boundary >= 0) {
          const raw = buffer.slice(0, boundary)
          buffer = buffer.slice(boundary + 2)
          if (!raw.trim()) continue
          const event = /^event: (.+)$/m.exec(raw)?.[1] ?? ''
          const data = /^data: (.+)$/m.exec(raw)?.[1]
          return { event, data: data ? JSON.parse(data) : null }
        }
        const chunk = await reader.read()
        if (chunk.done) return null
        buffer += decoder.decode(chunk.value, { stream: true })
      }
    }
  }
}

async function waitForAudit(predicate: (state: typeof auditState) => boolean, timeoutMs = 2000) {
  const started = Date.now()
  for (;;) {
    if (predicate(auditState)) return { ...auditState }
    if (Date.now() - started >= timeoutMs) return { ...auditState }
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

describe('actual Workerd unified search stream', () => {
  let runtime: InstanceType<typeof Miniflare>
  let edgeUrl: URL
  let token: string

  beforeAll(async () => {
    const [coreBundle, edgeBundle] = await Promise.all([
      bundle(`import worker from './test/utils/hybridSearchCore.worker.ts'; export default worker;`),
      bundle(`import edge from './src/entry/edge/index.ts'; export default edge;`)
    ])
    runtime = new Miniflare({
      telemetry: { enabled: false },
      cf: false,
      inspectorPort: 0,
      workers: [
        {
          ...workerConfig('edge', 'edge.mjs', edgeBundle, {
            EDGE_SHARED_SECRET: text('edge-shared'),
            FRONT_END_URL: text('http://localhost:3000'),
            ...Object.fromEntries(Object.entries(JWT_ENV).map(([key, value]) => [key, text(String(value))])),
            CORE: { type: 'worker', worker: 'core' }
          }),
          dev: { unsafeDirectSockets: [{ host: '127.0.0.1', port: 0 }] }
        },
        workerConfig('core', 'core.mjs', coreBundle, {
          EDGE_SHARED_SECRET: text('edge-shared'),
          FRONT_END_URL: text('http://localhost:3000'),
          ...Object.fromEntries(Object.entries(JWT_ENV).map(([key, value]) => [key, text(String(value))])),
          TEST_GATE: { type: 'fetcher', handler: async () => gate },
          AUDIT: { type: 'fetcher', handler: auditHandler }
        })
      ]
    })
    await runtime.ready
    edgeUrl = await runtime.unsafeGetDirectURL('edge')
    token = await new Auth(JWT_ENV).sign({ id: String(new Hashid(JWT_ENV).encodeId(7)), email: 'reader@example.com', lang: 'en' })
  }, 120_000)

  afterAll(async () => {
    await runtime?.dispose()
  })

  function prepare(mode = 'normal') {
    resetAudit(mode)
    resetGate()
  }

  async function search(path = '/v1/search') {
    return fetch(new URL(path, edgeUrl), {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-hybrid-audit-id': auditState.auditId },
      body: JSON.stringify({ keyword: 'reader' })
    })
  }

  test('a real partial arrives before the embedding gate, then exactly one complete fuses all entity types', async () => {
    prepare()
    const response = await search()
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/event-stream; charset=utf-8')
    expect(response.headers.get('access-control-allow-origin')).toBe('*')
    expect(response.headers.get('cache-control')).toBe('private, no-store, no-transform')

    const stream = sse(response)
    const first = await stream.next()
    const firstPartialAt = Date.now()
    expect(first?.event).toBe('partial')
    expect(['titles', 'fulltext']).toContain(first?.data.channel)
    const beforeRelease = await waitForAudit(state => state.embeddingCalls === 1 && state.cleanupCount === 0)
    expect(beforeRelease.embeddingCalls).toBe(1)
    expect(beforeRelease.cleanupCount).toBe(0)

    await new Promise(resolve => setTimeout(resolve, 10))
    const gateReleasedAt = Date.now()
    releaseGate()
    const events: Array<{ event: string; data: any }> = [first!]
    for (;;) {
      const event = await stream.next()
      if (!event) break
      events.push(event)
    }
    const completes = events.filter(event => event.event === 'complete')
    expect(completes).toHaveLength(1)
    const complete = completes[0].data
    const types = new Set(complete.results.map((result: { type: string }) => result.type))
    expect(types).toEqual(new Set(['article', 'collection', 'rss_feed', 'rss_entry']))
    const article = complete.results.find((result: { type: string }) => result.type === 'article')
    expect(article.matched_channels.sort()).toEqual(['article_vector', 'fulltext', 'titles'])
    const collection = complete.results.find((result: { type: string }) => result.type === 'collection')
    expect(collection.matched_channels.sort()).toEqual(['collection_vector', 'titles'])
    const articlePartials = events.filter(event => event.event === 'partial').flatMap(event => event.data.results).filter((result: { type: string }) => result.type === 'article')
    const navigation = [article, ...articlePartials].flatMap((hit: { origins: Array<{ kind: string; cb_id?: number; bookmark_uuid?: string }> }) =>
      hit.origins.filter(origin => origin.kind === 'collection')
    )
    expect(navigation.length).toBeGreaterThanOrEqual(2)
    const hashid = new Hashid(JWT_ENV, 7)
    for (const origin of navigation) {
      expect(typeof origin.cb_id).toBe('number')
      expect(hashid.decodeId(origin.cb_id!)).toBe(88)
      expect(origin.bookmark_uuid).toBe('owner-uuid')
    }
    expect(new Set(navigation.map(origin => origin.cb_id)).size).toBe(1)
    const completedAt = Date.now()
    const after = await waitForAudit(state => state.embeddingCalls === 1 && state.cleanupCount === 1)
    expect(after.embeddingCalls).toBe(1)
    expect(after.cleanupCount).toBe(1)
    expect(firstPartialAt).toBeLessThanOrEqual(gateReleasedAt)
    expect(after.cleanupAt).not.toBeNull()
    console.log(
      JSON.stringify({
        firstPartialAt,
        gateReleasedAt,
        completedAt,
        cleanupAt: after.cleanupAt,
        embeddingCalls: after.embeddingCalls,
        cleanupCount: after.cleanupCount,
        articleChannels: article.matched_channels,
        collectionChannels: collection.matched_channels
      })
    )
  }, 120_000)

  test('a channel failure still delivers the other channels and a complete event', async () => {
    prepare('fulltext_fail')
    releaseGate()
    const response = await search()
    expect(response.status).toBe(200)
    const stream = sse(response)
    const events: Array<{ event: string; data: any }> = []
    for (;;) {
      const event = await stream.next()
      if (!event) break
      events.push(event)
    }
    expect(events.filter(event => event.event === 'channel_error').map(event => event.data.channel)).toEqual(['fulltext'])
    const completes = events.filter(event => event.event === 'complete')
    expect(completes).toHaveLength(1)
    expect(completes[0].data.channels.fulltext).toEqual({ status: 'error', code: 'retrieval_failed' })
    expect(completes[0].data.incomplete).toBe(true)
    expect(completes[0].data.results.some((result: { type: string }) => result.type === 'article')).toBe(true)
    expect((await waitForAudit(state => state.cleanupCount === 1)).cleanupCount).toBe(1)
  }, 120_000)

  test('a client disconnect stops later delivery and cleans up once after the work settles', async () => {
    prepare()
    expect(auditState.cleanupCount).toBe(0)
    let firstChunk = ''
    let disconnected = false
    const connected = new Promise<void>((resolve, reject) => {
      const payload = JSON.stringify({ keyword: 'reader' })
      const request = httpRequest(
        {
          hostname: edgeUrl.hostname,
          port: edgeUrl.port,
          path: '/v1/search',
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
            'x-hybrid-audit-id': auditState.auditId,
            'Content-Length': Buffer.byteLength(payload)
          }
        },
        response => {
          response.on('data', chunk => {
            firstChunk += String(chunk)
            if (!disconnected && firstChunk.includes('event: partial')) {
              disconnected = true
              response.destroy()
              request.destroy()
              resolve()
            }
          })
          response.on('error', () => {})
        }
      )
      request.on('error', error => {
        if (!disconnected) reject(error)
      })
      request.end(payload)
    })
    await connected
    expect(firstChunk).toContain('event: partial')
    const after = await waitForAudit(state => state.requestAborts === 1 && state.vectorArticleCalls === 0 && state.cleanupCount === 1)
    expect({ requestAborts: after.requestAborts, vectors: after.vectorArticleCalls, cleanup: after.cleanupCount }).toEqual({ requestAborts: 1, vectors: 0, cleanup: 1 })
  }, 120_000)
})
