import { EMBEDDING_MEAN } from './embeddingMean'
import { normalized, VECTOR_DIMENSIONS, VECTOR_MODEL } from './vectorEmbedding'

if (EMBEDDING_MEAN.model !== VECTOR_MODEL || EMBEDDING_MEAN.dimensions !== VECTOR_DIMENSIONS || EMBEDDING_MEAN.values.length !== VECTOR_DIMENSIONS)
  throw new Error('invalid_embedding_mean')

export const EMBEDDING_MEAN_VERSION = EMBEDDING_MEAN.version
export const ZORRO_CANDIDATE_DECAY_PER_HOUR = 0.015
export const PINNERSAGE_WINDOW_DAYS = 90
export const PINNERSAGE_ALPHA = 1.645937307
export const PINNERSAGE_IMPORTANCE_DECAY_PER_DAY = 0.01
export const PINNERSAGE_SAMPLED_MEDOIDS = 3
export const PINNERSAGE_MAX_ACTIONS = 2000
export const PINNERSAGE_MAX_STORED_CLUSTERS = 100
export const MMR_LAMBDA = 0.7
export const MMR_CANDIDATES = 50
export const NATIVE_TOP_K = 100
export const CHANNEL_LIMIT = 100
export const POPULAR_WINDOW_HOURS = Math.log(100) / ZORRO_CANDIDATE_DECAY_PER_HOUR
export const PREVIEW_MEMBERS = 3

export function center(vector: number[]): number[] {
  if (vector.length !== VECTOR_DIMENSIONS) throw new Error('invalid_vector_dimensions')
  return normalized(vector.map((value, index) => value - EMBEDDING_MEAN.values[index]))
}

export interface InterestAction {
  bookmarkId: number
  vector: number[]
  actedAt: number
}

export interface InterestCluster {
  medoidBookmarkId: number
  importance: number
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (!left.length || left.length !== right.length) return 0
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index++) {
    if (!Number.isFinite(left[index]) || !Number.isFinite(right[index])) return 0
    dot += left[index] * right[index]
    leftNorm += left[index] ** 2
    rightNorm += right[index] ** 2
  }
  return leftNorm > 0 && rightNorm > 0 ? Math.max(-1, Math.min(1, dot / Math.sqrt(leftNorm * rightNorm))) : 0
}

export function wardClusters(vectors: number[][], alpha: number): number[][] {
  const count = vectors.length
  const distances = new Float64Array((count * (count - 1)) / 2)
  const offset = (i: number, j: number) => {
    const left = Math.min(i, j)
    const right = Math.max(i, j)
    return count * left - (left * (left + 1)) / 2 + right - left - 1
  }
  for (let i = 0; i < count; i++) {
    for (let j = i + 1; j < count; j++) {
      let dot = 0
      for (let dimension = 0; dimension < vectors[i].length; dimension++) dot += vectors[i][dimension] * vectors[j][dimension]
      distances[offset(i, j)] = Math.max(0, 2 - 2 * dot)
    }
  }
  const active = new Set(vectors.map((_, index) => index))
  const members = vectors.map((_, index) => [index])
  const merges: { members: number[]; distance: number; sequence: number }[] = []
  const stack: number[] = []
  while (active.size > 1) {
    let first = 0
    while (!active.has(first)) first++
    stack.push(first)
    while (stack.length) {
      const i = stack[stack.length - 1]
      if (active.size <= 1) break
      let nearest = -1
      let distance = Infinity
      for (const k of active) {
        if (k === i) continue
        const candidate = distances[offset(i, k)]
        if (candidate < distance || (candidate === distance && (nearest < 0 || k < nearest))) {
          nearest = k
          distance = candidate
        }
      }
      const j = stack[stack.length - 2]
      if (stack.length >= 2 && distances[offset(i, j)] === distance) {
        stack.pop()
        stack.pop()
        const ni = members[i].length
        const nj = members[j].length
        const merged = [...members[i], ...members[j]]
        merges.push({ members: merged, distance, sequence: merges.length })
        active.delete(j)
        for (const k of active) {
          if (k === i) continue
          const nk = members[k].length
          const ik = offset(i, k)
          distances[ik] = ((ni + nk) * distances[ik] + (nj + nk) * distances[offset(j, k)] - nk * distance) / (ni + nj + nk)
        }
        members[i] = merged
      } else stack.push(nearest)
    }
  }
  const selected: number[][] = []
  const used = new Set<number>()
  merges.sort((a, b) => b.distance - a.distance || b.sequence - a.sequence)
  for (const merge of merges) {
    if (merge.distance > alpha || merge.members.some(member => used.has(member))) continue
    const cluster = [...merge.members].sort((a, b) => a - b)
    selected.push(cluster)
    for (const member of cluster) used.add(member)
  }
  return selected.sort((a, b) => a[0] - b[0])
}

function selectMedoid(vectors: number[][], members: number[], compare: (left: number, right: number) => number): number {
  if (!members.length) return -1
  const sum = new Float64Array(vectors[members[0]].length)
  for (const member of members) {
    for (let dimension = 0; dimension < sum.length; dimension++) sum[dimension] += vectors[member][dimension]
  }
  let selected = members[0]
  let best = -Infinity
  for (const member of members) {
    let score = 0
    for (let dimension = 0; dimension < sum.length; dimension++) score += vectors[member][dimension] * sum[dimension]
    const tolerance = 1e-9 * Math.max(1, Math.abs(score), Math.abs(best))
    if (best === -Infinity || score > best + tolerance || (Math.abs(score - best) <= tolerance && compare(member, selected) < 0)) {
      selected = member
      best = score
    }
  }
  return selected
}

export function medoidIndex(vectors: number[][], members: number[]): number {
  return selectMedoid(vectors, members, (left, right) => left - right)
}

export function clusterImportance(actedAt: number[], now: number, lambdaPerDay: number): number {
  return actedAt.reduce((sum, time) => sum + Math.exp((-lambdaPerDay * (now - time)) / 86_400_000), 0)
}

export function interestClusters(actions: InterestAction[], now: number, transform: (vector: number[]) => number[] = vector => vector): InterestCluster[] {
  const byBookmark = new Map<number, { bookmarkId: number; vector: number[]; actedAt: number[] }>()
  for (const action of actions) {
    const bookmark = byBookmark.get(action.bookmarkId)
    if (bookmark) bookmark.actedAt.push(action.actedAt)
    else byBookmark.set(action.bookmarkId, { bookmarkId: action.bookmarkId, vector: action.vector, actedAt: [action.actedAt] })
  }
  const bookmarks = [...byBookmark.values()]
  const vectors = bookmarks.map(bookmark => transform(bookmark.vector))
  return wardClusters(vectors, PINNERSAGE_ALPHA)
    .map(members => ({
      medoidBookmarkId: bookmarks[selectMedoid(vectors, members, (left, right) => bookmarks[left].bookmarkId - bookmarks[right].bookmarkId)].bookmarkId,
      importance: clusterImportance(
        members.flatMap(member => bookmarks[member].actedAt),
        now,
        PINNERSAGE_IMPORTANCE_DECAY_PER_DAY
      )
    }))
    .sort((a, b) => b.importance - a.importance || a.medoidBookmarkId - b.medoidBookmarkId)
    .slice(0, PINNERSAGE_MAX_STORED_CLUSTERS)
    .map(cluster => ({ ...cluster, importance: Number(cluster.importance.toPrecision(6)) }))
}

export async function sampleInterests(userId: number, utcDate: string, clusters: InterestCluster[], k: number): Promise<number[]> {
  const keys = await Promise.all(
    clusters
      .filter(cluster => cluster.importance > 0)
      .map(async cluster => {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${userId}:${utcDate}:${cluster.medoidBookmarkId}`))
        const hash = new DataView(digest).getBigUint64(0, false)
        const uniform = (Number(hash >> 11n) + 0.5) / 2 ** 53
        return { id: cluster.medoidBookmarkId, key: Math.log(uniform) / cluster.importance }
      })
  )
  return keys
    .sort((a, b) => b.key - a.key || a.id - b.id)
    .slice(0, Math.max(0, k))
    .map(candidate => candidate.id)
}

export interface ZorroItem<T> {
  item: T
  cosine: number
  ageHours: number
  tieUserId: number
  tieId: number
  vector: number[]
}

export function zorroRank<T>(items: ZorroItem<T>[]): (ZorroItem<T> & { sim1: number })[] {
  const ranked = items.map(item => {
    const logDecay = -ZORRO_CANDIDATE_DECAY_PER_HOUR * Math.max(0, item.ageHours)
    return { item, logDecay, score: item.cosine > 0 ? logDecay + Math.log(item.cosine) : item.cosine * Math.exp(logDecay) }
  })
  let positiveMax = -Infinity
  let decayMax = -Infinity
  for (const candidate of ranked) {
    if (candidate.item.cosine > 0) positiveMax = Math.max(positiveMax, candidate.score)
    decayMax = Math.max(decayMax, candidate.logDecay)
  }
  const maximum = ranked.some(candidate => candidate.item.cosine > 0) ? positiveMax : decayMax
  ranked.sort((a, b) => Number(b.item.cosine > 0) - Number(a.item.cosine > 0) || b.score - a.score || a.item.tieUserId - b.item.tieUserId || a.item.tieId - b.item.tieId)
  return ranked.map(({ item, logDecay }) => ({ ...item, sim1: item.cosine * Math.exp(logDecay - maximum) }))
}

export function mmrSelect<T>(ranked: { item: T; sim1: number; vector: number[] }[], limit: number, lambda: number): T[] {
  const remaining = ranked.map(candidate => ({ ...candidate, redundancy: 0 }))
  const selected: T[] = []
  while (remaining.length && selected.length < limit) {
    let bestIndex = 0
    let bestScore = -Infinity
    for (let index = 0; index < remaining.length; index++) {
      const candidate = remaining[index]
      const score = lambda * candidate.sim1 - (1 - lambda) * candidate.redundancy
      if (score > bestScore) {
        bestIndex = index
        bestScore = score
      }
    }
    const [best] = remaining.splice(bestIndex, 1)
    selected.push(best.item)
    for (const candidate of remaining) {
      const similarity = cosineSimilarity(candidate.vector, best.vector)
      candidate.redundancy = selected.length === 1 ? similarity : Math.max(candidate.redundancy, similarity)
    }
  }
  return selected
}
