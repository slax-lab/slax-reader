import { normalized } from '@/utils/vectorEmbedding'
import type { ArticleQueryOptions, VectorIndexKind, VectorQueryOptions } from '@/utils/vectorMaintenanceTypes'

export type VectorIndexRpc = Pick<VectorIndexRepo, 'getVectorsByIds' | 'upsertVectors' | 'deleteVectorsByIds' | 'queryVectors'>

export class VectorIndexRepo {
  constructor(private readonly env: Env) {}

  private nativeIndex(kind: VectorIndexKind): Vectorize {
    const index = { article: this.env.VECTOR_V5_ARTICLE, collection: this.env.VECTOR_V5_COLLECTION, user: this.env.VECTOR_V5_USER }[kind]
    if (!index) throw new Error('missing_v5_index')
    return index as unknown as Vectorize
  }

  private checkIds(kind: VectorIndexKind, ids: string[]) {
    const pattern = { article: /^a:[1-9]\d*:[1-9]\d*(?::c:\d+)?$/, collection: /^c:[1-9]\d*$/, user: /^u:[1-9]\d*:(article(?::centered)?|collection)$/ }[kind]
    if (!pattern || !Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some(id => !pattern.test(id))) throw new Error('invalid_v5_ids')
  }

  async upsertVectors(kind: VectorIndexKind, vectors: VectorizeVector[]): Promise<VectorizeAsyncMutation> {
    if (!Array.isArray(vectors) || !vectors.length || vectors.length > 100) throw new Error('invalid_v5_batch')
    this.checkIds(
      kind,
      vectors.map(vector => vector.id)
    )
    if (new TextEncoder().encode(JSON.stringify(vectors)).length > 4 * 1024 * 1024) throw new Error('v5_payload_too_large')
    for (const vector of vectors) {
      vector.values = normalized(vector.values)
      const metadata = vector.metadata
      const parts = vector.id.split(':')
      if (kind === 'user') {
        if (vector.namespace !== `user-${parts[2]}`) throw new Error('invalid_v5_namespace')
      } else {
        if (vector.namespace) throw new Error('invalid_v5_namespace')
        if (
          !metadata ||
          (kind === 'collection' && typeof metadata.recommendable !== 'boolean') ||
          typeof metadata.published_at !== 'number' ||
          !Number.isFinite(metadata.published_at)
        )
          throw new Error('invalid_v5_metadata')
        if (kind === 'article') {
          if (metadata.user_id !== Number(parts[1]) || metadata.bookmark_id !== Number(parts[2]) || metadata.kind !== (parts.length === 3 ? 'article' : 'chunk'))
            throw new Error('invalid_v5_identity')
          if (parts.length === 3 ? !Number.isSafeInteger(metadata.part_count) || Number(metadata.part_count) < 1 : metadata.part_index !== Number(parts[4]))
            throw new Error('invalid_v5_part_metadata')
          if (!Number.isFinite(metadata.source_updated_at) || !Number.isSafeInteger(metadata.private_user) || Number(metadata.private_user) < 0)
            throw new Error('invalid_v5_metadata')
        }
        if (kind === 'collection' && (metadata.collection_id !== Number(parts[1]) || !Number.isSafeInteger(metadata.owner_id) || Number(metadata.owner_id) < 1))
          throw new Error('invalid_v5_identity')
      }
    }
    return this.nativeIndex(kind).upsert(vectors)
  }

  async deleteVectorsByIds(kind: VectorIndexKind, ids: string[]): Promise<VectorizeAsyncMutation> {
    this.checkIds(kind, ids)
    return this.nativeIndex(kind).deleteByIds(ids)
  }

  async getVectorsByIds(kind: VectorIndexKind, ids: string[]): Promise<VectorizeVector[]> {
    this.checkIds(kind, ids)
    return this.nativeIndex(kind).getByIds(ids)
  }

  async queryVectors(kind: 'article' | 'collection', vector: number[], options: ArticleQueryOptions | VectorQueryOptions): Promise<{ id: string; score: number }[]> {
    if (kind !== 'article' && kind !== 'collection') throw new Error('invalid_v5_query_index')
    const topK = options?.limit ?? 20
    if (!Number.isInteger(topK) || topK < 1 || topK > 100) throw new Error('invalid_v5_query_limit')
    const filter: VectorizeVectorMetadataFilter = {}
    if (kind === 'article') {
      const scope = options as ArticleQueryOptions
      const own = Number.isSafeInteger(scope?.userId) && Number(scope?.userId) > 0
      if (!own || scope?.recommendable !== undefined) throw new Error('invalid_v5_query_scope')
      filter.kind = 'article'
      filter.user_id = scope.userId!
    } else filter.recommendable = true
    const result = await this.nativeIndex(kind).query(normalized(vector), { topK, filter, returnValues: false, returnMetadata: 'none' })
    return result.matches.map(({ id, score }) => ({ id, score }))
  }

  private legacyIndex(shardIdx: number): VectorizeIndex {
    const indexes: VectorizeIndex[] = [this.env.VECTORIZE1, this.env.VECTORIZE2, this.env.VECTORIZE3, this.env.VECTORIZE4, this.env.VECTORIZE5]
    const index = indexes[shardIdx]
    if (!index) throw new Error(`invalid vectorize shard index: ${shardIdx}`)
    return index
  }

  async query(shardIdx: number, vector: number[], topK?: number, filter?: VectorizeVectorMetadataFilter): Promise<VectorizeMatches> {
    return this.legacyIndex(shardIdx).query(vector, { topK, filter })
  }

  async upsert(shardIdx: number, vectors: VectorizeVector[]): Promise<VectorizeVectorMutation> {
    return this.legacyIndex(shardIdx).upsert(vectors)
  }

  async deleteByIds(shardIdx: number, ids: string[]): Promise<VectorizeVectorMutation> {
    return this.legacyIndex(shardIdx).deleteByIds(ids)
  }
}
