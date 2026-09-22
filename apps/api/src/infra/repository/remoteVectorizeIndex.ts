interface VectorRpcService {
  query(shardIdx: number, vector: VectorFloatArray | number[], topK: number | undefined, filter: VectorizeVectorMetadataFilter | undefined): Promise<VectorizeMatches>
  upsert(shardIdx: number, vectors: VectorizeVector[]): Promise<VectorizeVectorMutation>
  deleteByIds(shardIdx: number, ids: string[]): Promise<VectorizeVectorMutation>
}

export class RemoteVectorizeIndex implements Pick<VectorizeIndex, 'query' | 'upsert' | 'deleteByIds'> {
  private readonly rpc: VectorRpcService

  constructor(
    service: Fetcher,
    private readonly shardIdx: number
  ) {
    this.rpc = service as unknown as VectorRpcService
  }

  async query(vector: VectorFloatArray | number[], options?: VectorizeQueryOptions): Promise<VectorizeMatches> {
    return this.rpc.query(this.shardIdx, vector, options?.topK, options?.filter)
  }

  async upsert(vectors: VectorizeVector[]): Promise<VectorizeVectorMutation> {
    return this.rpc.upsert(this.shardIdx, vectors)
  }

  async deleteByIds(ids: string[]): Promise<VectorizeVectorMutation> {
    return this.rpc.deleteByIds(this.shardIdx, ids)
  }
}
