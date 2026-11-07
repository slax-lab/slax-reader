import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { VectorPreferenceStateRepo } from '@/infra/repository/vectorPreferenceState'
import { emptyPreferenceState, type PreferenceState } from '@/utils/preferenceLedger'

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
    expect(await repo.insert('u:1:article', written)).toBe(true)
    const read = (await repo.read('u:1:article'))!
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
    await repo.insert('o:1:collection', owner)
    expect((await repo.read('o:1:collection'))!.centered.every(value => value === 0)).toBe(true)
  })

  test('insert, update and delete only succeed against the expected version', async () => {
    expect(await repo.insert('u:2:article', state(10))).toBe(true)
    expect(await repo.insert('u:2:article', state(11))).toBe(false)
    expect(await repo.update('u:2:article', 9, state(12))).toBe(false)
    expect(await repo.update('u:2:article', 10, state(12))).toBe(true)
    expect((await repo.read('u:2:article'))!.version).toBe(12)
    expect(await repo.delete('u:2:article', 10)).toBe(false)
    expect(await repo.delete('u:2:article', 12)).toBe(true)
    expect(await repo.read('u:2:article')).toBeNull()
  })

  test('two writers racing from the same version produce exactly one winner', async () => {
    await repo.insert('u:3:article', state(20))
    const results = await Promise.all([
      repo.update('u:3:article', 20, state(21, [[1, 1, '1111111111111111']])),
      repo.update('u:3:article', 20, state(22, [[2, 1, '2222222222222222']]))
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
    const winner = (await repo.read('u:3:article'))!
    expect([21, 22]).toContain(winner.version)
  })
})
