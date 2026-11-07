import { builtinModules, createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'
import { Auth } from '@/utils/jwt'
import { Hashid } from '@/utils/hashids'
import { EDGE_IDENTITY_HEADER, EDGE_SECRET_HEADER, encodeEdgeIdentity } from '@/const/edge'

// Actual Workerd run: the Edge and Core entry modules are bundled by esbuild (the same
// installed esbuild/wrangler Miniflare pair used by vectorPdf.runtime.test.ts), served by
// Miniflare over its loopback HTTP dispatcher, and exercised through the real generated
// router, middleware and Controllers. Only the data boundaries are fixtures.

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare } = runtimeRequire('miniflare')
const { build } = runtimeRequire('esbuild')

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const SECRET = 'temporary-runtime-task-secret-5e1a'
const OTHER_SECRET = 'temporary-runtime-other-secret-9c2b'
const EDGE_SHARED_SECRET = 'temporary-runtime-edge-shared'
const API_ORIGIN = 'https://api-reader.slax.com'

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
// pg and its Prisma adapter are unreachable in this fixture: the fixture DatabaseRegistry
// injects an in-memory Prisma stand-in, so the Node-only driver never runs.
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

function workerConfig(name: string, mainModule: string, contents: string, env: Record<string, unknown>) {
  return {
    config: {
      name,
      type: 'worker',
      compatibilityDate: '2026-08-01',
      compatibilityFlags: ['nodejs_compat'],
      manifest: { mainModule, modulesRoot: ROOT, modules: { [mainModule]: { type: 'esm', contents } } },
      env
    }
  }
}

test('actual Workerd serves the fixed-key task routes through Edge and Core', async () => {
  const [coreBundle, edgeBundle] = await Promise.all([
    bundle(`import core from './test/utils/vectorTaskAuthCore.worker.ts'; export default core;`),
    bundle(`import edge from './src/entry/edge/index.ts'; export default edge;`)
  ])

  const jwtSeed = {
    HASH_IDS_SALT: 'runtime-test-salt',
    JWT_SECRET_TEXT: 'test-secret-32-bytes-minimum-long-string',
    JWT_ALGORITHMS: 'HS256',
    JWT_ISSUER: 'test',
    JWT_EXPIRES: '3600'
  } as unknown as Env
  const readerToken = await new Auth(jwtSeed).sign({ id: String(new Hashid(jwtSeed).encodeId(7)), email: 'reader@example.com', lang: 'en' })

  const runtime = new Miniflare({
    telemetry: { enabled: false },
    cf: false,
    inspectorPort: 0,
    workers: [
      workerConfig('core', 'core.mjs', coreBundle, {
        VECTOR_REFRESH_SECRET: text(SECRET),
        EDGE_SHARED_SECRET: text(EDGE_SHARED_SECRET),
        FRONT_END_URL: text('http://localhost:3000'),
        RUN_ENV: text('test'),
        ...Object.fromEntries(Object.entries(jwtSeed).map(([key, value]) => [key, text(String(value))]))
      }),
      workerConfig('core-no-secret', 'core.mjs', coreBundle, {
        EDGE_SHARED_SECRET: text(EDGE_SHARED_SECRET),
        FRONT_END_URL: text('http://localhost:3000'),
        RUN_ENV: text('test'),
        ...Object.fromEntries(Object.entries(jwtSeed).map(([key, value]) => [key, text(String(value))]))
      }),
      workerConfig('core-empty-secret', 'core.mjs', coreBundle, {
        VECTOR_REFRESH_SECRET: text(''),
        EDGE_SHARED_SECRET: text(EDGE_SHARED_SECRET),
        FRONT_END_URL: text('http://localhost:3000'),
        RUN_ENV: text('test'),
        ...Object.fromEntries(Object.entries(jwtSeed).map(([key, value]) => [key, text(String(value))]))
      }),
      // Edge intentionally has no VECTOR_REFRESH_SECRET: it only forwards the whitelisted
      // anonymous request and preserves the custom header.
      workerConfig('edge', 'edge.mjs', edgeBundle, {
        EDGE_SHARED_SECRET: text(EDGE_SHARED_SECRET),
        FRONT_END_URL: text('http://localhost:3000'),
        ...Object.fromEntries(Object.entries(jwtSeed).map(([key, value]) => [key, text(String(value))])),
        CORE: { type: 'worker', worker: 'core' }
      })
    ]
  })

  try {
    await runtime.ready
    const core = await runtime.getWorker('core')
    const coreNoSecret = await runtime.getWorker('core-no-secret')
    const coreEmptySecret = await runtime.getWorker('core-empty-secret')
    const edge = await runtime.getWorker('edge')

    const post = (worker: { fetch: (input: string, init?: RequestInit) => Promise<Response> }, path: string, body: unknown, headers: Record<string, string> = {}) =>
      worker.fetch(`${API_ORIGIN}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify(body)
      })
    const task = { 'X-Vector-Refresh-Secret': SECRET }
    const accepted = [
      {
        path: '/v1/bookmark/vector/refresh',
        body: { user_id: 7, bookmark_id: 41 },
        state: 'written',
        target: { kind: 'article', userId: 7, id: 41 },
        vectorIds: ['a:7:41']
      },
      {
        path: '/v1/bookmark/preference/refresh',
        body: { user_id: 7 },
        state: 'deleted',
        target: { kind: 'user', id: 7, preference: 'article' },
        vectorIds: ['u:7:article', 'u:7:article:centered']
      },
      {
        path: '/v1/collection/vector/refresh',
        body: { collection_id: 81 },
        state: 'deleted',
        target: { kind: 'collection', id: 81 },
        vectorIds: ['c:81']
      },
      {
        path: '/v1/collection/preference/refresh',
        body: { user_id: 7 },
        state: 'deleted',
        target: { kind: 'user', id: 7, preference: 'collection' },
        vectorIds: ['u:7:collection']
      }
    ] as const

    for (const [label, worker] of [
      ['core', core],
      ['edge', edge]
    ] as const) {
      for (const action of accepted) {
        const response = await post(worker, action.path, action.body, task)
        const body = (await response.json()) as { code: number; data: { state: string; target: unknown; vectorIds: string[] } }
        expect(response.status, `${label} ${action.path}`).toBe(200)
        expect(body.code, `${label} ${action.path}`).toBe(200)
        expect(body.data.state).toBe(action.state)
        expect(body.data.target).toEqual(action.target)
        expect(body.data.vectorIds).toEqual(action.vectorIds)
      }
    }

    for (const worker of [core, edge]) {
      for (const [path, preference] of [
        ['/v1/bookmark/preference/refresh', 'article'],
        ['/v1/collection/preference/refresh', 'collection']
      ] as const) {
        const response = await post(worker, path, { user_id: 8 }, task)
        expect(response.status).toBe(200)
        expect(await response.json()).toMatchObject({
          code: 200,
          data: { state: 'written', target: { kind: 'user', id: 8, preference }, coverage: { eligible: 2, used: 1, missing: 1 } }
        })
        const unavailable = await post(worker, path, { user_id: 9 }, task)
        expect(await unavailable.json()).toMatchObject({
          code: 200,
          data: { state: 'failed', reason: 'no_usable_preference_vectors', coverage: { eligible: 1, used: 0, missing: 1 }, vectorIds: [], mutationIds: [] }
        })
      }
    }

    for (const headers of [{}, { 'X-Vector-Refresh-Secret': OTHER_SECRET }, { 'X-Vector-Refresh-Secret': '' }, { 'X-Vector-Refresh-Secret': '   ' }]) {
      const direct = await post(core, '/v1/bookmark/vector/refresh', { user_id: 7, bookmark_id: 41 }, headers)
      const forwarded = await post(edge, '/v1/bookmark/vector/refresh', { user_id: 7, bookmark_id: 41 }, headers)
      expect(direct.status).toBe(401)
      expect(forwarded.status).toBe(401)
    }

    for (const worker of [coreNoSecret, coreEmptySecret]) {
      const response = await post(worker, '/v1/bookmark/vector/refresh', { user_id: 7, bookmark_id: 41 }, task)
      expect(response.status).toBe(401)
    }

    for (const worker of [core, edge]) {
      const jwtOnly = await post(worker, '/v1/bookmark/vector/refresh', { user_id: 7, bookmark_id: 41 }, { Authorization: `Bearer ${readerToken}` })
      expect(jwtOnly.status).toBe(401)
    }

    for (const worker of [core, edge]) {
      const apiKeyOnly = await post(worker, '/v1/bookmark/vector/refresh', { user_id: 7, bookmark_id: 41 }, { 'X-API-Key': 'reader-api-key' })
      expect((await apiKeyOnly.json()).code).toBe(403)
    }

    const forgedIdentity = {
      [EDGE_SECRET_HEADER]: EDGE_SHARED_SECRET,
      [EDGE_IDENTITY_HEADER]: encodeEdgeIdentity({ deId: 7, enId: 10000007, email: 'reader@example.com', lang: 'en', audience: 'reader' })
    }
    const forged = await post(core, '/v1/bookmark/vector/refresh', { user_id: 7, bookmark_id: 41 }, forgedIdentity)
    expect(forged.status).toBe(401)

    for (const [label, worker] of [
      ['core', core],
      ['edge', edge]
    ] as const) {
      const trailingSlash = await post(worker, '/v1/bookmark/vector/refresh/', { user_id: 7, bookmark_id: 41 }, task)
      const raw = await trailingSlash.text()
      const body = JSON.parse(raw) as { code: number; data: unknown }
      expect(trailingSlash.status, `${label} ${raw}`).toBe(400)
      expect(body.code, label).toBe(400)
      expect(body.data, label).toBe('ERROR_PARAM')

      const trailingJwt = await post(worker, '/v1/bookmark/vector/refresh/', { user_id: 7, bookmark_id: 41 }, { Authorization: `Bearer ${readerToken}` })
      expect(trailingJwt.status, `${label} jwt trailing`).toBe(401)
    }

    for (const legacy of [{ user_bookmark_id: 11 }, { user_id: 7, bookmark_id: 41, preference: true }, { subscription_id: 91 }]) {
      const response = await post(core, '/v1/bookmark/vector/refresh', legacy, task)
      const body = (await response.json()) as { code: number; data: unknown }
      expect(body.code).toBe(400)
      expect(body.data).toBe('ERROR_PARAM')
    }

    const wrongMethod = await core.fetch(`${API_ORIGIN}/v1/bookmark/vector/refresh`, { method: 'GET', headers: task })
    expect(wrongMethod.status).toBe(404)
  } finally {
    await runtime.dispose()
  }
}, 120_000)
