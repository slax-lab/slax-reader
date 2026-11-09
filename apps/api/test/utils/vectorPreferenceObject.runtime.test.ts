import { builtinModules, createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, test } from 'vitest'

// Actual Workerd run of the SQLite-backed VectorPreferenceObject: real Durable Object storage,
// RPC delivery, per-user queue and maintenance engine. Only PostgreSQL and Vectorize are fixtures.

const require = createRequire(import.meta.url)
const runtimeRequire = createRequire(require.resolve('wrangler/package.json'))
const { Miniflare } = runtimeRequire('miniflare')
const { build } = runtimeRequire('esbuild')
const ROOT = fileURLToPath(new URL('../../', import.meta.url))

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

type State = {
  tables: string[]
  entries: { bookmark_id: number; weight: number; member: number; token: string }[]
  seq: number | null
  rawBytes: number | null
  user: number[] | null
  userVersion: number | null
  collection: number[] | null
  counters: { batches: number; rebuilds: number; rowReads: number }
}

test('actual Workerd keeps one user preference in real Durable Object SQLite and combines concurrent applies', async () => {
  const contents = (
    await build({
      stdin: { contents: `export { default, FixturePreferenceObject } from './test/utils/vectorPreferenceObject.worker.ts'`, resolveDir: ROOT, loader: 'ts' },
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
  const runtime = new Miniflare({
    telemetry: { enabled: false },
    cf: false,
    inspectorPort: 0,
    workers: [
      {
        config: {
          name: 'core',
          type: 'worker',
          compatibilityDate: '2026-08-01',
          compatibilityFlags: ['nodejs_compat'],
          manifest: { mainModule: 'core.mjs', modulesRoot: ROOT, modules: { 'core.mjs': { type: 'esm', contents } } },
          exports: { FixturePreferenceObject: { type: 'durable-object', storage: 'sqlite' } },
          env: { VECTOR_V5_PREFERENCE: { type: 'durable-object', worker: 'core', exportName: 'FixturePreferenceObject' } }
        }
      }
    ]
  })
  try {
    const call = async <T>(body: Record<string, unknown>): Promise<T> => {
      const response = await runtime.dispatchFetch('http://local/', { method: 'POST', body: JSON.stringify(body) })
      expect(response.status).toBe(200)
      return (await response.json()) as T
    }
    const inspect = () => call<State>({ op: 'inspect' })

    await call({ op: 'set', id: 1, starred: true, member: true, axis: 1 })
    await call({ op: 'set', id: 2, starred: false, member: false, axis: 2 })
    const first = await call<any[]>({ op: 'apply', id: 1 })
    expect(first.map(output => [output.target.kind, output.state])).toEqual([
      ['user', 'written'],
      ['collection', 'written']
    ])
    let state = await inspect()
    expect(state.tables).toEqual(['preference_entry', 'preference_state'])
    expect(state.entries.map(entry => [entry.bookmark_id, entry.weight, entry.member])).toEqual([
      [1, 2, 1],
      [2, 1, 0]
    ])
    expect(state.entries.every(entry => /^[0-9a-f]{16}$/.test(entry.token))).toBe(true)
    expect(state.rawBytes).toBe(8192)
    expect(state.counters.rebuilds).toBeGreaterThan(0)
    const rebuildsAfterFirst = state.counters.rebuilds

    for (const id of [3, 4, 5, 6, 7, 8]) await call({ op: 'set', id, starred: id % 2 === 0, member: id % 2 === 0, axis: id })
    const before = state.counters.batches
    const burst = await call<any[][]>({ op: 'burst', ids: [3, 4, 5, 6, 7, 8] })
    expect(burst.flat().every(output => output.state === 'written')).toBe(true)
    state = await inspect()
    expect(state.counters.batches - before).toBeLessThan(6)
    expect(state.counters.rebuilds).toBe(rebuildsAfterFirst)
    expect(state.entries).toHaveLength(8)
    expect(state.userVersion).toBe(state.seq)
    expect(Math.max(...burst.map(outputs => outputs[0].stateVersion))).toBe(state.seq)

    const previous = await call<number[]>({ op: 'delete', id: 4 })
    const removed = await call<any[]>({ op: 'apply', id: 4, previous })
    expect(removed[0]).toMatchObject({ state: 'written', coverage: { eligible: 7, used: 7, missing: 0 } })
    state = await inspect()
    expect(state.counters.rebuilds).toBe(rebuildsAfterFirst)
    expect(state.entries.map(entry => entry.bookmark_id)).toEqual([1, 2, 3, 5, 6, 7, 8])
    const incremental = { user: state.user!, collection: state.collection! }

    await call({ op: 'rebuild' })
    state = await inspect()
    expect(state.counters.rebuilds).toBeGreaterThan(rebuildsAfterFirst)
    incremental.user.forEach((value, i) => expect(value).toBeCloseTo(state.user![i], 10))
    incremental.collection.forEach((value, i) => expect(value).toBeCloseTo(state.collection![i], 10))

    for (const id of [1, 2, 3, 5, 6, 7, 8]) {
      const last = await call<number[]>({ op: 'delete', id })
      await call({ op: 'apply', id, previous: last })
    }
    state = await inspect()
    expect(state.tables).toEqual([])
    expect(state.user).toBeNull()
    expect(state.collection).toBeNull()
  } finally {
    await runtime.dispose()
  }
}, 120_000)
