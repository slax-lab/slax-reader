import { injectable } from '@/decorators/di'
import { EDGE_SECRET_HEADER } from '@/const/edge'
import { VECTOR_SEARCH_HOST, VECTOR_SEARCH_PATH, type VectorSearchRequest, type VectorSearchResponse } from '@/const/vectorSearch'

// A slow Vector Worker must not hold the search response; the semantic branch then fails like any other failure.
const VECTOR_SEARCH_TIMEOUT_MS = 5_000

/**
 * AI's side of the internal Vector search protocol (src/const/vectorSearch.ts). It calls the Vector Worker with a fetch
 * over the VECTOR_SEARCH service binding, so the handler runs in Vector's placement region; the edge shared secret
 * authenticates the call. `available` is false where the binding is absent (local isolated runs, tests).
 */
@injectable()
export class VectorSearchClient {
  private readonly service?: Fetcher
  private readonly secret: string

  constructor(env: Env) {
    this.service = env.VECTOR_SEARCH
    this.secret = env.EDGE_SHARED_SECRET
  }

  get available(): boolean {
    return !!this.service
  }

  async search(request: VectorSearchRequest): Promise<VectorSearchResponse> {
    if (!this.service) throw new Error('missing_vector_search_binding')
    if (!this.secret) throw new Error('missing_edge_shared_secret')
    const response = await this.service.fetch(`https://${VECTOR_SEARCH_HOST}${VECTOR_SEARCH_PATH}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', [EDGE_SECRET_HEADER]: this.secret },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(VECTOR_SEARCH_TIMEOUT_MS)
    })
    if (!response.ok) throw new Error(`vector_search_status_${response.status}`)
    const body = (await response.json()) as Partial<VectorSearchResponse>
    if (!Array.isArray(body.candidates) || body.candidates.some(item => !Number.isSafeInteger(item?.id) || item.id < 1 || !Number.isFinite(item?.score)))
      throw new Error('invalid_vector_search_response')
    return { candidates: body.candidates, timings: { embedding: Number(body.timings?.embedding) || 0, query: Number(body.timings?.query) || 0 } }
  }
}
