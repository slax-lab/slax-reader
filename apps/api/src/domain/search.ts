import { BookmarkSearchRepo, bookmarkRowPO } from '@/infra/repository/dbBookmarkSearch'
import { BookmarkRepo, bookmarkShardPO } from '@/infra/repository/dbBookmark'
import { inject, injectable } from '@/decorators/di'
import { VectorizeRepo } from '@/infra/repository/dbVectorize'
import { ContextManager } from '@/utils/context'
import { Normalizer, type fulltextExpressions } from '@/utils/hybridSearch/normalizer'
import { vectorizeData, embedding } from '@/utils/hybridSearch/vectorize'
import { HIGHLIGHT_TARGET_LENGTH, mapHighlight } from '@/utils/hybridSearch/highlightMatch'
import { BookmarkNotFoundError } from '@/const/err'
import { rerank } from '@/utils/hybridSearch/rerank'
import { escapeHtml } from '@/utils/escape'
import { VectorMaintenanceService } from './vectorMaintenance'
import { VectorEmbeddingClient } from '@/infra/external/vectorEmbedding'
import { center, cosineSimilarity } from '@/utils/recommendationAlgorithms'

// Maximum number of fulltext hits that receive highlight snippets and full raw text
export const FULLTEXT_HIGHLIGHT_LIMIT = 50
// V5 semantic retrieval: raw-vector candidates per query, returned with their values and reranked by cosine after
// removing the platform mean. 50 is the native topK limit when values are returned.
export const SEMANTIC_CANDIDATE_LIMIT = 50
// Below this best centered score the query relates to none of the user's articles, so no semantic hit is kept.
export const SEMANTIC_MIN_TOP_SCORE = 0.35
// Hits must reach this share of the best centered score.
export const SEMANTIC_RELATIVE_FLOOR = 0.6
// Length of the title and text shown for a semantic-only hit, matching the raw prefix getBookmarkRaw reads.
export const SEMANTIC_FALLBACK_TEXT_LENGTH = 50

export interface userBookmarkItem {
  bmId: number
  shardIdx: number
  // Every fulltext shard row of the bookmark; a long article is split into several rows.
  rowIds: number[]
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

@injectable()
export class SearchService {
  constructor(
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo,
    @inject(BookmarkSearchRepo) private bookmarkSearchRepo: BookmarkSearchRepo,
    @inject(VectorizeRepo) private dbVectorize: VectorizeRepo,
    @inject(VectorMaintenanceService) private vectors: VectorMaintenanceService,
    @inject(VectorEmbeddingClient) private vectorEmbedding: VectorEmbeddingClient
  ) {}

  public async getUserBookmarkItem(ctx: ContextManager): Promise<userBookmarkItem[]> {
    const userId = ctx.getUserId()

    let shardList: bookmarkShardPO[] = []
    let rowIds: bookmarkRowPO[] = []
    let validBookmarkIds: number[] = []

    const getShardData = async () => {
      const shardStr = await ctx.env.KV.get(`search:bm_shard:${userId}`)
      if (!shardStr) {
        shardList = await this.bookmarkRepo.getBookmarkVectorShard(userId)
        await ctx.env.KV.put(`search:bm_shard:${userId}`, JSON.stringify(shardList), { expirationTtl: 60 * 5 })
      } else {
        shardList = JSON.parse(shardStr) as bookmarkShardPO[]
      }
    }

    const getRowData = async () => {
      const rowStr = await ctx.env.KV.get(`search:bm_rows:${userId}`)
      if (!rowStr) {
        rowIds = await this.bookmarkSearchRepo.getUserBookmarkRawIds(userId)
        await ctx.env.KV.put(`search:bm_rows:${userId}`, JSON.stringify(rowIds), { expirationTtl: 60 * 5 })
      } else {
        rowIds = JSON.parse(rowStr) as bookmarkRowPO[]
      }
    }

    const getValidIds = async () => {
      const validStr = await ctx.env.KV.get(`search:valid_bm_ids:${userId}`)
      if (!validStr) {
        const validBms = await this.bookmarkRepo.getUserBookmarkIds(userId)
        validBookmarkIds = validBms.map(item => item.bookmark_id)
        await ctx.env.KV.put(`search:valid_bm_ids:${userId}`, JSON.stringify(validBookmarkIds), { expirationTtl: 60 * 5 })
      } else {
        validBookmarkIds = JSON.parse(validStr) as number[]
      }
    }

    await Promise.allSettled([getShardData(), getRowData(), getValidIds()])

    // 创建有效书签ID集合，用于过滤回收站书签
    const validBookmarkSet = new Set(validBookmarkIds)

    const bmMap = new Map<number, { shardIdx: number; rowIds: number[] }>()

    shardList.forEach(item => {
      if (validBookmarkSet.has(item.bookmark_id)) {
        bmMap.set(item.bookmark_id, { shardIdx: item.bucket_idx, rowIds: [] })
      }
    })
    rowIds.forEach(item => {
      if (!validBookmarkSet.has(item.bookmark_id)) return // 过滤掉回收站书签
      const existing = bmMap.get(item.bookmark_id)
      if (existing) {
        existing.rowIds.push(item.id)
      } else {
        bmMap.set(item.bookmark_id, { shardIdx: 0, rowIds: [item.id] })
      }
    })

    return Array.from(bmMap.entries()).map(([bmId, data]) => ({
      bmId,
      shardIdx: data.shardIdx,
      rowIds: data.rowIds
    }))
  }

  public async hybridSearch(ctx: ContextManager, fulltextContent: string, vectorizeContent: string[] = [], tagUuids: string[] = []) {
    if (fulltextContent.length < 1 && vectorizeContent.length < 1) return []
    if (vectorizeContent.length < 1) vectorizeContent = [fulltextContent]

    const eligible = new Set((await this.bookmarkRepo.getSearchEligibleBookmarks(ctx.getUserId(), tagUuids)).map(row => row.bookmark_id))
    if (!eligible.size) return []
    const normalizer = new Normalizer(ctx.env)
    // 查找用户拥有的bookmark list
    const t1 = performance.now()

    // Tag-filtered searches stay on the legacy buckets, which can filter by the eligible bookmark ids; the V5 index is
    // filtered natively by owner only, and post-filtering its top-K by tag would drop matches.
    const legacySemantic = tagUuids.length > 0
    const [bmListRes, vectorizeResultRes, jbSearchContentRes] = await Promise.allSettled([
      this.getUserBookmarkItem(ctx),
      legacySemantic ? embedding(ctx.env, vectorizeContent) : Promise.resolve([] as vectorizeData[]),
      normalizer.processSearchKeyword(fulltextContent)
    ])
    console.log(`get base data time: ${performance.now() - t1} ms`)

    const bmList = bmListRes.status === 'fulfilled' ? bmListRes.value.filter(row => eligible.has(row.bmId)) : []
    const vectorizeResult = vectorizeResultRes.status === 'fulfilled' ? vectorizeResultRes.value : []
    const fulltextExpressions = jbSearchContentRes.status === 'fulfilled' ? jbSearchContentRes.value : { full: '', title: '', content: '' }

    // 混合搜索
    const t2 = performance.now()
    let [fulltextResult, semanticResult] = await Promise.allSettled([
      this.fulltextSearch(ctx, fulltextExpressions, bmList),
      legacySemantic ? this.semanticSearch(ctx, vectorizeResult, bmList) : this.semanticSearchV5(ctx, vectorizeContent.join(' '), eligible)
    ])
    const fulltextRes = fulltextResult.status === 'fulfilled' ? fulltextResult.value : []
    const semanticRes = semanticResult.status === 'fulfilled' ? semanticResult.value : []

    if (fulltextResult.status === 'rejected')
      console.error(`fulltext search failed: ${fulltextResult.reason instanceof Error ? fulltextResult.reason.message : String(fulltextResult.reason)}`)
    console.log(
      `hybrid search time: ${performance.now() - t2} ms, fulltext: ${fulltextResult.status === 'rejected' ? 'failed' : fulltextRes.length}, semantic: ${semanticResult.status === 'rejected' ? 'failed' : semanticRes.length}`
    )

    // 搜索结果拼接
    const hybridSearchMap: Record<number, hybridSearchItem> = {}
    // 需要回表查询raw title 跟Content的bookmark ids
    const returnTableIds: number[] = []

    // 全文搜索结果
    fulltextRes.forEach(item => {
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

    // 语义搜索结果；V5 结果已按平台均值去中心化后的阈值筛选，0.4 只适用于旧分片的原始余弦
    semanticRes
      .filter(item => !legacySemantic || item.score > 0.4)
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

    const matchedIds = Object.keys(hybridSearchMap).map(Number)

    const t3 = performance.now()
    const [rawList, currentRows] = await Promise.all([
      returnTableIds.length > 0 ? this.bookmarkSearchRepo.getBookmarkRaw(returnTableIds) : Promise.resolve([] as Awaited<ReturnType<BookmarkSearchRepo['getBookmarkRaw']>>),
      this.bookmarkRepo.getSearchEligibleBookmarks(ctx.getUserId(), tagUuids, matchedIds)
    ])

    rawList.forEach(item => {
      if (!hybridSearchMap[item.bookmark_id]) return
      hybridSearchMap[item.bookmark_id].highlight_title = item.raw_title
      hybridSearchMap[item.bookmark_id].highlight_content = item.raw_content
    })
    console.log(`get raw & uuid data cost: ${performance.now() - t3} ms`)

    // return processHybridSearchRerank(env, fulltextContent, hybridSearchMap)
    const uuidMap = new Map(currentRows.map(row => [row.bookmark_id, row.uuid]))
    const metadata = new Map(currentRows.map(row => [row.bookmark_id, row]))
    for (const id of matchedIds) if (!uuidMap.has(id)) delete hybridSearchMap[id]
    // A semantic-only hit can be a bookmark without fulltext rows; show its PostgreSQL title and description instead
    // of an empty card.
    for (const id of returnTableIds) {
      const item = hybridSearchMap[id]
      const row = metadata.get(id)
      if (!item || !row || item.highlight_title) continue
      item.highlight_title = (row.alias_title || row.bookmark?.title || '').slice(0, SEMANTIC_FALLBACK_TEXT_LENGTH)
      item.highlight_content = (row.bookmark?.description || '').slice(0, SEMANTIC_FALLBACK_TEXT_LENGTH)
    }
    return this.processHybridSearchList(hybridSearchMap, uuidMap).map(item => ({
      ...item,
      target_url: metadata.get(item.bookmark_id)?.bookmark?.target_url ?? '',
      created_at: metadata.get(item.bookmark_id)?.created_at?.toISOString() ?? ''
    }))
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
  processHybridSearchList = (hybridSearchMap: Record<number, hybridSearchItem>, uuidMap: Map<number, string> = new Map(), RRF_K: number = 60) => {
    // 预处理
    const processedItems = Object.values(hybridSearchMap).map(item => ({
      ...item,
      vs_score: item.vs_score ?? 0,
      fts_score: Math.abs(item.fts_score ?? 0),
      highlight_content: item.type !== 'vector' ? mapHighlight(item.content ?? '', item.highlight_content) : escapeHtml(item.highlight_content),
      highlight_title: item.type !== 'vector' ? mapHighlight(item.title ?? '', item.highlight_title) : escapeHtml(item.highlight_title),
      title: undefined,
      content: undefined
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
        bookmark_user_uuid: uuidMap.get(item.bookmark_id),
        final_score: finalScore
      }
    })

    return scoredItems.sort((a, b) => b.final_score - a.final_score)
  }

  /**
   * Fulltext search: one query ranks every shard row of the candidate bookmarks, each bookmark keeps its
   * best-matching shard, and only the top FULLTEXT_HIGHLIGHT_LIMIT bookmarks read highlights and full raw text. The rest read a raw prefix, which mapHighlight turns into its no-highlight
   * excerpt. Query failures propagate instead of returning partial hits.
   */
  public async fulltextSearch(ctx: ContextManager, expressions: fulltextExpressions, userBookmarkItem: userBookmarkItem[]): Promise<fulltextMatchItem[]> {
    const rowIds = userBookmarkItem.flatMap(item => item.rowIds).filter(rowId => rowId > 0)
    if (rowIds.length < 1 || !expressions.full) return []

    const t1 = performance.now()
    // Rows arrive by ascending bm25 (lower is more relevant); a bookmark is represented by its best-matching shard.
    const seen = new Set<number>()
    const ranked = (await this.bookmarkSearchRepo.rankFulltextRows(rowIds, expressions.full)).filter(row => {
      if (seen.has(row.bookmark_id)) return false
      seen.add(row.bookmark_id)
      return true
    })
    const highlighted = ranked.slice(0, FULLTEXT_HIGHLIGHT_LIMIT).map(row => row.row_id)
    const rest = ranked.slice(FULLTEXT_HIGHLIGHT_LIMIT).map(row => row.row_id)
    const [highlights, prefixes] = await Promise.all([
      this.bookmarkSearchRepo.getFulltextHighlights(highlighted, expressions),
      this.bookmarkSearchRepo.getFulltextRawPrefixes(rest, HIGHLIGHT_TARGET_LENGTH)
    ])
    const texts = new Map<number, { content_snippet: string; title_snippet: string; raw_content: string; raw_title: string }>()
    for (const row of highlights)
      texts.set(row.row_id, { content_snippet: row.content_snippet, title_snippet: row.title_snippet, raw_content: row.raw_content, raw_title: row.raw_title })
    for (const row of prefixes) texts.set(row.row_id, { content_snippet: '', title_snippet: '', raw_content: row.raw_content, raw_title: row.raw_title })
    console.log(`fulltext search candidates: ${rowIds.length}, matched: ${ranked.length}, time: ${performance.now() - t1} ms`)

    // A ranked row whose text is gone was deleted between the queries; it is dropped rather than shown blank.
    return ranked.flatMap(row => {
      const text = texts.get(row.row_id)
      return text ? [{ bookmark_id: row.bookmark_id, score: row.score, ...text }] : []
    })
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

    console.log(`semantic search time: ${performance.now() - t1} ms`)
    return result
  }

  /**
   * Semantic search on the V5 article index. Candidates and their stored vectors come from one native query with the
   * raw query vector, as the index stores raw representatives; they are then rescored by cosine after removing the platform mean
   * (EMBEDDING_MEAN), because raw V5 cosines sit in a narrow band where unrelated text scores close to real matches.
   * Ids keep the legacy `<bookmarkId>_0` shape so fusion is unchanged.
   */
  public async semanticSearchV5(ctx: ContextManager, keyword: string, eligible: Set<number>): Promise<vectorizeMatcheItem[]> {
    const t1 = performance.now()
    const userId = ctx.getUserId()
    if (!keyword.trim() || !eligible.size) return []
    const query = await this.vectorEmbedding.cachedQuery(keyword)
    // The index already restricts candidates to this owner; the userId check is an assertion, and `eligible` drops
    // trashed or removed bookmarks. Tag filters never reach this branch.
    const candidates = (await this.vectors.queryArticleVectors(query, { userId, limit: SEMANTIC_CANDIDATE_LIMIT })).filter(
      candidate => candidate.userId === userId && eligible.has(candidate.id)
    )
    if (!candidates.length) return []
    const centeredQuery = center(query)
    const scored = candidates
      .map(candidate => ({ id: candidate.id, score: cosineSimilarity(centeredQuery, center(candidate.values)) }))
      .sort((a, b) => b.score - a.score || a.id - b.id)
    const top = scored[0]?.score ?? 0
    const kept = top < SEMANTIC_MIN_TOP_SCORE ? [] : scored.filter(item => item.score >= top * SEMANTIC_RELATIVE_FLOOR)
    console.log(`semantic search v5 time: ${performance.now() - t1} ms, candidates: ${candidates.length}, kept: ${kept.length}, top: ${top.toFixed(3)}`)
    return kept.map(item => ({ id: `${item.id}_0`, score: item.score }))
  }

  public async addSearchRecordByBmId(ctx: ContextManager, bookmarkId: number) {
    const bookmark = await this.bookmarkRepo.getBookmarkById(bookmarkId)
    if (!bookmark) throw BookmarkNotFoundError()
    if (!bookmark.content_md_key) throw BookmarkNotFoundError()
    const content = await ctx.env.OSS.get(bookmark.content_md_key)
    if (!content) throw BookmarkNotFoundError()
    const normalizer = new Normalizer(ctx.env)

    const body = await content.text()
    return await Promise.allSettled([
      this.semanticNormalize(ctx, normalizer, bookmarkId, bookmark.title, body),
      this.fulltextNormalize(ctx, normalizer, bookmarkId, bookmark.title, body)
    ])
  }

  public async addSearchRecord(ctx: ContextManager, bookmarkId: number, title: string, content: string) {
    const normalizer = new Normalizer(ctx.env)
    return await Promise.allSettled([this.fulltextNormalize(ctx, normalizer, bookmarkId, title, content), this.semanticNormalize(ctx, normalizer, bookmarkId, title, content)])
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
        res.map((item, idx) => ({
          bookmark_id: bookmarkId,
          content: item.normalized_content,
          rawContent: item.raw_content,
          title: item.normalized_title,
          rawTitle: item.raw_title,
          shard_idx: idx
        }))
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
    await Promise.all([ctx.env.KV.delete(`search:valid_bm_ids:${userId}`), ctx.env.KV.delete(`search:bm_shard:${userId}`), ctx.env.KV.delete(`search:bm_rows:${userId}`)])
    console.log(`[cache] cleared search cache for user ${userId}`)
  }
}
