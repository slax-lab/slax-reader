import { EDGE_SECRET_HEADER } from '@/const/edge'
import { VECTOR_SEARCH_HOST, VECTOR_SEARCH_MAX_KEYWORD, VECTOR_SEARCH_PATH, type VectorSearchRequest } from '@/const/vectorSearch'
import { semanticCandidates } from '@/domain/semanticCandidates'
import { VectorEmbeddingClient } from '@/infra/external/vectorEmbedding'
import { VectorIndexRepo } from '@/infra/repository/vectorIndexRepo'

// Vector answers untagged bookmark-search candidates beside the query encoder and the V5 article index. AI reaches it
// only with a fetch over VECTOR_SEARCH (src/const/vectorSearch.ts); a fetch, unlike an RPC call, runs in this
// Worker's placement region. It has no route or public hostname, and the edge shared secret authenticates the call.
function parseRequest(value: unknown): VectorSearchRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const { userId, keyword } = value as Record<string, unknown>
  if (!Number.isSafeInteger(userId) || (userId as number) < 1) return null
  if (typeof keyword !== 'string' || !keyword.trim() || [...keyword].length > VECTOR_SEARCH_MAX_KEYWORD) return null
  return { userId: userId as number, keyword }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (url.hostname !== VECTOR_SEARCH_HOST || url.pathname !== VECTOR_SEARCH_PATH || request.method !== 'POST') return new Response('Not Found', { status: 404 })
    const secret = env.EDGE_SHARED_SECRET
    if (!secret || request.headers.get(EDGE_SECRET_HEADER) !== secret) return new Response('Forbidden', { status: 403 })
    const body = parseRequest(await request.json().catch(() => null))
    if (!body) return new Response('Bad Request', { status: 400 })
    try {
      const index = new VectorIndexRepo(env)
      return Response.json(await semanticCandidates(new VectorEmbeddingClient(env), (vector, options) => index.queryVectors('article', vector, options), body.userId, body.keyword))
    } catch (error) {
      console.error(`[vector] search failed: ${error instanceof Error ? error.message : 'unknown error'}`)
      return new Response('Internal Server Error', { status: 500 })
    }
  }
}
