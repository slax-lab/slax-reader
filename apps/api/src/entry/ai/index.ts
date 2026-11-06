import { WorkerEntrypoint } from 'cloudflare:workers'
import coreWorker from '../core'
import { VectorIndexRepo } from '@/infra/repository/vectorIndexRepo'
import type { ArticleQueryOptions, VectorIndexKind, VectorQueryOptions } from '@/utils/vectorMaintenanceTypes'

export class AiEntry extends WorkerEntrypoint<Env> {
  private readonly vectors = new VectorIndexRepo(this.env)

  async upsertVectors(kind: VectorIndexKind, vectors: VectorizeVector[]): Promise<VectorizeAsyncMutation> {
    return this.vectors.upsertVectors(kind, vectors)
  }

  async deleteVectorsByIds(kind: VectorIndexKind, ids: string[]): Promise<VectorizeAsyncMutation> {
    return this.vectors.deleteVectorsByIds(kind, ids)
  }

  async getVectorsByIds(kind: VectorIndexKind, ids: string[]): Promise<VectorizeVector[]> {
    return this.vectors.getVectorsByIds(kind, ids)
  }

  async queryVectors(kind: 'article' | 'collection', vector: number[], options: ArticleQueryOptions | VectorQueryOptions): Promise<{ id: string; score: number }[]> {
    return this.vectors.queryVectors(kind, vector, options)
  }

  async query(shardIdx: number, vector: number[], topK?: number, filter?: VectorizeVectorMetadataFilter): Promise<VectorizeMatches> {
    return this.vectors.query(shardIdx, vector, topK, filter)
  }

  async upsert(shardIdx: number, vectors: VectorizeVector[]): Promise<VectorizeVectorMutation> {
    return this.vectors.upsert(shardIdx, vectors)
  }

  async deleteByIds(shardIdx: number, ids: string[]): Promise<VectorizeVectorMutation> {
    return this.vectors.deleteByIds(shardIdx, ids)
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return coreWorker.fetch(request, env, ctx)
  }
}
