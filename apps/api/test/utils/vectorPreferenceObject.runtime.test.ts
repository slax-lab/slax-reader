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

type Counts = { eligible: number; used: number; shared: { members: number; missing: number }; inherited: { members: number; missing: number } }
type State = {
  tables: string[]
  entries: { bookmark_id: number; weight: number; share_group: number; token: string }[]
  seq: number | null
  rawBytes: number | null
  counts: Counts | null
  plan: string
  user: number[] | null
  userVersion: number | null
  collection: number[] | null
  counters: { batches: number; rebuilds: number; rowReads: number; articleReads: number; mutations: number; subscriptionReads: number }
}

const recount = (entries: State['entries']): Counts => {
  const group = (code: number) => ({
    members: entries.filter(entry => entry.share_group === code).length,
    missing: entries.filter(entry => entry.share_group === code && !entry.token).length
  })
  return { eligible: entries.length, used: entries.filter(entry => entry.token).length, shared: group(1), inherited: group(2) }
}

test('actual Workerd keeps one user preference in real Durable Object SQLite, combines concurrent applies and publishes Collection changes from stored sums', async () => {
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

    await call({ op: 'set', id: 1, starred: true, group: 'shared', axis: 1 })
    await call({ op: 'set', id: 2, starred: false, group: 'none', axis: 2 })
    const first = await call<any[]>({ op: 'apply', id: 1 })
    expect(first.map(output => [output.target.kind, output.state])).toEqual([
      ['user', 'written'],
      ['collection', 'written']
    ])
    let state = await inspect()
    expect(state.tables).toEqual(['preference_entry_v3', 'preference_state_v3'])
    expect(state.entries.map(entry => [entry.bookmark_id, entry.weight, entry.share_group])).toEqual([
      [1, 2, 1],
      [2, 1, 0]
    ])
    expect(state.entries.every(entry => /^[0-9a-f]{16}$/.test(entry.token))).toBe(true)
    expect(state.rawBytes).toBe(8192)
    expect(state.counts).toEqual(recount(state.entries))
    expect(state.counters.rebuilds).toBeGreaterThan(0)
    const rebuildsAfterFirst = state.counters.rebuilds

    for (const id of [3, 4, 5, 6, 7, 8]) await call({ op: 'set', id, starred: id % 2 === 0, group: id % 2 === 0 ? 'shared' : 'none', axis: id })
    const before = state.counters.batches
    const burst = await call<any[][]>({ op: 'burst', ids: [3, 4, 5, 6, 7, 8] })
    expect(burst.flat().every(output => output.state === 'written')).toBe(true)
    state = await inspect()
    expect(state.counters.batches - before).toBeLessThan(6)
    expect(state.counters.rebuilds).toBe(rebuildsAfterFirst)
    expect(state.entries).toHaveLength(8)
    expect(state.counts).toEqual(recount(state.entries))
    expect(state.userVersion).toBe(state.seq)
    expect(Math.max(...burst.map(outputs => outputs[0].stateVersion))).toBe(state.seq)

    const previous = await call<number[]>({ op: 'delete', id: 4 })
    const removed = await call<any[]>({ op: 'apply', id: 4, previous })
    expect(removed[0]).toMatchObject({ state: 'written', coverage: { eligible: 7, used: 7, missing: 0 } })
    state = await inspect()
    expect(state.counters.rebuilds).toBe(rebuildsAfterFirst)
    expect(state.entries.map(entry => entry.bookmark_id)).toEqual([1, 2, 3, 5, 6, 7, 8])
    expect(state.counts).toEqual(recount(state.entries))
    const incremental = { user: state.user!, collection: state.collection! }

    await call({ op: 'rebuild' })
    state = await inspect()
    expect(state.counters.rebuilds).toBeGreaterThan(rebuildsAfterFirst)
    incremental.user.forEach((value, i) => expect(value).toBeCloseTo(state.user![i], 10))
    incremental.collection.forEach((value, i) => expect(value).toBeCloseTo(state.collection![i], 10))

    // Default share setting and Collection status changes publish from stored sums.
    for (const id of [9, 10]) {
      await call({ op: 'set', id, starred: true, group: 'inherited', axis: 20 + id })
      await call({ op: 'apply', id })
    }
    state = await inspect()
    expect(state.counts).toEqual(recount(state.entries))
    expect(state.counts!.inherited.members).toBe(2)
    const withInherited = state.collection!
    const quiet = state.counters
    await call({ op: 'owner', sharing: false, active: true })
    const off = await call<any[]>({ op: 'publish' })
    expect(off.map(output => [output.target.kind, output.target.id, output.state])).toEqual([['collection', 201, 'written']])
    state = await inspect()
    expect([state.counters.rebuilds, state.counters.rowReads, state.counters.articleReads]).toEqual([quiet.rebuilds, quiet.rowReads, quiet.articleReads])
    const sharedOnly = state.collection!
    expect(sharedOnly.some((value, i) => Math.abs(value - withInherited[i]) > 1e-6)).toBe(true)
    await call({ op: 'rebuild' })
    state = await inspect()
    sharedOnly.forEach((value, i) => expect(value).toBeCloseTo(state.collection![i], 10))
    const afterRebuild = state.counters
    await call({ op: 'owner', sharing: true, active: true })
    await call({ op: 'publish' })
    state = await inspect()
    withInherited.forEach((value, i) => expect(value).toBeCloseTo(state.collection![i], 10))
    await call({ op: 'owner', sharing: true, active: false })
    expect((await call<any[]>({ op: 'publish' }))[0]).toMatchObject({ state: 'deleted' })
    state = await inspect()
    expect(state.collection).toBeNull()
    await call({ op: 'owner', sharing: true, active: true })
    expect((await call<any[]>({ op: 'publish' }))[0]).toMatchObject({ state: 'written' })
    state = await inspect()
    withInherited.forEach((value, i) => expect(value).toBeCloseTo(state.collection![i], 10))
    expect([state.counters.rebuilds, state.counters.rowReads, state.counters.articleReads]).toEqual([afterRebuild.rebuilds, afterRebuild.rowReads, afterRebuild.articleReads])

    expect(state.plan).toContain('USING INDEX preference_entry_v3_publication')
    expect(state.plan).not.toMatch(/\bSCAN\b/)
    await call({ op: 'set', id: 11, starred: true, group: 'inherited', axis: 40, vector: false })
    const missing = await call<any[]>({ op: 'apply', id: 11 })
    expect(missing.map(output => [output.target.kind, output.state, output.reason])).toEqual([
      ['user', 'written', undefined],
      ['collection', 'written', undefined]
    ])
    expect(missing[0].coverage).toEqual({ eligible: 10, used: 9, missing: 1 })
    state = await inspect()
    expect(state.counts).toEqual(recount(state.entries))
    await call({ op: 'owner', sharing: false, active: true })
    expect((await call<any[]>({ op: 'publish' }))[0]).toMatchObject({ state: 'written' })
    await call({ op: 'owner', sharing: true, active: true })

    for (const id of [1, 2, 3, 5, 6, 7, 8, 9, 10, 11]) {
      const last = await call<number[]>({ op: 'delete', id })
      await call({ op: 'apply', id, previous: last })
    }
    state = await inspect()
    expect(state.tables).toEqual([])
    expect(state.user).toBeNull()
    expect(state.collection).toBeNull()

    // State written in the previous layout is rebuilt once and its tables are dropped.
    await call({ op: 'legacy' })
    expect((await inspect()).tables).toEqual(['preference_entry', 'preference_state'])
    await call({ op: 'set', id: 12, starred: true, group: 'shared', axis: 12 })
    const rebuildsBeforeLegacy = (await inspect()).counters.rebuilds
    expect((await call<any[]>({ op: 'apply', id: 12 })).map(output => output.state)).toEqual(['written', 'written'])
    state = await inspect()
    expect(state.tables).toEqual(['preference_entry_v3', 'preference_state_v3'])
    expect(state.counters.rebuilds).toBe(rebuildsBeforeLegacy + 1)
    await call({ op: 'set', id: 13, starred: false, group: 'none', axis: 13 })
    await call({ op: 'apply', id: 13 })
    expect((await inspect()).counters.rebuilds).toBe(rebuildsBeforeLegacy + 1)

    const subscriber = async (winner?: number) => {
      const output = await call<{
        preference: { vector: number[] | null; coverage: { eligible: number; used: number; missing: number } }
        recommendations: { items: { id: number }[]; reason?: string }
        before: State['counters']
        after: State['counters']
        materialized: boolean
      }>({ op: 'subscriber' })
      for (const key of ['mutations', 'batches', 'rebuilds', 'rowReads', 'articleReads'] as const) expect(output.after[key]).toBe(output.before[key])
      expect(output.materialized).toBe(false)
      if (winner) expect(output.recommendations.items.map(item => item.id)).toEqual([winner])
      else expect(output.recommendations).toMatchObject({ items: [], reason: 'cold_start' })
      return output
    }
    const sameAsOwner = async (winner?: number) => {
      const visible = await inspect()
      const output = await subscriber(winner)
      expect(output.preference.coverage).toEqual({ eligible: 1, used: 1, missing: 0 })
      output.preference.vector!.forEach((value, i) => expect(value).toBeCloseTo(visible.collection![i], 10))
    }
    await sameAsOwner(301)
    await call({ op: 'legacy', version: 2 })
    const beforeV2 = (await inspect()).counters.rebuilds
    await call({ op: 'publish' })
    expect((await inspect()).counters.rebuilds).toBe(beforeV2 + 1)
    expect((await inspect()).tables).toEqual(['preference_entry_v3', 'preference_state_v3'])
    await call({ op: 'publish' })
    expect((await inspect()).counters.rebuilds).toBe(beforeV2 + 1)
    const oldVector = await call<number[]>({ op: 'set', id: 12, starred: true, group: 'shared', axis: 14 })
    await call({ op: 'apply', id: 12 })
    expect((await inspect()).counters.rebuilds).toBe(beforeV2 + 1)
    await sameAsOwner(302)

    for (const id of [14, 16]) {
      await call({ op: 'set', id, starred: true, group: 'inherited', axis: 12 })
      await call({ op: 'apply', id })
    }
    await sameAsOwner(301)

    const beforeToggle = (await inspect()).counters
    await call({ op: 'owner', sharing: false, active: true })
    await call({ op: 'publish' })
    await sameAsOwner(302)
    await call({ op: 'owner', sharing: true, active: true })
    await call({ op: 'publish' })
    await sameAsOwner(301)
    await call({ op: 'owner', sharing: true, active: false })
    await call({ op: 'publish' })
    await subscriber()
    await call({ op: 'owner', sharing: true, active: true })
    await call({ op: 'publish' })
    await sameAsOwner(301)
    expect((await inspect()).counters.articleReads).toBe(beforeToggle.articleReads)
    expect((await inspect()).counters.rebuilds).toBe(beforeToggle.rebuilds)
    await call({ op: 'subscribe', value: false })
    await subscriber()
    await call({ op: 'subscribe', value: true })
    await sameAsOwner(301)

    await call({ op: 'legacy' })
    await call({ op: 'owner', sharing: false, active: true })
    await call({ op: 'set', id: 15, starred: true, group: 'shared', axis: 14 })
    const beforeUpgrade = (await inspect()).counters.rebuilds
    await call({ op: 'publish' })
    state = await inspect()
    expect(state.counters.rebuilds).toBe(beforeUpgrade + 1)
    expect(state.tables).toEqual(['preference_entry_v3', 'preference_state_v3'])
    expect(state.entries.map(entry => entry.bookmark_id)).toContain(15)
    await sameAsOwner(302)
    await call({ op: 'publish' })
    expect((await inspect()).counters.rebuilds).toBe(beforeUpgrade + 1)
  } finally {
    await runtime.dispose()
  }
}, 120_000)
