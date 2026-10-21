import { BookmarkSearchRepo, bookmarkRowPO } from '@/infra/repository/dbBookmarkSearch'
import { BookmarkRepo, bookmarkShardPO } from '@/infra/repository/dbBookmark'
import { inject, injectable } from '@/decorators/di'
import { VectorizeRepo } from '@/infra/repository/dbVectorize'
import { ContextManager } from '@/utils/context'
import { Normalizer } from '@/utils/hybridSearch/normalizer'
import { vectorizeData, embedding } from '@/utils/hybridSearch/vectorize'
import { mapHighlight } from '@/utils/hybridSearch/highlightMatch'
import { BookmarkNotFoundError } from '@/const/err'
import { rerank } from '@/utils/hybridSearch/rerank'
import { escapeHtml } from '@/utils/escape'
import { CandidateCollector } from '@/utils/hybridSearch/topCandidates'

export const SEARCH_RESULT_LIMIT = 100
export const FTS_CANDIDATE_LIMIT = 300
const VECTOR_CANDIDATE_LIMIT = 150
const FTS_CANDIDATE_PRUNE_AT = 500
export const MAX_FTS_ROWS = 30000
const SEARCH_RESULT_CACHE_TTL = 300
const SEARCH_MAP_CACHE_TTL = 300
const SEARCH_GENERATION_TTL = 2592000
const SEARCH_CACHE_VERSION = 'v1'

const sha256Hex = async (value: string): Promise<string> => {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export interface userBookmarkItem {
  bmId: number
  shardIdx: number
  rowId: number
}

export interface vectorizeMatcheItem {
  id: string
  score: number
}

export interface fulltextMatchItem {
  bookmark_id: number
  score: number
  content_snippet: string
  title_snippet: string
  raw_content: string
  raw_title: string
}

export interface shardBucket {
  userBookmarkIds: number[]
  shardIdx: number
}

export interface hybridSearchItem {
  vs_score: number
  fts_score: number
  bookmark_id: number
  bookmark_user_uuid?: string
  highlight_title: string
  highlight_content: string
  title?: string
  content?: string
  type: 'fts' | 'vector' | 'hybrid'
}

export interface hybridSearchResultItem extends hybridSearchItem {
  final_score: number
  bookmark_user_uuid?: string
}

export type rankedHybridSearchItem = hybridSearchItem & { final_score: number }

@injectable()
export class SearchService {
  constructor(
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo,
    @inject(BookmarkSearchRepo) private bookmarkSearchRepo: BookmarkSearchRepo,
    @inject(VectorizeRepo) private dbVectorize: VectorizeRepo
  ) {}

  public async getUserBookmarkItem(ctx: ContextManager): Promise<userBookmarkItem[]> {
    const userId = ctx.getUserId()

    let shardList: bookmarkShardPO[] = []
    let rowIds: bookmarkRowPO[] = []

    const getShardData = async () => {
      const shardStr = await ctx.env.KV.get(`search:bm_shard:${userId}`)
      if (!shardStr) {
        shardList = await this.bookmarkRepo.getBookmarkVectorShard(userId)
        await this.cachePut(ctx, `search:bm_shard:${userId}`, JSON.stringify(shardList), SEARCH_MAP_CACHE_TTL)
      } else {
        shardList = JSON.parse(shardStr) as bookmarkShardPO[]
      }
    }

    const getRowData = async () => {
      const rowStr = await ctx.env.KV.get(`search:bm_rows:${userId}`)
      if (!rowStr) {
        rowIds = await this.bookmarkSearchRepo.getUserBookmarkRawIds(userId)
        await this.cachePut(ctx, `search:bm_rows:${userId}`, JSON.stringify(rowIds), SEARCH_MAP_CACHE_TTL)
      } else {
        rowIds = JSON.parse(rowStr) as bookmarkRowPO[]
      }
    }

    await Promise.allSettled([getShardData(), getRowData()])

    const bmMap = new Map<number, { shardIdx: number; rowId: number }>()

    shardList.forEach(item => {
      bmMap.set(item.bookmark_id, { shardIdx: item.bucket_idx, rowId: 0 })
    })
    rowIds.forEach(item => {
      const existing = bmMap.get(item.bookmark_id)
      if (existing) {
        if (!existing.rowId) existing.rowId = item.id
      } else {
        bmMap.set(item.bookmark_id, { shardIdx: 0, rowId: item.id })
      }
    })

    return Array.from(bmMap.entries()).map(([bmId, data]) => ({
      bmId,
      shardIdx: data.shardIdx,
      rowId: data.rowId
    }))
  }

  private async cachePut(ctx: ContextManager, key: string, value: string, ttl: number): Promise<void> {
    const write = Promise.resolve(ctx.env.KV.put(key, value, { expirationTtl: ttl }))
    if (ctx.execution?.waitUntil) {
      ctx.execution.waitUntil(write)
      return
    }
    await write
  }

  private async readSearchCache<T>(ctx: ContextManager, key: string): Promise<T | null> {
    try {
      const raw = await ctx.env.KV.get(key)
      return raw ? (JSON.parse(raw) as T) : null
    } catch {
      return null
    }
  }

  private writeSearchCache(ctx: ContextManager, key: string, value: unknown, ttl: number): void {
    void this.cachePut(ctx, key, JSON.stringify(value), ttl).catch(() => {})
  }

  private async searchGeneration(ctx: ContextManager, userId: number): Promise<string> {
    try {
      return (await ctx.env.KV.get(`search:gen:${userId}`)) ?? '0'
    } catch {
      return '0'
    }
  }

  public async hybridSearch(ctx: ContextManager, fulltextContent: string, vectorizeContent: string[] = []) {
    if (fulltextContent.length < 1 && vectorizeContent.length < 1) return []
    if (vectorizeContent.length < 1) vectorizeContent = [fulltextContent]

    const userId = ctx.getUserId()
    const cacheKey = `search:res:${SEARCH_CACHE_VERSION}:${userId}:${await this.searchGeneration(ctx, userId)}:${await sha256Hex(`${fulltextContent}\u0000${vectorizeContent.join('\u0000')}`)}`
    const cached = await this.readSearchCache<hybridSearchResultItem[]>(ctx, cacheKey)
    if (cached) {
      console.log(`[cache] search hit user ${userId}`)
      return cached
    }

    const normalizer = new Normalizer(ctx.env)
    // 查找用户拥有的bookmark list
    const t1 = performance.now()

    const [bmListRes, vectorizeResultRes, jbSearchContentRes] = await Promise.allSettled([
      this.getUserBookmarkItem(ctx),
      embedding(ctx.env, vectorizeContent, ctx.execution),
      normalizer.processSearchKeyword(fulltextContent, ctx.execution)
    ])
    console.log(`get base data time: ${performance.now() - t1} ms`)

    const bmList = bmListRes.status === 'fulfilled' ? bmListRes.value : []
    const vectorizeResult = vectorizeResultRes.status === 'fulfilled' ? vectorizeResultRes.value : []
    const jbSearchContent = jbSearchContentRes.status === 'fulfilled' ? jbSearchContentRes.value : ''

    // 混合搜索
    const t2 = performance.now()
    let [fulltextResult, semanticResult] = await Promise.allSettled([this.fulltextSearch(ctx, jbSearchContent, bmList), this.semanticSearch(ctx, vectorizeResult, bmList)])
    const fulltextItems = fulltextResult.status === 'fulfilled' ? fulltextResult.value.items : []
    const fulltextComplete = fulltextResult.status === 'fulfilled' && fulltextResult.value.complete
    const semanticRes = semanticResult.status === 'fulfilled' ? semanticResult.value : []

    console.log(`hybrid search time: ${performance.now() - t2} ms, fulltext: ${fulltextItems.length}, semantic: ${semanticRes.length}`)

    // 搜索结果拼接
    const hybridSearchMap: Record<number, hybridSearchItem> = {}
    // 需要回表查询raw title 跟Content的bookmark ids
    const returnTableIds: number[] = []

    // 全文搜索结果
    fulltextItems.forEach(item => {
      hybridSearchMap[item.bookmark_id] = {
        vs_score: 0,
        fts_score: item.score,
        bookmark_id: item.bookmark_id,
        highlight_title: item.title_snippet,
        highlight_content: item.content_snippet,
        title: item.raw_title,
        content: item.raw_content,
        type: 'fts'
      }
    })

    // 语义搜索结果
    semanticRes
      .filter(item => item.score > 0.4)
      .forEach(item => {
        const bmId = parseInt(item.id.split('_')[0])
        if (isNaN(bmId) || !bmId || bmId < 1) return
        if (!hybridSearchMap[bmId]) {
          returnTableIds.push(bmId)
          hybridSearchMap[bmId] = { bookmark_id: bmId, vs_score: item.score, fts_score: 0, type: 'vector', highlight_title: '', highlight_content: '' }
        } else if (hybridSearchMap[bmId].type === 'fts') {
          hybridSearchMap[bmId].vs_score = item.score
          hybridSearchMap[bmId].type = 'hybrid'
        }
      })

    const t3 = performance.now()
    const rawList = returnTableIds.length > 0 ? await this.bookmarkSearchRepo.getBookmarkRaw(returnTableIds) : []
    rawList.forEach(item => {
      if (!hybridSearchMap[item.bookmark_id]) return
      hybridSearchMap[item.bookmark_id].highlight_title = item.raw_title
      hybridSearchMap[item.bookmark_id].highlight_content = item.raw_content
    })

    const ranked = this.rankHybridSearchList(hybridSearchMap)
    const candidateIds = ranked.slice(0, FTS_CANDIDATE_LIMIT).map(item => item.bookmark_id)
    const uuidMap = await this.bookmarkRepo.getUserBookmarkUuidsByBmIds(userId, candidateIds)
    const result = this.finalizeHybridSearchList(ranked.filter(item => uuidMap.has(item.bookmark_id)).slice(0, SEARCH_RESULT_LIMIT), uuidMap)
    console.log(`get raw & uuid data cost: ${performance.now() - t3} ms`)

    const cacheable =
      bmListRes.status === 'fulfilled' &&
      vectorizeResultRes.status === 'fulfilled' &&
      jbSearchContentRes.status === 'fulfilled' &&
      fulltextComplete &&
      semanticResult.status === 'fulfilled'
    if (cacheable) this.writeSearchCache(ctx, cacheKey, result, SEARCH_RESULT_CACHE_TTL)
    return result
  }

  public async processHybridSearchRerank(ctx: ContextManager, keyword: string, hybridSearchMap: Record<number, hybridSearchItem>) {
    // 预处理搜索结果
    const processedItems = Object.values(hybridSearchMap).map(item => ({
      ...item,
      vs_score: item.vs_score ?? 0,
      fts_score: Math.abs(item.fts_score ?? 0),
      highlight_content: item.type !== 'vector' ? mapHighlight(item.content ?? '', item.highlight_content) : escapeHtml(item.highlight_content),
      highlight_title: item.type !== 'vector' ? mapHighlight(item.title ?? '', item.highlight_title) : escapeHtml(item.highlight_title)
    }))

    // 获取重排序分数
    const texts = processedItems.map(item => `${item.highlight_title}\n${item.highlight_content}`)
    const t1 = performance.now()
    const rerankedScores = await rerank(ctx.env, keyword, texts).finally(() => {
      console.log(`rerank time: ${performance.now() - t1} ms`)
    })

    // 按照rerank分数排序并返回结果
    return rerankedScores.map(item => {
      const processedItem = processedItems[item.index]
      if (!processedItem) return null
      return {
        ...processedItem,
        final_score: item.score,
        title: undefined,
        content: undefined
      }
    })
  }

  /**
   * 混合搜索结果排序
   */
  rankHybridSearchList = (hybridSearchMap: Record<number, hybridSearchItem>, RRF_K: number = 60): rankedHybridSearchItem[] => {
    // 预处理
    const processedItems = Object.values(hybridSearchMap).map(item => ({
      ...item,
      vs_score: item.vs_score ?? 0,
      fts_score: Math.abs(item.fts_score ?? 0)
    }))

    // 获取向量搜索排名
    const vsRanks = new Map(
      [...processedItems]
        .filter(item => item.vs_score > 0)
        .sort((a, b) => b.vs_score - a.vs_score)
        .map((item, index) => [item.bookmark_id, index + 1])
    )

    // 获取全文搜索排名
    const ftsRanks = new Map(
      [...processedItems]
        .filter(item => item.fts_score > 0)
        .sort((a, b) => b.fts_score - a.fts_score)
        .map((item, index) => [item.bookmark_id, index + 1])
    )

    // 计算RRF得分
    const scoredItems = processedItems.map(item => {
      const vsRRF = 1 / (RRF_K + (vsRanks.get(item.bookmark_id) || processedItems.length))
      const ftsRRF = 1 / (RRF_K + (ftsRanks.get(item.bookmark_id) || processedItems.length))

      // 综合RRF得分
      const finalScore = vsRRF + ftsRRF

      return {
        ...item,
        final_score: finalScore
      }
    })

    return scoredItems.sort((a, b) => b.final_score - a.final_score || a.bookmark_id - b.bookmark_id)
  }

  finalizeHybridSearchList = (ranked: rankedHybridSearchItem[], uuidMap: Map<number, string> = new Map()): hybridSearchResultItem[] => {
    return ranked.map(item => ({
      ...item,
      bookmark_user_uuid: uuidMap.get(item.bookmark_id),
      highlight_content: item.type !== 'vector' ? mapHighlight(item.content ?? '', item.highlight_content) : escapeHtml(item.highlight_content),
      highlight_title: item.type !== 'vector' ? mapHighlight(item.title ?? '', item.highlight_title) : escapeHtml(item.highlight_title),
      title: undefined,
      content: undefined
    }))
  }

  processHybridSearchList = (
    hybridSearchMap: Record<number, hybridSearchItem>,
    uuidMap: Map<number, string> = new Map(),
    RRF_K: number = 60,
    limit: number = SEARCH_RESULT_LIMIT
  ) => {
    return this.finalizeHybridSearchList(this.rankHybridSearchList(hybridSearchMap, RRF_K).slice(0, limit), uuidMap)
  }

  /**
   * 全文搜索
   * @param ctx
   * @param env
   * @param fulltextContent
   * @param db
   * @param userBookmarkItem
   * @returns
   */
  public async fulltextSearch(ctx: ContextManager, jbSearchContent: string, userBookmarkItem: userBookmarkItem[]): Promise<{ items: fulltextMatchItem[]; complete: boolean }> {
    if (userBookmarkItem.length < 1 || jbSearchContent.length < 1) return { items: [], complete: true }

    const t1 = performance.now()
    // bm25单次搜50条左右的文章效率最高
    // 分割bmIds为50条一组
    // WARING: 这里只能是50条，不能改为别的。如果要改，必须要用explain Query plan真实SQL检查一次是否会全表搜索
    const ordered = userBookmarkItem.filter(item => item.rowId > 0).sort((a, b) => b.rowId - a.rowId)
    const truncated = ordered.length > MAX_FTS_ROWS
    const items = truncated ? ordered.slice(0, MAX_FTS_ROWS) : ordered
    if (truncated) {
      console.log(`search_scope_truncated user=${ctx.getUserId()} total=${ordered.length} searched=${items.length}`)
    }

    const bmIdGroups = Array.from({ length: Math.ceil(items.length / 50) }, (_, i) => items.slice(i * 50, (i + 1) * 50).map(item => item.rowId)).filter(group => group.length > 0)
    const collector = new CandidateCollector<fulltextMatchItem>(
      FTS_CANDIDATE_LIMIT,
      FTS_CANDIDATE_PRUNE_AT,
      item => item.bookmark_id,
      (a, b) => Math.abs(b.score) - Math.abs(a.score) || a.bookmark_id - b.bookmark_id
    )

    const { complete } = await this.bookmarkSearchRepo.seachBM25Batch(ctx, bmIdGroups, jbSearchContent, rows => {
      for (const row of rows) collector.push(row)
    })

    const res = collector.values()
    console.log(`fulltext search time: ${performance.now() - t1} ms, candidates: ${items.length}, groups: ${bmIdGroups.length}, result: ${res.length}, complete: ${complete}`)
    return { items: res, complete }
  }

  /**
   * 语义搜索
   * @param ctx
   * @param env
   * @param db
   * @param vectorizeContent
   * @param userBookmarkItem
   */
  public async semanticSearch(ctx: ContextManager, vectorizeResult: vectorizeData[], userBookmarkItem: userBookmarkItem[]): Promise<vectorizeMatcheItem[]> {
    const t1 = performance.now()
    if (vectorizeResult.length < 1 || userBookmarkItem.length < 1 || !vectorizeResult) return []

    const searchPromises: Promise<VectorizeMatches | []>[] = []
    const shardBucket: shardBucket[] = Array.from({ length: 5 }, (_, idx) => ({ userBookmarkIds: [], shardIdx: idx }))
    // 分出每个桶的数据
    userBookmarkItem.forEach(item => {
      shardBucket[item.shardIdx].userBookmarkIds.push(item.bmId)
    })

    // 分桶构建搜索任务
    const semanticSearchItem = async (vectorizeItem: vectorizeData) => {
      for (const shard of shardBucket) {
        if (shard.userBookmarkIds.length < 1) continue
        searchPromises.push(this.dbVectorize.seachVector(vectorizeItem.embedding, shard.userBookmarkIds, shard.shardIdx))
      }
    }

    // 构建搜索任务
    if (vectorizeResult && vectorizeResult.length > 0) {
      for (const vectorizeItem of vectorizeResult) void semanticSearchItem(vectorizeItem)
    }
    if (searchPromises.length < 1) return []

    console.log(`user ${ctx.getUserId()} semantic search, bmIds: ${userBookmarkItem.length}, tasks: ${searchPromises.length}`)

    const result = (await Promise.allSettled(searchPromises))
      .filter(item => item.status === 'fulfilled')
      .flatMap(item => item.value)
      .filter(item => item.count > 0)
      .flatMap(item =>
        item.matches.map(match => ({
          id: match.id,
          score: match.score
        }))
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, VECTOR_CANDIDATE_LIMIT)

    console.log(`semantic search time: ${performance.now() - t1} ms`)
    return result
  }

  public async addSearchRecordByBmId(ctx: ContextManager, bookmarkId: number) {
    const bookmark = await this.bookmarkRepo.getBookmarkById(bookmarkId)
    if (!bookmark) throw BookmarkNotFoundError()
    if (!bookmark.content_md_key) throw BookmarkNotFoundError()
    const content = await ctx.env.OSS.get(bookmark.content_md_key)
    if (!content) throw BookmarkNotFoundError()
    const normalizer = new Normalizer(ctx.env)

    const body = await content.text()
    const results = await Promise.allSettled([
      this.semanticNormalize(ctx, normalizer, bookmarkId, bookmark.title, body),
      this.fulltextNormalize(ctx, normalizer, bookmarkId, bookmark.title, body)
    ])
    if (results.some(result => result.status === 'fulfilled')) await this.clearSearchCache(ctx, ctx.getUserId()).catch(() => {})
    return results
  }

  public async addSearchRecord(ctx: ContextManager, bookmarkId: number, title: string, content: string) {
    const normalizer = new Normalizer(ctx.env)
    const results = await Promise.allSettled([
      this.fulltextNormalize(ctx, normalizer, bookmarkId, title, content),
      this.semanticNormalize(ctx, normalizer, bookmarkId, title, content)
    ])
    if (results.some(result => result.status === 'fulfilled')) await this.clearSearchCache(ctx, ctx.getUserId()).catch(() => {})
    return results
  }

  /**
   * 全文搜索内容归一化
   */
  public async fulltextNormalize(ctx: ContextManager, normalizer: Normalizer, bookmarkId: number, title: string, content: string) {
    try {
      const res = await normalizer.processFulltext(title, content)
      if (res.length < 1) {
        console.log(`fulltext normalize failed, bookmarkId: ${bookmarkId}, content is empty`)
        return []
      }
      return await this.bookmarkSearchRepo.createBookmarkRaw(
        ctx,
        res.map((item, idx) => {
          return {
            bookmark_id: bookmarkId,
            content: item.normalized_content,
            rawContent: item.raw_content,
            title: item.normalized_title,
            rawTitle: item.raw_title,
            shard_idx: idx
          }
        })
      )
    } catch (e) {
      console.log(e, 'fulltextNormalize error')
      throw e
    }
  }

  /**
   * 语义搜索内容归一化
   */
  public async semanticNormalize(ctx: ContextManager, normalizer: Normalizer, bookmarkId: number, title: string, content: string) {
    try {
      const normalized = await normalizer.processSemantic(bookmarkId, title, content)
      console.log(`semantic normalize, bookmarkId: ${bookmarkId}, normalized: ${normalized.length}`)
      if (normalized.length < 1) {
        console.log(`semantic normalize failed, bookmarkId: ${bookmarkId}, embeddings are empty`)
        return []
      }
      // 先判断是否存在，如果存在则删除后重新写入
      const shard = await this.bookmarkRepo.upsertVectorShard(bookmarkId, Math.floor(Math.random() * 5))
      if (!shard) {
        console.error(`create semantic vector shard failed, bookmarkId: ${bookmarkId}`)
        return
      }

      await this.dbVectorize.deleteVector(bookmarkId, shard.bucket_idx)
      const res = await this.dbVectorize.upsertVector(
        bookmarkId,
        shard.bucket_idx,
        normalized.map(item => ({ vecId: item.id, vector: item.embedding }))
      )
      console.log(`create semantic vector, bookmarkId: ${bookmarkId}, shardIdx: ${shard.bucket_idx}, mutaionsId: ${JSON.stringify(res)}`)
      return res
    } catch (e) {
      console.log(e, 'semanticNormalize error')
      throw e
    }
  }

  /**
   * 同步清除搜索缓存
   */
  public async clearSearchCache(ctx: ContextManager, userId: number) {
    await Promise.all([
      ctx.env.KV.put(`search:gen:${userId}`, crypto.randomUUID(), { expirationTtl: SEARCH_GENERATION_TTL }),
      ctx.env.KV.delete(`search:valid_bm_ids:${userId}`),
      ctx.env.KV.delete(`search:bm_shard:${userId}`),
      ctx.env.KV.delete(`search:bm_rows:${userId}`)
    ])
    console.log(`[cache] cleared search cache for user ${userId}`)
  }
}
