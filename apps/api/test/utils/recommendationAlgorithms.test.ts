import { describe, expect, test } from 'vitest'
import {
  ZORRO_CANDIDATE_DECAY_PER_HOUR,
  PINNERSAGE_ALPHA,
  PINNERSAGE_IMPORTANCE_DECAY_PER_DAY,
  MMR_LAMBDA,
  MMR_CANDIDATES,
  POPULAR_WINDOW_HOURS,
  cosineSimilarity,
  wardClusters,
  medoidIndex,
  clusterImportance,
  interestClusters,
  sampleInterests,
  zorroRank,
  mmrSelect,
  center,
  EMBEDDING_MEAN_VERSION,
  type InterestAction,
  type InterestCluster
} from '../../src/utils/recommendationAlgorithms'
import {
  REFERENCE_ALPHA,
  REFERENCE_CANDIDATE_DECAY_PER_HOUR,
  REFERENCE_IMPORTANCE_DECAY_PER_DAY,
  REFERENCE_MMR_CANDIDATES,
  REFERENCE_MMR_LAMBDA,
  REFERENCE_POPULAR_WINDOW_HOURS,
  clusterImportanceLiteral,
  interestClustersLiteral,
  medoidIndexLiteral,
  mmrSelectLiteral,
  normalizedSum,
  sampleInterestsLiteral,
  wardClustersLiteral,
  zorroOrderLiteral,
  zorroOrderCenteredLiteral,
  zorroSim1AllLiteral,
  centeredCosine,
  referenceCenter,
  referenceCosine,
  type ReferenceCluster
} from '../helpers/recommendationReference'
import { EMBEDDING_MEAN } from '../../src/utils/embeddingMean'

const DAY_MS = 86_400_000
const NOW = Date.UTC(2026, 10, 5, 12)
const DIMENSIONS = 64

const createRng = (seed: number) => {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let value = state
    value = Math.imul(value ^ (value >>> 15), value | 1)
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61)
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296
  }
}

const gaussian = (rng: () => number) => {
  const first = Math.max(rng(), Number.EPSILON)
  const second = rng()
  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second)
}

const normalize = (vector: number[]) => {
  const scale = Math.hypot(...vector)
  return vector.map(value => value / scale)
}

const randomUnitVector = (rng: () => number, dimensions = DIMENSIONS) =>
  normalize(Array.from({ length: dimensions }, () => gaussian(rng)))

const clusteredVectors = (rng: () => number, count: number, centers: number, noise = 0.55, dimensions = DIMENSIONS) => {
  const centerVectors = Array.from({ length: centers }, () => randomUnitVector(rng, dimensions))
  const spread = noise / Math.sqrt(dimensions)
  return Array.from({ length: count }, (_, index) => {
    const center = centerVectors[index % centers]
    const perturbed = center.map(value => value + spread * gaussian(rng))
    return normalize(perturbed)
  })
}

const partitionOf = (clusters: number[][]) => clusters.map(cluster => cluster.join(','))

const expectClose = (actual: number, expected: number) => {
  const tolerance = Math.max(1e-9, Math.abs(expected) * 1e-5)
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(tolerance)
}

// Item objects are the documented return of mmrSelect; tolerate a wrapper only so a
// differently shaped but order-equivalent return does not mask the selection itself.
const mmrId = (entry: any) => (typeof entry?.id === 'number' ? entry.id : entry.item.id)

describe('design constants', () => {
  test('match the published and derived values', () => {
    expect(ZORRO_CANDIDATE_DECAY_PER_HOUR).toBe(0.015)
    expect(PINNERSAGE_ALPHA).toBe(1.6459373070)
    expect(EMBEDDING_MEAN_VERSION).toBe(EMBEDDING_MEAN.version)
    expect(EMBEDDING_MEAN.version).toMatch(/^[0-9a-f]{12}$/)
    expect(PINNERSAGE_IMPORTANCE_DECAY_PER_DAY).toBe(0.01)
    expect(MMR_LAMBDA).toBe(0.7)
    expect(MMR_CANDIDATES).toBe(50)
    expect(POPULAR_WINDOW_HOURS).toBeCloseTo(Math.log(100) / 0.015, 12)
    expect(POPULAR_WINDOW_HOURS).toBeGreaterThan(306)
    expect(POPULAR_WINDOW_HOURS).toBeLessThan(308)
    expect(REFERENCE_CANDIDATE_DECAY_PER_HOUR).toBe(ZORRO_CANDIDATE_DECAY_PER_HOUR)
    expect(REFERENCE_ALPHA).toBe(PINNERSAGE_ALPHA)
    expect(REFERENCE_IMPORTANCE_DECAY_PER_DAY).toBe(PINNERSAGE_IMPORTANCE_DECAY_PER_DAY)
    expect(REFERENCE_MMR_LAMBDA).toBe(MMR_LAMBDA)
    expect(REFERENCE_MMR_CANDIDATES).toBe(MMR_CANDIDATES)
    expect(REFERENCE_POPULAR_WINDOW_HOURS).toBeCloseTo(POPULAR_WINDOW_HOURS, 12)
  })
})

describe('ZoRRO ranking', () => {
  test('a 48-hour age gap multiplies the score by e^-0.72', () => {
    const history = [[1, 0, 0, 0]]
    const candidate = normalize([0.8, 0.6, 0, 0])
    const items = [
      { item: { id: 1 }, cosine: 0.8, ageHours: 0, tieUserId: 1, tieId: 1, vector: candidate },
      { item: { id: 2 }, cosine: 0.8, ageHours: 48, tieUserId: 1, tieId: 2, vector: candidate }
    ]
    const ranked = zorroRank(items)
    expect(ranked.map(entry => entry.item.id)).toEqual([1, 2])
    expect(ranked[1].sim1 / ranked[0].sim1).toBeCloseTo(Math.exp(-0.72), 10)
    const reference = zorroOrderLiteral(
      items.map(entry => ({ ...entry, id: entry.item.id })),
      history
    )
    expect(ranked.map(entry => entry.item.id)).toEqual(reference.map(entry => entry.id))
  })

  test('cosine 0.9 at 720 hours ranks below cosine 0.5 at 0 hours', () => {
    const history = [[1, 0, 0, 0]]
    const old = normalize([0.9, Math.sqrt(1 - 0.81), 0, 0])
    const fresh = normalize([0.5, Math.sqrt(1 - 0.25), 0, 0])
    const items = [
      { item: { id: 10 }, cosine: 0.9, ageHours: 720, tieUserId: 1, tieId: 10, vector: old },
      { item: { id: 20 }, cosine: 0.5, ageHours: 0, tieUserId: 1, tieId: 20, vector: fresh }
    ]
    const ranked = zorroRank(items)
    expect(ranked.map(entry => entry.item.id)).toEqual([20, 10])
    expect(0.9 * Math.exp(-0.015 * 720)).toBeLessThan(0.5)
  })

  test('a negative publication age is treated as zero', () => {
    const history = [[1, 0, 0, 0]]
    const candidate = normalize([0.7, Math.sqrt(1 - 0.49), 0, 0])
    const items = [
      { item: { id: 1 }, cosine: 0.7, ageHours: -12, tieUserId: 1, tieId: 1, vector: candidate },
      { item: { id: 2 }, cosine: 0.7, ageHours: 0, tieUserId: 1, tieId: 2, vector: candidate }
    ]
    const ranked = zorroRank(items)
    expect(ranked[0].sim1).toBeCloseTo(ranked[1].sim1, 12)
    expect(ranked.map(entry => entry.item.id)).toEqual([1, 2])
  })

  test('matches the literal full-history reference across seeded candidate sets', () => {
    for (const seed of [7, 11, 23]) {
      const rng = createRng(seed)
      const history = clusteredVectors(rng, 12, 4)
      const profile = normalizedSum(history)
      if (!profile) throw new Error('degenerate reference profile')
      const candidates = Array.from({ length: 60 }, (_, index) => {
        const vector = randomUnitVector(rng)
        return {
          item: { id: index + 1 },
          cosine: cosineSimilarity(profile, vector),
          ageHours: Math.floor(rng() * 1000),
          tieUserId: 1 + (index % 3),
          tieId: index + 1,
          vector
        }
      })
      const ranked = zorroRank(candidates)
      const reference = zorroOrderLiteral(
        candidates.map(entry => ({ ...entry, id: entry.item.id })),
        history
      )
      expect(ranked.map(entry => entry.item.id)).toEqual(reference.map(entry => entry.id))
      expect(ranked[0].sim1).toBeCloseTo(1, 10)
      const literalSim1 = zorroSim1AllLiteral(candidates.map(entry => ({ ...entry, id: entry.item.id })))
      const literalById = new Map(candidates.map((entry, index) => [entry.item.id, literalSim1[index]]))
      for (const entry of ranked) expect(entry.sim1).toBeCloseTo(literalById.get(entry.item.id)!, 10)
    }
  })

  test('orders non-positive cosines by the literal decayed product', () => {
    const history = [[1, 0, 0, 0]]
    const weak = normalize([0.05, Math.sqrt(1 - 0.0025), 0, 0])
    const orthogonal = [0, 1, 0, 0]
    const negative = normalize([-0.2, Math.sqrt(1 - 0.04), 0, 0])
    const items = [
      { item: { id: 1 }, cosine: -0.2, ageHours: 0, tieUserId: 1, tieId: 1, vector: negative },
      { item: { id: 2 }, cosine: -0.2, ageHours: 96, tieUserId: 1, tieId: 2, vector: negative },
      { item: { id: 3 }, cosine: 0, ageHours: 0, tieUserId: 1, tieId: 3, vector: orthogonal },
      { item: { id: 4 }, cosine: 0.05, ageHours: 0, tieUserId: 1, tieId: 4, vector: weak }
    ]
    const ranked = zorroRank(items)
    const reference = zorroOrderLiteral(
      items.map(entry => ({ ...entry, id: entry.item.id })),
      history
    )
    expect(ranked.map(entry => entry.item.id)).toEqual(reference.map(entry => entry.id))
    expect(ranked.map(entry => entry.item.id)).toEqual([4, 3, 2, 1])
    expect(-0.2 * Math.exp(-0.015 * 96)).toBeGreaterThan(-0.2)
  })

  test('without positive cosines the Sim1 scale is the largest decay', () => {
    const history = [[1, 0, 0, 0]]
    const items = [
      {
        item: { id: 1 },
        cosine: -0.5,
        ageHours: 10,
        tieUserId: 1,
        tieId: 1,
        vector: normalize([-0.5, Math.sqrt(1 - 0.25), 0, 0])
      },
      {
        item: { id: 2 },
        cosine: -0.2,
        ageHours: 0,
        tieUserId: 1,
        tieId: 2,
        vector: normalize([-0.2, Math.sqrt(1 - 0.04), 0, 0])
      }
    ]
    const ranked = zorroRank(items)
    expect(ranked.map(entry => entry.item.id)).toEqual([2, 1])
    const literal = zorroSim1AllLiteral(items.map((entry, index) => ({ ...entry, id: index + 1 })))
    expect(ranked[0].sim1).toBeCloseTo(literal[1], 12)
    expect(ranked[1].sim1).toBeCloseTo(literal[0], 12)
  })

  test('breaks exact score ties by (tieUserId, tieId) ascending', () => {    const history = [[1, 0, 0, 0]]
    const candidate = normalize([0.6, 0.8, 0, 0])
    const items = [
      { item: { id: 30 }, cosine: 0.6, ageHours: 10, tieUserId: 2, tieId: 5, vector: candidate },
      { item: { id: 10 }, cosine: 0.6, ageHours: 10, tieUserId: 1, tieId: 9, vector: candidate },
      { item: { id: 20 }, cosine: 0.6, ageHours: 10, tieUserId: 1, tieId: 4, vector: candidate }
    ]
    const ranked = zorroRank(items)
    expect(ranked.map(entry => entry.item.id)).toEqual([20, 10, 30])
    expect(ranked[1].sim1).toBeCloseTo(ranked[0].sim1, 12)
    expect(ranked[2].sim1).toBeCloseTo(ranked[0].sim1, 12)
  })
})

const withMean = (terms: Array<[number, number]>) => {
  const vector = [...EMBEDDING_MEAN.values]
  for (const [axis, value] of terms) vector[axis] += value
  return vector
}

describe('representation centering', () => {
  test('center subtracts the versioned mean and renormalizes', () => {
    const rng = createRng(5)
    const vector = Array.from({ length: 1024 }, () => gaussian(rng))
    const centered = center(vector)
    const expected = normalize(vector.map((value, index) => value - EMBEDDING_MEAN.values[index]))
    centered.forEach((value, index) => expect(value).toBeCloseTo(expected[index], 12))
    expect(() => center([1, 0])).toThrow('invalid_vector_dimensions')
  })

  test('centers article actions before Ward clustering and medoid selection', () => {
    const rng = createRng(17)
    const vectors = clusteredVectors(rng, 40, 5, 0.35, 1024)
    const actions = vectors.map((vector, index) => ({ bookmarkId: 500 + index, vector, actedAt: NOW - (index % 30) * DAY_MS }))
    const actual = interestClusters(actions, NOW, center)
    const reference = interestClustersLiteral(actions, NOW)
    expect(actual.map(cluster => cluster.medoidBookmarkId)).toEqual(reference.map(cluster => cluster.medoidBookmarkId))
    for (let index = 0; index < actual.length; index++) expect(actual[index].importance).toBeCloseTo(reference[index].importance, 5)
  })

  test('raw-similar but centered-opposite actions do not cluster', () => {
    const actions = [
      { bookmarkId: 101, vector: withMean([[0, 0.05]]), actedAt: NOW },
      { bookmarkId: 102, vector: withMean([[0, -0.05]]), actedAt: NOW }
    ]
    expect(interestClusters(actions, NOW, center)).toEqual([])
    const raw = interestClusters(actions, NOW)
    expect(raw).toHaveLength(1)
    expect(raw[0].importance).toBe(2)
    expect(interestClustersLiteral(actions, NOW)).toEqual([])
  })

  test('ZoRRO order follows the exact centered profile rather than raw cosine', () => {
    const rng = createRng(1)
    const history = Array.from({ length: 6 }, () => randomUnitVector(rng, 1024))
    const candidates = Array.from({ length: 8 }, () => randomUnitVector(rng, 1024))
    const centeredProfile = normalizedSum(history.map(referenceCenter))!
    const rawProfile = normalizedSum(history)!
    const items = candidates.map((vector, index) => ({
      item: { id: index },
      cosine: referenceCosine(centeredProfile, referenceCenter(vector)),
      ageHours: 0,
      tieUserId: 1,
      tieId: index,
      vector
    }))
    const ranked = zorroRank(items)
    const centeredOrder = zorroOrderCenteredLiteral(items.map(entry => ({ ...entry, id: entry.item.id })), history)
    expect(ranked.map(entry => entry.item.id)).toEqual(centeredOrder.map(entry => entry.id))
    const rawOrder = candidates
      .map((vector, index) => [index, referenceCosine(rawProfile, vector)] as const)
      .sort((first, second) => second[1] - first[1])
      .map(entry => entry[0])
    expect(ranked.map(entry => entry.item.id)).not.toEqual(rawOrder)
  })

  test('MMR Sim2 uses raw representatives, not centered cosine', () => {
    const rng = createRng(80)
    const ranked = Array.from({ length: 4 }, (_, index) => ({
      item: { id: index },
      sim1: 1 - index * 0.05,
      vector: randomUnitVector(rng, 1024)
    }))
    const referenceInput = ranked.map((entry, index) => ({ ...entry, id: index, cosine: entry.sim1, ageHours: 0, tieUserId: 1, tieId: index }))
    const selected = mmrSelect(ranked, 4, MMR_LAMBDA)
    const raw = mmrSelectLiteral(referenceInput, 4, MMR_LAMBDA)
    const centered = mmrSelectLiteral(referenceInput, 4, MMR_LAMBDA, centeredCosine)
    expect(selected.map(item => item.id)).toEqual(raw.map(index => ranked[index].item.id))
    expect(raw).not.toEqual(centered)
  })
})

describe('PinnerSage Ward clustering', () => {
  const angleVector = (cosine: number) => [cosine, Math.sqrt(1 - cosine * cosine), 0, 0]

  test('two single actions merge at the calibrated centered cosine boundary and stay separate below it', () => {
    const separate = (cosine: number) => [[1, 0, 0, 0], angleVector(cosine)]
    // Ward height is 2(1 - cos); centered alpha = 1.6459373070 corresponds to cos = 0.1770313465.
    expect(1 - PINNERSAGE_ALPHA / 2).toBeCloseTo(0.1770313465, 10)
    expect(wardClusters(separate(0.18), PINNERSAGE_ALPHA)).toEqual([[0, 1]])
    expect(wardClusters(separate(0.17), PINNERSAGE_ALPHA)).toEqual([])
  })

  test('keeps disjoint below-alpha clusters and excludes never-merged indices', () => {
    const vectors = [
      [1, 0, 0, 0],
      angleVector(0.9),
      [0, 0, 1, 0],
      [0, Math.sqrt(1 - 0.85 * 0.85), 0.85, 0],
      [-1, 0, 0, 0],
      [0, -1, 0, 0]
    ]
    const clusters = wardClusters(vectors, PINNERSAGE_ALPHA)
    expect(clusters).toEqual([[0, 1], [2, 3]])
    expect(partitionOf(clusters)).toEqual(partitionOf(wardClustersLiteral(vectors, PINNERSAGE_ALPHA)))
  })

  test('matches the naive O(m^3) reference on clustered seeded vectors', () => {
    const cases: Array<{ seed: number; count: number; centers: number; noise: number; alphas: number[] }> = [
      { seed: 7, count: 90, centers: 9, noise: 0.3, alphas: [0.1, 0.2, 0.4, 0.8] },
      { seed: 29, count: 120, centers: 6, noise: 0.3, alphas: [0.4] },
      { seed: 5, count: 300, centers: 15, noise: 0.35, alphas: [0.4] }
    ]
    for (const { seed, count, centers, noise, alphas } of cases) {
      const rng = createRng(seed)
      const vectors = clusteredVectors(rng, count, centers, noise)
      for (const alpha of alphas) {
        const actual = wardClusters(vectors, alpha)
        const reference = wardClustersLiteral(vectors, alpha)
        expect(partitionOf(actual)).toEqual(partitionOf(reference))
        for (const cluster of actual) {
          expect([...cluster].sort((a, b) => a - b)).toEqual(cluster)
          expect(cluster.length).toBeGreaterThanOrEqual(2)
        }
        const firstMembers = actual.map(cluster => cluster[0])
        expect(firstMembers).toEqual([...firstMembers].sort((a, b) => a - b))
      }
    }
  })

  test('leaves orthogonal representatives unclustered', () => {
    const vectors = Array.from({ length: 80 }, (_, index) => Array.from({ length: 1024 }, (_, axis) => (axis === index ? 1 : 0)))
    expect(wardClusters(vectors, PINNERSAGE_ALPHA)).toEqual([])
  })
})

describe('medoid selection', () => {
  test('returns the literal argmin of summed squared distances', () => {
    const vectors = [
      [1, 0, 0, 0],
      [Math.cos(Math.PI / 6), Math.sin(Math.PI / 6), 0, 0],
      [Math.cos(Math.PI / 3), Math.sin(Math.PI / 3), 0, 0]
    ]
    expect(medoidIndex(vectors, [0, 1, 2])).toBe(1)
    expect(medoidIndex(vectors, [0, 1, 2])).toBe(medoidIndexLiteral(vectors, [0, 1, 2]))
  })

  test('breaks equal-cost ties toward the smaller index', () => {
    const vectors = [
      [1, 0, 0, 0],
      [0, 1, 0, 0],
      [1, 0, 0, 0],
      [0.9, 0.1, 0, 0]
    ]
    expect(medoidIndex(vectors, [0, 1, 2])).toBe(0)
    expect(medoidIndex(vectors, [2, 1, 0])).toBe(0)
  })

  test('treats scores within the relative 1e-9 tolerance as tied and prefers the smaller index', () => {
    const angle = (cosine: number) => [cosine, Math.sqrt(1 - cosine * cosine), 0, 0]
    const base = Math.cos(Math.PI / 6)
    // Index 2 is the exact argmin by ~2e-12 of relative cost, inside the tolerance,
    // so the tie resolves to the smaller index 1.
    const nearTie = [[1, 0, 0, 0], angle(base), angle(base + 1e-12)]
    expect(medoidIndex(nearTie, [0, 1, 2])).toBe(1)
    expect(medoidIndex(nearTie, [0, 1, 2])).toBe(medoidIndexLiteral(nearTie, [0, 1, 2], { tolerance: 1e-9 }))
    // Outside the tolerance the exact argmin (index 2) wins.
    const beyondTolerance = [[1, 0, 0, 0], angle(base), angle(base + 1e-4)]
    expect(medoidIndex(beyondTolerance, [0, 1, 2])).toBe(2)
    expect(medoidIndex(beyondTolerance, [0, 1, 2])).toBe(medoidIndexLiteral(beyondTolerance, [0, 1, 2], { tolerance: 1e-9 }))
  })

  test('matches the reference on seeded clusters', () => {
    const rng = createRng(41)
    const vectors = clusteredVectors(rng, 200, 12)
    for (let trial = 0; trial < 20; trial++) {
      const start = Math.floor(rng() * 180)
      const members = Array.from({ length: 2 + Math.floor(rng() * 18) }, (_, offset) => start + offset).filter(
        index => index < 200
      )
      expect(medoidIndex(vectors, members)).toBe(medoidIndexLiteral(vectors, members))
    }
  })
})

describe('cluster importance', () => {
  test('sums the per-action decay in days', () => {
    const actedAt = [NOW, NOW - 10 * DAY_MS, NOW - 100 * DAY_MS]
    const expected = 1 + Math.exp(-0.1) + Math.exp(-1)
    const importance = clusterImportance(actedAt, NOW, PINNERSAGE_IMPORTANCE_DECAY_PER_DAY)
    expect(importance).toBeCloseTo(expected, 12)
    expect(importance).toBeCloseTo(clusterImportanceLiteral(actedAt, NOW, PINNERSAGE_IMPORTANCE_DECAY_PER_DAY), 12)
  })

  test('is empty for an empty cluster', () => {
    expect(clusterImportance([], NOW, PINNERSAGE_IMPORTANCE_DECAY_PER_DAY)).toBe(0)
  })
})

describe('interest clusters', () => {
  const action = (bookmarkId: number, vector: number[], daysAgo: number): InterestAction => ({
    bookmarkId,
    vector,
    actedAt: NOW - daysAgo * DAY_MS
  })

  test('orders by importance then medoid id and rounds to six significant digits', () => {
    const actions = [
      action(101, [1, 0, 0, 0], 0),
      action(102, [0.95, Math.sqrt(1 - 0.9025), 0, 0], 3),
      action(201, [0, 1, 0, 0], 1),
      action(202, [0, 0.9, Math.sqrt(1 - 0.81), 0], 40)
    ]
    const clusters = interestClusters(actions, NOW)
    expect(clusters.map(cluster => cluster.medoidBookmarkId)).toEqual([101, 201])
    expect(clusters[0].importance).toBeCloseTo(Number((1 + Math.exp(-0.03)).toPrecision(6)), 12)
    expect(clusters[1].importance).toBeCloseTo(Number((Math.exp(-0.01) + Math.exp(-0.4)).toPrecision(6)), 12)
    for (const cluster of clusters) expect(cluster.importance).toBe(Number(cluster.importance.toPrecision(6)))
    const reference = interestClustersLiteral(actions, NOW, vector => vector)
    expect(clusters.map(cluster => cluster.medoidBookmarkId)).toEqual(reference.map(cluster => cluster.medoidBookmarkId))
  })

  test('groups duplicate bookmark actions and never creates a self-cluster from them', () => {
    const actions = [
      action(101, [1, 0, 0, 0], 0),
      action(101, [1, 0, 0, 0], 10),
      action(202, [0, 1, 0, 0], 5)
    ]
    expect(interestClusters(actions, NOW)).toEqual([])
    expect(interestClustersLiteral(actions, NOW, vector => vector)).toEqual([])
  })

  test('sums save and star decay terms for one article and keeps the smaller bookmark id on ties', () => {
    const near = [0.95, Math.sqrt(1 - 0.9025), 0, 0]
    const starred = interestClusters([action(101, [1, 0, 0, 0], 0), action(101, [1, 0, 0, 0], 10), action(202, near, 5)], NOW)
    expect(starred).toHaveLength(1)
    expect(starred[0].medoidBookmarkId).toBe(101)
    expect(starred[0].importance).toBeCloseTo(Number((1 + Math.exp(-0.1) + Math.exp(-0.05)).toPrecision(6)), 10)
    const unstarred = interestClusters([action(101, [1, 0, 0, 0], 0), action(202, near, 5)], NOW)
    expect(unstarred[0].importance).toBeCloseTo(Number((1 + Math.exp(-0.05)).toPrecision(6)), 10)
    expect(interestClustersLiteral([action(101, [1, 0, 0, 0], 0), action(101, [1, 0, 0, 0], 10), action(202, near, 5)], NOW, vector => vector)).toEqual(starred)
  })

  test('resolves a near-tied medoid by bookmark id and a genuine cost gap by cost', () => {
    const base = Math.cos(Math.PI / 6)
    const close = (offset: number) => [base + offset, Math.sqrt(1 - (base + offset) ** 2), 0, 0]
    const nearTie = interestClusters(
      [action(500, [1, 0, 0, 0], 0), action(900, close(1e-12), 0), action(100, close(0), 0)],
      NOW
    )
    expect(nearTie).toHaveLength(1)
    expect(nearTie[0].medoidBookmarkId).toBe(100)
    expect(interestClustersLiteral([action(500, [1, 0, 0, 0], 0), action(900, close(1e-12), 0), action(100, close(0), 0)], NOW, vector => vector)).toEqual(nearTie)
    const beyondTolerance = interestClusters(
      [action(500, [1, 0, 0, 0], 0), action(900, close(0), 0), action(100, close(-1e-4), 0)],
      NOW
    )
    expect(beyondTolerance).toHaveLength(1)
    expect(beyondTolerance[0].medoidBookmarkId).toBe(900)
    expect(interestClustersLiteral([action(500, [1, 0, 0, 0], 0), action(900, close(0), 0), action(100, close(-1e-4), 0)], NOW, vector => vector)).toEqual(beyondTolerance)
  })

  test('caps stored clusters at 100, ordered by importance', () => {
    const rng = createRng(3)
    const actions: InterestAction[] = []
    for (let pair = 0; pair < 102; pair++) {
      const base = randomUnitVector(rng)
      // Identical pairs keep every two-member cluster an exact medoid tie (smaller index wins)
      // and exercise only the 100-cluster cap and its ordering.
      actions.push(action(1000 + pair * 2, base, 0))
      actions.push(action(1001 + pair * 2, base, 0))
    }
    const clusters = interestClusters(actions, NOW)
    expect(clusters).toHaveLength(100)
    expect(new Set(clusters.map(cluster => cluster.medoidBookmarkId)).size).toBe(100)
    const importances = clusters.map(cluster => cluster.importance)
    expect(importances).toEqual([...importances].sort((a, b) => b - a))
    const reference = interestClustersLiteral(actions, NOW, vector => vector)
    expect(clusters.map(cluster => cluster.medoidBookmarkId)).toEqual(reference.map(cluster => cluster.medoidBookmarkId))
  })

  test('matches the reference on seeded action histories', () => {
    for (const seed of [17, 31]) {
      const rng = createRng(seed)
      const vectors = clusteredVectors(rng, 60, 6, 0.3)
      const actions = vectors.map((vector, index) => action(500 + index, vector, Math.floor(rng() * 89)))
      const actual = interestClusters(actions, NOW)
      const reference = interestClustersLiteral(actions, NOW, vector => vector)
      expect(actual.map(cluster => cluster.medoidBookmarkId)).toEqual(reference.map(cluster => cluster.medoidBookmarkId))
      for (let index = 0; index < actual.length; index++) expectClose(actual[index].importance, reference[index].importance)
    }
  })
})

describe('interest sampling', () => {
  const cluster = (medoidBookmarkId: number, importance: number): InterestCluster => ({ medoidBookmarkId, importance })

  test('is deterministic per user and UTC date and changes across dates', async () => {
    const clusters = [1, 2, 3, 4, 5, 6, 7, 8].map(id => cluster(id, id))
    const first = await sampleInterests(42, '2026-11-05', clusters, 3)
    expect(await sampleInterests(42, '2026-11-05', clusters, 3)).toEqual(first)
    const dateOutputs = new Set<string>()
    for (const day of ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09']) {
      dateOutputs.add((await sampleInterests(42, day, clusters, 3)).join(','))
    }
    expect(dateOutputs.size).toBeGreaterThan(1)
    const userOutputs = new Set<string>()
    for (const userId of [41, 42, 43, 44, 45]) {
      userOutputs.add((await sampleInterests(userId, '2026-11-05', clusters, 3)).join(','))
    }
    expect(userOutputs.size).toBeGreaterThan(1)
  })

  test('matches the reference sample for seeded clusters and dates', async () => {
    for (const seed of [5, 13]) {
      const rng = createRng(seed)
      const clusters = Array.from({ length: 6 }, (_, index) => cluster(100 + index, 1 + Math.round(rng() * 40) / 4))
      for (let day = 1; day <= 5; day++) {
        const utcDate = `2026-11-${String(day).padStart(2, '0')}`
        const actual = await sampleInterests(7 + seed, utcDate, clusters, 3)
        const reference = sampleInterestsLiteral(7 + seed, utcDate, clusters as ReferenceCluster[], 3)
        expect(actual).toEqual(reference)
      }
    }
  })

  test('returns at most k distinct medoids and handles k >= cluster count', async () => {
    const clusters = [1, 2, 3].map(id => cluster(id, id))
    const sampled = await sampleInterests(9, '2026-11-05', clusters, 3)
    expect(new Set(sampled).size).toBe(3)
    expect([...sampled].sort((a, b) => a - b)).toEqual([1, 2, 3])
    expect(await sampleInterests(9, '2026-11-05', clusters, 10)).toHaveLength(3)
    expect(await sampleInterests(9, '2026-11-05', [], 3)).toEqual([])
    expect(await sampleInterests(9, '2026-11-05', clusters, 0)).toEqual([])
  })

  test('never samples a zero-importance cluster', async () => {
    const clusters = [cluster(1, 0), cluster(2, 1)]
    expect(await sampleInterests(9, '2026-11-05', clusters, 2)).toEqual([2])
    expect(sampleInterestsLiteral(9, '2026-11-05', clusters as ReferenceCluster[], 2)).toEqual([2])
  })

  test('samples medoids roughly proportionally to importance', async () => {
    const clusters = [cluster(1, 4), cluster(2, 2), cluster(3, 1)]
    const counts = new Map<number, number>([
      [1, 0],
      [2, 0],
      [3, 0]
    ])
    for (let day = 0; day < 1500; day++) {
      const date = new Date(Date.UTC(2026, 0, 1) + day * DAY_MS).toISOString().slice(0, 10)
      const [picked] = await sampleInterests(77, date, clusters, 1)
      counts.set(picked, counts.get(picked)! + 1)
    }
    const first = counts.get(1)!
    const second = counts.get(2)!
    const third = counts.get(3)!
    expect(first).toBeGreaterThan(second)
    expect(second).toBeGreaterThan(third)
    expect(first / second).toBeGreaterThan(1.4)
    expect(first / second).toBeLessThan(2.8)
    expect(second / third).toBeGreaterThan(1.3)
    expect(second / third).toBeLessThan(3.2)
  })
})

describe('MMR diversification', () => {
  const rankedItem = (id: number, sim1: number, vector: number[]) => ({ item: { id }, sim1, vector })

  const referenceSelection = (ranked: Array<{ sim1: number; vector: number[] }>, limit: number) =>
    mmrSelectLiteral(
      ranked.map((entry, index) => ({
        ...entry,
        id: index,
        cosine: entry.sim1,
        ageHours: 0,
        tieUserId: 1,
        tieId: index
      })),
      limit,
      MMR_LAMBDA
    )

  test('prefers a less relevant but dissimilar item over a near duplicate', () => {
    const ranked = [
      rankedItem(1, 1, [1, 0]),
      rankedItem(2, 0.9, [Math.cos(Math.PI / 22.5), Math.sin(Math.PI / 22.5)]),
      rankedItem(3, 0.85, [0, 1]),
      rankedItem(4, 0.5, [-1, 0])
    ]
    const selected = mmrSelect(ranked, 4, MMR_LAMBDA)
    expect(selected.map(mmrId)).toEqual([1, 4, 3, 2])
    expect(selected.map(mmrId)).toEqual(referenceSelection(ranked, 4).map(index => ranked[index].item.id))
  })

  test('breaks equal MMR scores by earlier position', () => {
    const ranked = [rankedItem(1, 1, [1, 0]), rankedItem(2, 1, [0, 1]), rankedItem(3, 0.5, [-1, 0])]
    expect(mmrSelect(ranked, 2, MMR_LAMBDA).map(mmrId)).toEqual([1, 2])
  })

  test('matches the literal greedy reference on seeded rankings', () => {
    for (const seed of [2, 19, 37]) {
      const rng = createRng(seed)
      const vectors = clusteredVectors(rng, 50, 8, 0.7)
      const ranked = vectors
        .map((vector, index) => rankedItem(index + 1, rng(), vector))
        .sort((a, b) => b.sim1 - a.sim1)
      const selected = mmrSelect(ranked, 10, MMR_LAMBDA)
      expect(selected.map(mmrId)).toEqual(referenceSelection(ranked, 10).map(index => ranked[index].item.id))
      expect(selected).toHaveLength(10)
    }
  })

  test('returns the whole ranked list when the limit exceeds it', () => {
    const ranked = [rankedItem(1, 0.9, [1, 0]), rankedItem(2, 0.4, [0, 1])]
    expect(mmrSelect(ranked, 5, MMR_LAMBDA).map(mmrId)).toEqual([1, 2])
    expect(mmrSelect([], 5, MMR_LAMBDA)).toEqual([])
  })
})
