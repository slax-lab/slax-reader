import { inject, singleton } from '@/decorators/di'
import { VECTORIZE_CLIENTS } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'

@singleton()
export class VectorizeRepo {
  constructor(@inject(VECTORIZE_CLIENTS) private vectorize: LazyInstance<VectorizeIndex[]>) {}

  async upsertVector(bookmarkId: number, shardIdx: number, shardList: { vecId: string; vector: number[] }[]) {
    if (shardIdx < 0 || shardIdx > this.vectorize().length) return
    const vectorize = this.vectorize()[shardIdx]
    try {
      return await vectorize.upsert(
        shardList.map(item => ({
          id: item.vecId,
          values: item.vector,
          metadata: {
            bookmark_id: bookmarkId
          }
        }))
      )
    } catch (e) {
      console.log(e, 'upsertVector error')
      return []
    }
  }

  async deleteVector(bookmarkId: number, bucketIdx: number) {
    const vectorize = this.vectorize()[bucketIdx]
    const ids = Array.from({ length: 10 }, (_, idx) => `${bookmarkId}_${idx}`)
    await vectorize.deleteByIds(ids)
  }

  async seachVector(searchContent: number[], userBookmarkIds: number[], shardIdx: number): Promise<VectorizeMatches | []> {
    const t1 = performance.now()
    const clients = this.vectorize()
    if (userBookmarkIds.length < 1 || searchContent.length < 1) return []
    if (shardIdx < 0 || shardIdx >= clients.length) return []

    const vectorize = clients[shardIdx]
    const topK = 30
    const idBatches = VectorizeRepo.chunkIdsByFilterSize(userBookmarkIds)

    const settled = await Promise.allSettled(
      idBatches.map(batch =>
        vectorize.query(searchContent, {
          topK,
          filter: { bookmark_id: { $in: batch } } as unknown as VectorizeVectorMetadataFilter
        })
      )
    )

    const rejected = settled.filter((r): r is PromiseRejectedResult => r.status === 'rejected')
    if (rejected.length > 0) {
      const reasons = rejected.map(r => (r.reason instanceof Error ? r.reason.message : String(r.reason))).join(' | ')
      console.error(`seachVector shard ${shardIdx}: ${rejected.length}/${idBatches.length} 批查询失败: ${reasons}`)
    }

    const matches = settled
      .filter((r): r is PromiseFulfilledResult<VectorizeMatches> => r.status === 'fulfilled' && !!r.value)
      .flatMap(r => r.value.matches ?? [])
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)

    console.log(`seachVector time: ${performance.now() - t1}ms, shard: ${shardIdx}, batches: ${idBatches.length}, matches: ${matches.length}`)
    return { count: matches.length, matches }
  }

  private static chunkIdsByFilterSize(ids: number[], maxBytes = 1900, maxItems = 100): number[][] {
    const FIXED_OVERHEAD = 32
    const batches: number[][] = []
    let current: number[] = []
    let size = FIXED_OVERHEAD
    for (const id of ids) {
      const idSize = `${id}`.length + 1
      if (current.length > 0 && (current.length >= maxItems || size + idSize > maxBytes)) {
        batches.push(current)
        current = []
        size = FIXED_OVERHEAD
      }
      current.push(id)
      size += idSize
    }
    if (current.length > 0) batches.push(current)
    return batches
  }
}
