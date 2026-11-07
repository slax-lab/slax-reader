import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { VectorPreferenceStateRepo } from '@/infra/repository/vectorPreferenceState'
import { emptyPreferenceState, PREFERENCE_STATE_MAX_ENTRIES, type PreferenceState } from '@/utils/preferenceLedger'

const req = createRequire(import.meta.url)
const { Miniflare } = createRequire(req.resolve('wrangler/package.json'))('miniflare')
const apiRoot = fileURLToPath(new URL('../../', import.meta.url))

let runtime: InstanceType<typeof Miniflare>
let d1: D1Database
let repo: VectorPreferenceStateRepo

const state = (version: number, entries: [number, number, string][] = [[7, 2, '0123456789abcdef']]): PreferenceState => {
  const value = emptyPreferenceState('mean-v1')
  value.version = version
  value.raw = Float64Array.from({ length: 1024 }, (_, i) => Math.sin(i) / 3)
  value.centered = Float64Array.from({ length: 1024 }, (_, i) => Math.cos(i) * 1e-9)
  value.entries = new Map(entries.map(([id, weight, token]) => [id, { weight, token }]))
  return value
}

beforeAll(async () => {
  runtime = new Miniflare({
    telemetry: { enabled: false },
    workers: [
      {
        config: {
          name: 'vector-preference-state-fixture',
          type: 'worker',
          compatibilityDate: '2026-08-01',
          manifest: {
            mainModule: 'fixture.mjs',
            modulesRoot: apiRoot,
            modules: { 'fixture.mjs': { type: 'esm', contents: 'export default { fetch(){ return new Response("ok") } }' } }
          },
          env: { DB: { type: 'd1', id: 'vector-preference-state-fixture' } }
        }
      }
    ]
  })
  d1 = (await runtime.getD1Database('DB')) as unknown as D1Database
  const migration = await readFile(new URL('../../prisma/d1_migrations/00066_add_vector_preference_state.sql', import.meta.url), 'utf8')
  await d1.exec(
    migration
      .replace(/--[^\n]*/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  )
  repo = new VectorPreferenceStateRepo({ DB: d1 } as unknown as Env)
}, 120_000)

beforeEach(async () => {
  await d1.exec('DELETE FROM slax_vector_preference_state')
})

afterAll(async () => {
  await runtime?.dispose()
})

describe('D1 preference state store', () => {
  test('round-trips sums, pending entries and a large version exactly', async () => {
    const written = state(1_794_100_000_123, [
      [9, 1, ''],
      [3, 2, 'ffffffff00000001']
    ])
    expect(await repo.insert('state:user-article:1', written)).toBe(true)
    const read = (await repo.read('state:user-article:1'))!
    expect(read.version).toBe(written.version)
    expect(read.meanVersion).toBe('mean-v1')
    expect([...read.raw]).toEqual([...written.raw])
    expect([...read.centered]).toEqual([...written.centered])
    expect([...read.entries]).toEqual([
      [3, { weight: 2, token: 'ffffffff00000001' }],
      [9, { weight: 1, token: '' }]
    ])
  })

  test('all-zero centered sums are stored compactly and read back as zeros', async () => {
    const owner = state(5)
    owner.centered = new Float64Array(1024)
    await repo.insert('state:owner-collection:1', owner)
    expect((await repo.read('state:owner-collection:1'))!.centered.every(value => value === 0)).toBe(true)
  })

  test('a ledger at the persistence cap fits in one D1 row', async () => {
    const full = state(30)
    full.entries = new Map(Array.from({ length: PREFERENCE_STATE_MAX_ENTRIES }, (_, i) => [i + 1, { weight: 1 + (i % 2), token: (i + 1).toString(16).padStart(16, '0') }]))
    expect(await repo.insert('state:user-article:4', full)).toBe(true)
    const read = (await repo.read('state:user-article:4'))!
    expect(read.entries.size).toBe(PREFERENCE_STATE_MAX_ENTRIES)
    expect(read.entries.get(PREFERENCE_STATE_MAX_ENTRIES)).toEqual({ weight: 2, token: PREFERENCE_STATE_MAX_ENTRIES.toString(16).padStart(16, '0') })
  })

  test('insert, update and delete only succeed against the expected version', async () => {
    expect(await repo.insert('state:user-article:2', state(10))).toBe(true)
    expect(await repo.insert('state:user-article:2', state(11))).toBe(false)
    expect(await repo.update('state:user-article:2', 9, state(12))).toBe(false)
    expect(await repo.update('state:user-article:2', 10, state(12))).toBe(true)
    expect((await repo.read('state:user-article:2'))!.version).toBe(12)
    expect(await repo.delete('state:user-article:2', 10)).toBe(false)
    expect(await repo.delete('state:user-article:2', 12)).toBe(true)
    expect(await repo.read('state:user-article:2')).toBeNull()
  })

  test('two writers racing from the same version produce exactly one winner', async () => {
    await repo.insert('state:user-article:3', state(20))
    const results = await Promise.all([
      repo.update('state:user-article:3', 20, state(21, [[1, 1, '1111111111111111']])),
      repo.update('state:user-article:3', 20, state(22, [[2, 1, '2222222222222222']]))
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    const winner = (await repo.read('state:user-article:3'))!
    expect([21, 22]).toContain(winner.version)
  })
})
