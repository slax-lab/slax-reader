import { createHash } from 'node:crypto'
import { EMBEDDING_MEAN } from '../../src/utils/embeddingMean'

// Independent reference for design.md section 6. Written straight from the published
// algorithms with no performance shortcuts. It must not import the production module.

export const REFERENCE_CANDIDATE_DECAY_PER_HOUR = 0.015
export const REFERENCE_HISTORY_DECAY_PER_HOUR = 0
export const REFERENCE_ALPHA = 1.6459373070
export const REFERENCE_IMPORTANCE_DECAY_PER_DAY = 0.01
export const REFERENCE_MMR_LAMBDA = 0.7
export const REFERENCE_MMR_CANDIDATES = 50
export const REFERENCE_POPULAR_WINDOW_HOURS = Math.log(100) / REFERENCE_CANDIDATE_DECAY_PER_HOUR

const DAY_MS = 86_400_000

export type ReferenceAction = { bookmarkId: number; vector: number[]; actedAt: number }

export type ReferenceCluster = { medoidBookmarkId: number; importance: number }

export type ReferenceRanked = {
  id: number
  vector: number[]
  cosine: number
  ageHours: number
  tieUserId: number
  tieId: number
}

export function dot(a: number[], b: number[]): number {
  let sum = 0
  for (let index = 0; index < a.length; index++) sum += a[index] * b[index]
  return sum
}

export function magnitude(vector: number[]): number {
  return Math.sqrt(dot(vector, vector))
}

export function referenceCosine(a: number[], b: number[]): number {
  const scale = magnitude(a) * magnitude(b)
  return scale === 0 ? 0 : dot(a, b) / scale
}

export function referenceCenter(vector: number[]): number[] {
  if (vector.length !== EMBEDDING_MEAN.values.length) throw new Error('invalid_vector_dimensions')
  const shifted = vector.map((value, index) => value - EMBEDDING_MEAN.values[index])
  const scale = magnitude(shifted)
  if (!Number.isFinite(scale) || scale <= 0) throw new Error('empty_vector')
  return shifted.map(value => value / scale)
}

export function centeredCosine(left: number[], right: number[]): number {
  return referenceCosine(referenceCenter(left), referenceCenter(right))
}

export function normalizedSum(vectors: number[][]): number[] | null {
  if (!vectors.length) return null
  const sum = new Array(vectors[0].length).fill(0)
  for (const vector of vectors) for (let index = 0; index < vector.length; index++) sum[index] += vector[index]
  const scale = magnitude(sum)
  return scale === 0 ? null : sum.map(value => value / scale)
}

// ZoRRO r(c) = phi_c(c) * sum_h cos(e_c, e_h) * phi_h(h), evaluated literally over the
// whole history list (no centroid) with phi_h = 1 because lambda_h = 0.
export function zorroScoreLiteral(candidate: number[], history: number[][], ageHours: number): number {
  const phiCandidate = Math.exp(-REFERENCE_CANDIDATE_DECAY_PER_HOUR * Math.max(0, ageHours))
  let historyTerm = 0
  for (const vector of history) {
    const phiHistory = Math.exp(-REFERENCE_HISTORY_DECAY_PER_HOUR * 0)
    historyTerm += referenceCosine(candidate, vector) * phiHistory
  }
  return phiCandidate * historyTerm
}

export function zorroOrderLiteral(candidates: ReferenceRanked[], history: number[][]): ReferenceRanked[] {
  return [...candidates].sort((a, b) => {
    const scoreA = zorroScoreLiteral(a.vector, history, a.ageHours)
    const scoreB = zorroScoreLiteral(b.vector, history, b.ageHours)
    if (scoreA !== scoreB) return scoreB - scoreA
    if (a.tieUserId !== b.tieUserId) return a.tieUserId - b.tieUserId
    return a.tieId - b.tieId
  })
}

export function zorroSim1ScaleLiteral(candidates: ReferenceRanked[]): number {
  let maxPositive = -Infinity
  let maxLogDecay = -Infinity
  for (const candidate of candidates) {
    const logDecay = -REFERENCE_CANDIDATE_DECAY_PER_HOUR * Math.max(0, candidate.ageHours)
    maxLogDecay = Math.max(maxLogDecay, logDecay)
    if (candidate.cosine > 0) maxPositive = Math.max(maxPositive, logDecay + Math.log(candidate.cosine))
  }
  return maxPositive === -Infinity ? maxLogDecay : maxPositive
}

export function zorroSim1AllLiteral(candidates: ReferenceRanked[]): number[] {
  const scale = zorroSim1ScaleLiteral(candidates)
  return candidates.map(candidate => {
    const logDecay = -REFERENCE_CANDIDATE_DECAY_PER_HOUR * Math.max(0, candidate.ageHours)
    return candidate.cosine * Math.exp(logDecay - scale)
  })
}

type Merge = { distance: number; members: number[] }

// Ward agglomerative clustering as naive O(m^3) agglomeration: merge the globally closest
// pair each step under the Lance-Williams update on squared Euclidean distance.
export function wardMergeHistory(vectors: number[][]): Merge[] {
  const count = vectors.length
  const distances: number[][] = Array.from({ length: count }, () => new Array(count).fill(0))
  const sizes = new Array(count).fill(1)
  const members: number[][] = vectors.map((_, index) => [index])
  const active = new Set<number>(Array.from({ length: count }, (_, index) => index))

  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      let squared = 0
      for (let dimension = 0; dimension < vectors[i].length; dimension++) {
        const delta = vectors[i][dimension] - vectors[j][dimension]
        squared += delta * delta
      }
      distances[i][j] = squared
      distances[j][i] = squared
    }
  }

  const merges: Merge[] = []
  while (active.size > 1) {
    let bestI = -1
    let bestJ = -1
    let bestDistance = Infinity
    for (const i of active) {
      for (const j of active) {
        if (j <= i) continue
        if (distances[i][j] < bestDistance) {
          bestDistance = distances[i][j]
          bestI = i
          bestJ = j
        }
      }
    }
    merges.push({ distance: bestDistance, members: [...members[bestI], ...members[bestJ]].sort((a, b) => a - b) })
    const sizeI = sizes[bestI]
    const sizeJ = sizes[bestJ]
    for (const k of active) {
      if (k === bestI || k === bestJ) continue
      const sizeK = sizes[k]
      const updated =
        ((sizeI + sizeK) * distances[bestI][k] + (sizeJ + sizeK) * distances[bestJ][k] - sizeK * distances[bestI][bestJ]) /
        (sizeI + sizeJ + sizeK)
      distances[bestI][k] = updated
      distances[k][bestI] = updated
    }
    members[bestI].push(...members[bestJ])
    sizes[bestI] = sizeI + sizeJ
    active.delete(bestJ)
  }
  return merges
}

// PinnerSage Algorithm 1 cut: walk the merge history from the largest distance down and
// keep a merged set when its distance is at most alpha and it is disjoint from every kept set.
export function wardClustersLiteral(vectors: number[][], alpha: number): number[][] {
  const merges = wardMergeHistory(vectors)
  const kept: number[][] = []
  for (let index = merges.length - 1; index >= 0; index--) {
    const merge = merges[index]
    if (merge.distance > alpha) continue
    const overlaps = kept.some(cluster => cluster.some(member => merge.members.includes(member)))
    if (overlaps) continue
    kept.push(merge.members)
  }
  kept.sort((a, b) => a[0] - b[0])
  return kept
}

export function medoidIndexLiteral(
  vectors: number[][],
  members: number[],
  options: { bookmarkIds?: number[]; tolerance?: number } = {}
): number {
  const tolerance = options.tolerance ?? 0
  let best = -1
  let bestCost = Infinity
  for (const medoid of members) {
    let cost = 0
    for (const member of members) {
      let squared = 0
      for (let dimension = 0; dimension < vectors[medoid].length; dimension++) {
        const delta = vectors[medoid][dimension] - vectors[member][dimension]
        squared += delta * delta
      }
      cost += squared
    }
    if (best < 0) {
      best = medoid
      bestCost = cost
      continue
    }
    const allowed = tolerance * Math.max(1, Math.abs(cost), Math.abs(bestCost))
    const tied = Math.abs(cost - bestCost) <= allowed
    const better = cost < bestCost - allowed
    const smaller = options.bookmarkIds ? options.bookmarkIds[medoid] < options.bookmarkIds[best] : medoid < best
    if (better || (tied && smaller)) {
      best = medoid
      bestCost = cost
    }
  }
  return best
}

export function clusterImportanceLiteral(actedAt: number[], now: number, lambdaPerDay: number): number {
  let importance = 0
  for (const time of actedAt) importance += Math.exp(-lambdaPerDay * ((now - time) / DAY_MS))
  return importance
}

// Actions are grouped by bookmark id: a save and a star of the same identity are one
// article in the clustering input, and a cluster's importance sums every action on its
// articles. Clustering a duplicated vector cannot create a cluster by itself.
export function interestClustersLiteral(
  actions: ReferenceAction[],
  now: number,
  transform: (vector: number[]) => number[] = referenceCenter
): ReferenceCluster[] {
  const grouped = new Map<number, { bookmarkId: number; vector: number[]; actedAt: number[] }>()
  for (const action of actions) {
    const entry = grouped.get(action.bookmarkId)
    if (entry) entry.actedAt.push(action.actedAt)
    else grouped.set(action.bookmarkId, { bookmarkId: action.bookmarkId, vector: action.vector, actedAt: [action.actedAt] })
  }
  const bookmarks = [...grouped.values()]
  const vectors = bookmarks.map(bookmark => transform(bookmark.vector))
  const bookmarkIds = bookmarks.map(bookmark => bookmark.bookmarkId)
  const clusters = wardClustersLiteral(vectors, REFERENCE_ALPHA)
  const result = clusters.map(members => {
    const medoid = medoidIndexLiteral(vectors, members, { bookmarkIds, tolerance: 1e-9 })
    const importance = clusterImportanceLiteral(
      members.flatMap(member => bookmarks[member].actedAt),
      now,
      REFERENCE_IMPORTANCE_DECAY_PER_DAY
    )
    return { medoidBookmarkId: bookmarkIds[medoid], importance: Number(importance.toPrecision(6)) }
  })
  result.sort((a, b) => b.importance - a.importance || a.medoidBookmarkId - b.medoidBookmarkId)
  return result.slice(0, 100)
}

export function weightedNormalizedSum(vectors: number[][], weights: number[]): number[] | null {
  if (!vectors.length) return null
  const sum = new Array(vectors[0].length).fill(0)
  for (let index = 0; index < vectors.length; index++) {
    for (let dimension = 0; dimension < vectors[index].length; dimension++) sum[dimension] += weights[index] * vectors[index][dimension]
  }
  const scale = magnitude(sum)
  return scale === 0 ? null : sum.map(value => value / scale)
}

function efraimidisKey(userId: number, utcDate: string, medoidBookmarkId: number, importance: number): number {
  const digest = createHash('sha256').update(`${userId}:${utcDate}:${medoidBookmarkId}`).digest()
  const high = BigInt(`0x${digest.subarray(0, 8).toString('hex')}`)
  const u = (Number(high >> 11n) + 0.5) / 2 ** 53
  return Math.log(u) / importance
}

export function sampleInterestsLiteral(userId: number, utcDate: string, clusters: ReferenceCluster[], k: number): number[] {
  return clusters
    .filter(cluster => cluster.importance > 0)
    .map(cluster => ({
      medoidBookmarkId: cluster.medoidBookmarkId,
      key: efraimidisKey(userId, utcDate, cluster.medoidBookmarkId, cluster.importance)
    }))
    .sort((a, b) => b.key - a.key || a.medoidBookmarkId - b.medoidBookmarkId)
    .slice(0, Math.max(0, k))
    .map(entry => entry.medoidBookmarkId)
}

// ZoRRO order with the centered relevance term: phi_c(c) * sum_h cos(center(e_c), center(e_h)).
export function zorroOrderCenteredLiteral(candidates: ReferenceRanked[], history: number[][]): ReferenceRanked[] {
  const centeredHistory = history.map(referenceCenter)
  return [...candidates].sort((a, b) => {
    const scoreA = zorroScoreFrom(centeredHistory, a)
    const scoreB = zorroScoreFrom(centeredHistory, b)
    if (scoreA !== scoreB) return scoreB - scoreA
    if (a.tieUserId !== b.tieUserId) return a.tieUserId - b.tieUserId
    return a.tieId - b.tieId
  })
}

function zorroScoreFrom(centeredHistory: number[][], candidate: ReferenceRanked): number {
  const phiCandidate = Math.exp(-REFERENCE_CANDIDATE_DECAY_PER_HOUR * Math.max(0, candidate.ageHours))
  const centeredCandidate = referenceCenter(candidate.vector)
  let historyTerm = 0
  for (const vector of centeredHistory) historyTerm += referenceCosine(centeredCandidate, vector)
  return phiCandidate * historyTerm
}

export function mmrSelectLiteral(
  ranked: Array<ReferenceRanked & { sim1: number }>,
  limit: number,
  lambda: number,
  similarity: (left: number[], right: number[]) => number = referenceCosine
): number[] {
  const selected: number[] = []
  const remaining = ranked.map((_, index) => index)
  while (selected.length < limit && remaining.length) {
    let bestPosition = -1
    let bestScore = -Infinity
    for (let position = 0; position < remaining.length; position++) {
      const candidate = ranked[remaining[position]]
      let redundancy = selected.length ? -Infinity : 0
      for (const chosen of selected) redundancy = Math.max(redundancy, similarity(candidate.vector, ranked[chosen].vector))
      const score = lambda * candidate.sim1 - (1 - lambda) * redundancy
      if (score > bestScore) {
        bestScore = score
        bestPosition = position
      }
    }
    selected.push(remaining[bestPosition])
    remaining.splice(bestPosition, 1)
  }
  return selected
}
