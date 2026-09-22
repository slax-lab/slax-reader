import { BookmarkSearchRepo, bookmarkRowPO } from '@/infra/repository/dbBookmarkSearch'
import { BookmarkRepo, bookmarkShardPO } from '@/infra/repository/dbBookmark'
import { inject, injectable } from '@/decorators/di'
import { SubscriptionRepo } from '@/infra/repository/dbSubscription'
import { VectorizeRepo } from '@/infra/repository/dbVectorize'
import { ContextManager } from '@/utils/context'
import { Normalizer } from '@/utils/hybridSearch/normalizer'
import { vectorizeData, embedding } from '@/utils/hybridSearch/vectorize'
import { mapHighlight } from '@/utils/hybridSearch/highlightMatch'
import { BookmarkNotFoundError } from '@/const/err'
import { rerank } from '@/utils/hybridSearch/rerank'
import { escapeHtml } from '@/utils/escape'

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

@injectable()
export class SearchService {
  constructor(
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo,
    @inject(SubscriptionRepo) private subscriptionRepo: SubscriptionRepo,
    @inject(BookmarkSearchRepo) private bookmarkSearchRepo: BookmarkSearchRepo,
    @inject(VectorizeRepo) private dbVectorize: VectorizeRepo
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

    const bmMap = new Map<number, { shardIdx: number; rowId: number }>()

    shardList.forEach(item => {
      if (validBookmarkSet.has(item.bookmark_id)) {
        bmMap.set(item.bookmark_id, { shardIdx: item.bucket_idx, rowId: 0 })
      }
    })
    rowIds.forEach(item => {
      if (!validBookmarkSet.has(item.bookmark_id)) return // 过滤掉回收站书签
      const existing = bmMap.get(item.bookmark_id)
      if (existing) {
        existing.rowId = item.id
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

  public async hybridSearch(ctx: ContextManager, fulltextContent: string, vectorizeContent: string[] = []) {
    const userInfo = await this.subscriptionRepo.getUserSubscriptionInfo(ctx.getUserId())
    if (userInfo?.subscription_end_time && userInfo.subscription_end_time > new Date()) {
      if (vectorizeContent.length < 1) vectorizeContent = [fulltextContent]
    }
    if (fulltextContent.length < 1 && vectorizeContent.length < 1) return []
    if (vectorizeContent.length < 1) vectorizeContent = [fulltextContent]

    const normalizer = new Normalizer(ctx.env)
    // 查找用户拥有的bookmark list
    const t1 = performance.now()

    const [bmListRes, vectorizeResultRes, jbSearchContentRes] = await Promise.allSettled([
      this.getUserBookmarkItem(ctx),
      embedding(ctx.env, vectorizeContent),
      normalizer.processSearchKeyword(fulltextContent)
    ])
    console.log(`get base data time: ${performance.now() - t1} ms`)

    const bmList = bmListRes.status === 'fulfilled' ? bmListRes.value : []
    const vectorizeResult = vectorizeResultRes.status === 'fulfilled' ? vectorizeResultRes.value : []
    const jbSearchContent = jbSearchContentRes.status === 'fulfilled' ? jbSearchContentRes.value : ''

    // 混合搜索
    const t2 = performance.now()
    let [fulltextResult, semanticResult] = await Promise.allSettled([this.fulltextSearch(ctx, jbSearchContent, bmList), this.semanticSearch(ctx, vectorizeResult, bmList)])
    const fulltextRes = fulltextResult.status === 'fulfilled' ? fulltextResult.value : []
    const semanticRes = semanticResult.status === 'fulfilled' ? semanticResult.value : []

    console.log(`hybrid search time: ${performance.now() - t2} ms, fulltext: ${fulltextRes.length}, semantic: ${semanticRes.length}`)

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

    const matchedIds = Object.keys(hybridSearchMap).map(Number)

    const t3 = performance.now()
    const [rawList, uuidMap] = await Promise.all([
      returnTableIds.length > 0 ? this.bookmarkSearchRepo.getBookmarkRaw(returnTableIds) : Promise.resolve([] as Awaited<ReturnType<BookmarkSearchRepo['getBookmarkRaw']>>),
      this.bookmarkRepo.getUserBookmarkUuidsByBmIds(ctx.getUserId(), matchedIds)
    ])

    rawList.forEach(item => {
      if (!hybridSearchMap[item.bookmark_id]) return
      hybridSearchMap[item.bookmark_id].highlight_title = item.raw_title
      hybridSearchMap[item.bookmark_id].highlight_content = item.raw_content
    })
    console.log(`get raw & uuid data cost: ${performance.now() - t3} ms`)

    // return processHybridSearchRerank(env, fulltextContent, hybridSearchMap)
    return this.processHybridSearchList(hybridSearchMap, uuidMap)
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
   * 全文搜索
   * @param ctx
   * @param env
   * @param fulltextContent
   * @param db
   * @param userBookmarkItem
   * @returns
   */
  public async fulltextSearch(ctx: ContextManager, jbSearchContent: string, userBookmarkItem: userBookmarkItem[]): Promise<fulltextMatchItem[]> {
    if (userBookmarkItem.length < 1 || jbSearchContent.length < 1) return []

    const t1 = performance.now()
    // bm25单次搜50条左右的文章效率最高
    // 分割bmIds为50条一组
    // WARING: 这里只能是50条，不能改为别的。如果要改，必须要用explain Query plan真实SQL检查一次是否会全表搜索
    const bmIdGroups = userBookmarkItem.map((_, i) => userBookmarkItem.slice(i * 50, (i + 1) * 50))
    const fullTextPromises = []
    for (const bmIdGroup of bmIdGroups) {
      if (bmIdGroup.length < 1) continue
      fullTextPromises.push(
        this.bookmarkSearchRepo.seachBM25(
          bmIdGroup.map(item => item.rowId),
          jbSearchContent
        )
      )
    }

    console.log(`user ${ctx.getUserId()} fulltext search, \nsearch content: ${jbSearchContent}, bmIds: ${userBookmarkItem.length}, tasks: ${fullTextPromises.length}`)

    const res = (await Promise.allSettled(fullTextPromises))
      .filter(item => item.status === 'fulfilled')
      .flatMap(item => item.value)
      .filter(item => !!item)
      .sort((a, b) => b.score - a.score)

    console.log(`fulltext search time: ${performance.now() - t1} ms`)
    // const consoleRes = res.map(item => ({
    //   bookmark_id: item.bookmark_id,
    //   score: item.score,
    //   content_snippet: item.content_snippet,
    //   title_snippet: item.title_snippet
    // }))
    // console.log(`fulltext search result: ${JSON.stringify(consoleRes)}`)
    return res
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
