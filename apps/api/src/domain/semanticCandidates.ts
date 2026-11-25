import { reportProviderFailure, type VectorEmbeddingClient } from '@/infra/external/vectorEmbedding'
import type { VectorIndexQueryOptions } from '@/utils/vectorMaintenanceTypes'
import { center, cosineSimilarity } from '@/utils/recommendationAlgorithms'
import { normalized } from '@/utils/vectorEmbedding'
import type { VectorSearchResponse } from '@/const/vectorSearch'

// V5 semantic retrieval: raw-vector candidates per query, returned with their values. 50 is the native topK limit when
// values are returned.
export const SEMANTIC_CANDIDATE_LIMIT = 50

/**
 * Untagged bookmark-search candidates for one user: embed the keyword, read the user's article vectors with their
 * values in one native query (the index stores raw representatives, so the raw query vector selects them), and score
 * each by cosine after removing the platform mean (EMBEDDING_MEAN). Raw V5 cosines sit in a narrow band where
 * unrelated text scores close to real matches. The caller filters by current ownership and then applies the floor and
 * relative bound. Runs in the Vector Worker, and in AI when the VECTOR_SEARCH binding is absent.
 */
// The article query the caller provides: the native repository in the Vector Worker, VectorIndexClient in AI.
export type ArticleVectorQuery = (vector: number[], options: VectorIndexQueryOptions) => Promise<{ id: string; score: number; values?: number[] }[]>

export async function semanticCandidates(
  embedding: Pick<VectorEmbeddingClient, 'query'>,
  queryArticles: ArticleVectorQuery,
  userId: number,
  keyword: string
): Promise<VectorSearchResponse> {
  let started = performance.now()
  let embedded: number[]
  try {
    embedded = await embedding.query(keyword)
  } catch (error) {
    // The query embedding has no retry above it, so this failure is final: report the provider diagnostic once.
    reportProviderFailure(error)
    throw error
  }
  const query = normalized(embedded)
  const embeddingMs = performance.now() - started
  started = performance.now()
  const matches = await queryArticles(query, { userId, limit: SEMANTIC_CANDIDATE_LIMIT, values: true })
  const queryMs = performance.now() - started
  const centeredQuery = center(query)
  const candidates = matches.flatMap(match => {
    const parts = /^a:([1-9]\d*):([1-9]\d*)$/.exec(match.id)
    if (!parts || Number(parts[1]) !== userId || !match.values || !Number.isFinite(match.score)) return []
    let values: number[]
    try {
      values = center(normalized(match.values))
    } catch {
      return []
    }
    return [{ id: Number(parts[2]), score: cosineSimilarity(centeredQuery, values) }]
  })
  candidates.sort((a, b) => b.score - a.score || a.id - b.id)
  return { candidates, timings: { embedding: Math.round(embeddingMs), query: Math.round(queryMs) } }
}
