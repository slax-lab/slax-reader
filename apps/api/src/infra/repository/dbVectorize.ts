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

    let matches: VectorizeMatches['matches'] = []
    for (let offset = 0; offset < idBatches.length; offset += 4) {
      const settled = await Promise.allSettled(
        idBatches.slice(offset, offset + 4).map(batch =>
          vectorize.query(searchContent, {
            topK,
            returnValues: false,
            returnMetadata: 'none',
            filter: { bookmark_id: { $in: batch } } as unknown as VectorizeVectorMetadataFilter
          })
        )
      )
      for (const result of settled) {
        if (result.status === 'rejected') console.error(`seachVector shard ${shardIdx}: query batch failed`)
        else matches.push(...(result.value?.matches ?? []).map(hit => ({ id: hit.id, score: hit.score })))
      }
      matches.sort((a, b) => b.score - a.score)
      matches = matches.slice(0, topK)
    }

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
