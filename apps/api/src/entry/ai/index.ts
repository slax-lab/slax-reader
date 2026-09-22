import { WorkerEntrypoint } from 'cloudflare:workers'
import coreWorker from '../core'

export class AiEntry extends WorkerEntrypoint<Env> {
  private index(shardIdx: number): VectorizeIndex {
    const indexes: VectorizeIndex[] = [this.env.VECTORIZE1, this.env.VECTORIZE2, this.env.VECTORIZE3, this.env.VECTORIZE4, this.env.VECTORIZE5]
    const index = indexes[shardIdx]
    if (!index) throw new Error(`invalid vectorize shard index: ${shardIdx}`)
    return index
  }

  async query(shardIdx: number, vector: number[], topK?: number, filter?: VectorizeVectorMetadataFilter): Promise<VectorizeMatches> {
    return this.index(shardIdx).query(vector, { topK, filter })
  }

  async upsert(shardIdx: number, vectors: VectorizeVector[]): Promise<VectorizeVectorMutation> {
    return this.index(shardIdx).upsert(vectors)
  }

  async deleteByIds(shardIdx: number, ids: string[]): Promise<VectorizeVectorMutation> {
    return this.index(shardIdx).deleteByIds(ids)
  }
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext) {
    return coreWorker.fetch(request, env, ctx)
  }
}
