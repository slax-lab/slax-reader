// The internal protocol AI uses to ask the Vector Worker for untagged bookmark-search candidates over the
// VECTOR_SEARCH service binding. It travels as a fetch, not an RPC call, because placement applies only to fetch:
// Vector then runs beside the query encoder and the V5 article index. Shared by both entries.
export const VECTOR_SEARCH_HOST = 'vector.internal'
export const VECTOR_SEARCH_PATH = '/search'
// Same bound as the /v1/bookmark/search keyword.
export const VECTOR_SEARCH_MAX_KEYWORD = 500

export interface VectorSearchRequest {
  userId: number
  keyword: string
}

export interface VectorSearchCandidate {
  id: number
  score: number
}

export interface VectorSearchResponse {
  candidates: VectorSearchCandidate[]
  timings: { embedding: number; query: number }
}
