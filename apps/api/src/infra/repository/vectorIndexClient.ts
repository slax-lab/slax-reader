import { injectable } from '@/decorators/di'
import type { VectorIndexRpc } from './vectorIndexRepo'
import type { ArticleQueryOptions, VectorIndexKind, VectorQueryOptions } from '@/utils/vectorMaintenanceTypes'

@injectable()
export class VectorIndexClient {
  private readonly rpc: VectorIndexRpc

  constructor(env: Env) {
    this.rpc = env.VECTOR as unknown as VectorIndexRpc
  }

  get(kind: VectorIndexKind, ids: string[]): Promise<VectorizeVector[]> {
    return this.rpc.getVectorsByIds(kind, ids)
  }

  upsert(kind: VectorIndexKind, vectors: VectorizeVector[]): Promise<VectorizeAsyncMutation> {
    return this.rpc.upsertVectors(kind, vectors)
  }

  delete(kind: VectorIndexKind, ids: string[]): Promise<VectorizeAsyncMutation> {
    return this.rpc.deleteVectorsByIds(kind, ids)
  }

  query(kind: 'article' | 'collection', vector: number[], options: ArticleQueryOptions | VectorQueryOptions): Promise<{ id: string; score: number }[]> {
    return this.rpc.queryVectors(kind, vector, options)
  }
}
