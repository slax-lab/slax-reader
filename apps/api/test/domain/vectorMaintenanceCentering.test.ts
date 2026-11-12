import { describe, expect, test, vi } from 'vitest'
import { EMBEDDING_MEAN } from '../../src/utils/embeddingMean'
import { memoryPreferences } from '../helpers/preferenceMemory'

vi.mock('@/entry/core', () => ({ default: { fetch: vi.fn() } }))
vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class {
    constructor(
      _ctx: unknown,
      protected env: Env
    ) {}
  }
}))

const unit = (axis = 0) => Array.from({ length: 1024 }, (_, index) => (index === axis ? 1 : 0))

function harness() {
  const stored = new Map<string, any>()
  stored.set('a:1:1', { id: 'a:1:1', values: unit(0) })
  const index = {
    get: vi.fn(async (_kind: string, ids: string[]) => ids.flatMap(id => (stored.has(id) ? [structuredClone(stored.get(id))] : []))),
    upsert: vi.fn(async (_kind: string, vectors: any[]) => {
      for (const vector of vectors) stored.set(vector.id, structuredClone(vector))
      return { mutationId: crypto.randomUUID() }
    }),
    delete: vi.fn(async (_kind: string, ids: string[]) => {
      for (const id of ids) stored.delete(id)
      return { mutationId: crypto.randomUUID() }
    })
  }
  const repo = {
    listUserArticles: async () => [{ id: 1, is_starred: false, share_group: 'none' }],
    listRecentUserActions: async () => [],
    listOwnerCollections: async () => [],
    listUserCollections: async () => []
  }
  return { stored, index, repo }
}

async function runWithVersion(version?: string) {
  vi.resetModules()
  if (version) vi.doMock('../../src/utils/embeddingMean', () => ({ EMBEDDING_MEAN: { ...EMBEDDING_MEAN, version } }))
  else vi.doUnmock('../../src/utils/embeddingMean')
  const { VectorMaintenanceService } = await import('../../src/domain/vectorMaintenance')
  const { recommendationAlgorithm } = await import('../../src/utils/recommendationFeedback')
  const state = harness()
  const service = (preferences => preferences.bind(new VectorMaintenanceService(state.repo as any, {} as any, {} as any, state.index as any, preferences.client)))(
    memoryPreferences()
  )
  const output = await service.refreshUser(1, 'article')
  return { output, state, algorithm: await recommendationAlgorithm() }
}

describe('centered preference versioning', () => {
  test('the shared write token and algorithm hash follow EMBEDDING_MEAN_VERSION', async () => {
    const real = await runWithVersion()
    const mocked = await runWithVersion('000000000000')
    expect(real.output.state).toBe('written')
    expect(mocked.output.state).toBe('written')
    expect(real.output.vectorIds).toEqual(['u:1:article', 'u:1:article:centered'])
    for (const run of [real, mocked]) {
      const raw = run.state.stored.get('u:1:article')!
      const centered = run.state.stored.get('u:1:article:centered')!
      expect(raw.metadata?.write_token).toBe(run.output.writeToken)
      expect(centered.metadata?.write_token).toBe(run.output.writeToken)
    }
    expect(real.state.stored.get('u:1:article:centered')!.metadata?.embedding_mean_version).toBe(EMBEDDING_MEAN.version)
    expect(mocked.state.stored.get('u:1:article:centered')!.metadata?.embedding_mean_version).toBe('000000000000')
    expect(real.state.stored.get('u:1:article')!.values).toEqual(mocked.state.stored.get('u:1:article')!.values)
    expect(real.state.stored.get('u:1:article:centered')!.values).toEqual(mocked.state.stored.get('u:1:article:centered')!.values)
    expect(real.output.writeToken).not.toBe(mocked.output.writeToken)
    expect(real.algorithm).toMatch(/^[0-9a-f]{12}$/)
    expect(real.algorithm).not.toBe(mocked.algorithm)
  })
})
