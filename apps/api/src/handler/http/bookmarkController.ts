import type {
  AddBookmarkRequest,
  AddUrlBookmarkRequest,
  BookmarkIdRequest,
  ArchiveBookmarkRequest,
  StarBookmarkRequest,
  RenameBookmarkRequest,
  AddBookmarkTagRequest,
  SetBookmarkTagsRequest,
  RemoveBookmarkTagRequest,
  AddBookmarkResponse
} from '@slax-reader/contracts'
import { decodeIdList } from './tagController'
import { Failed, Successed } from '../../utils/responseUtils'
import { ContextManager } from '@/utils/context'
import { BookmarkChangesSyncTooOldError, BookmarkContentNotFoundError, ErrorConnectionParam, ErrorParam, ServerError } from '../../const/err'
import { RequestUtils } from '../../utils/requestUtils'
import { callbackType } from '../../infra/queue/queueClient'
import { bookmarkPO } from '../../infra/repository/dbBookmark'
import { Controller } from '../../decorators/controller'
import { Get, Post } from '../../decorators/route'
import { inject } from '../../decorators/di'
import { BookmarkOrchestrator } from '../../domain/orchestrator/bookmark'
import { BookmarkAddOrchestrator } from '../../domain/orchestrator/bookmarkAdd'
import { TagService } from '../../domain/tag'
import { BookmarkService } from '../../domain/bookmark'
import { CollectionService } from '../../domain/collection'
import { ImportService } from '../../domain/import'
import { SearchService } from '../../domain/search'
import { UrlParserHandler } from '../../domain/orchestrator/urlParser'
import { corsHeader } from '@/middleware/cors'
import { UserDeletionService } from '@/domain/userDeletion'
import { CrawlService } from '@/domain/crawl'
import { LogsService } from '../../domain/logs'
import { LabService } from '../../domain/lab'
import { ImportFormatError, isNewImportSource, readImportBody } from '@/utils/importFormats'
import { submitServerEvent, bookmarkEventProperties as propertiesForBookmark, getEventContext, type BookmarkEventProperties } from '../../domain/events'
import { URLPolicie } from '@/utils/urlPolicie'

@Controller('/v1/bookmark')
export class BookmarkController {
  constructor(
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(CollectionService) private collectionService: CollectionService,
    @inject(BookmarkOrchestrator) private bookmarkOrchestrator: BookmarkOrchestrator,
    @inject(BookmarkAddOrchestrator) private bookmarkAddOrchestrator: BookmarkAddOrchestrator,
    @inject(ImportService) private importService: ImportService,
    @inject(SearchService) private searchService: SearchService,
    @inject(TagService) private tagService: TagService,
    @inject(UrlParserHandler) private urlParserHandler: UrlParserHandler,
    @inject(UserDeletionService) private userDeletionService: UserDeletionService,
    @inject(CrawlService) private crawlService: CrawlService,
    @inject(LogsService) private logsService: LogsService
  ) {}

  @Get('/export')
  public async handleUserExportBookmarksRequest(ctx: ContextManager, request: Request) {
    const cursor = new URL(request.url).searchParams.get('cursor')
    const response = Successed(await this.bookmarkService.exportBookmarks(ctx, cursor))
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }

  private bookmarkSource(ctx: ContextManager, request?: Request) {
    return getEventContext(ctx, request).source
  }

  private urlDomain(value: string) {
    try {
      return new URL(value).hostname
    } catch {
      return ''
    }
  }

  private contentTypeForUrl(ctx: ContextManager, value: string): BookmarkEventProperties['content_type'] {
    try {
      return new URLPolicie(ctx.env, new URL(value)).isUrlShortcut() ? 'url_only' : 'full_content'
    } catch {
      return 'full_content'
    }
  }

  private async bookmarkEventProperties(ctx: ContextManager, bmId: number): Promise<BookmarkEventProperties | null> {
    if (typeof this.bookmarkService?.getUserBookmarkWithDetail !== 'function') return null
    const relation = await this.bookmarkEventState(ctx, bmId)
    if (!relation?.bookmark || !relation.uuid) return null
    return propertiesForBookmark(relation, this.bookmarkSource(ctx))
  }

  private async bookmarkEventState(ctx: ContextManager, bmId: number) {
    try {
      return await this.bookmarkService.getUserBookmarkWithDetail(ctx.getUserId(), bmId)
    } catch (error) {
      console.error('[events] failed to read bookmark state:', error)
      return undefined
    }
  }

  private async submitBookmarkEvent(ctx: ContextManager, request: Request, eventName: string, bmId: number) {
    try {
      const properties = await this.bookmarkEventProperties(ctx, bmId)
      if (properties) submitServerEvent(ctx, request, eventName, { ...properties, source: this.bookmarkSource(ctx, request) })
    } catch (error) {
      console.error(`[events] failed to load ${eventName} attributes:`, error)
    }
  }

  private saveFailed(ctx: ContextManager, request: Request, targetUrl = '') {
    submitServerEvent(ctx, request, 'bookmark_save_failed', {
      // A rejected request has no persisted bookmark relation yet.
      bookmark_id: null,
      error_class: 'bookmark_add',
      url_domain: this.urlDomain(targetUrl),
      source: this.bookmarkSource(ctx, request),
      content_type: this.contentTypeForUrl(ctx, targetUrl)
    })
  }

  /**
   * 新增收藏
   */
  @Post('/add')
  public async handleUserAddBookmarkRequest(ctx: ContextManager, request: Request) {
    await this.userDeletionService.ensureUserNotDeleted(ctx.getUserId())

    const req = await RequestUtils.json<AddBookmarkRequest>(request).catch(() => null)
    if (!req || typeof req.target_url !== 'string' || !req.target_url.trim()) {
      this.saveFailed(ctx, request)
      return Failed(ErrorParam())
    }
    console.log(`user ${ctx.getUserId()} add ${req.target_url} ${req.target_title} bookmark`)

    try {
      const result = await this.bookmarkAddOrchestrator.addByContent(ctx, req)

      ctx.execution.waitUntil(this.logsService.track(ctx.getUserId(), 'bookmark_add', { bookmark_id: result.bookmarkId, status: 'success' }))
      await this.submitBookmarkEvent(ctx, request, 'bookmark_saved', result.bookmarkId)

      if (result.isShortcut) {
        return Successed({ bmId: ctx.hashIds.encodeId(result.bookmarkId) } satisfies AddBookmarkResponse)
      }

      if (result.workflowParams) {
        ctx.execution.waitUntil(this.bookmarkAddOrchestrator.kickoffWorkflow(ctx, result.workflowParams))
      }

      return Successed({ bmId: ctx.hashIds.encodeId(result.bookmarkId) } satisfies AddBookmarkResponse)
    } catch (e) {
      this.saveFailed(ctx, request, req.target_url)
      throw e
    }
  }

  /**
   * 使用URL新增收藏
   */
  @Post('/add_url')
  public async handleUserAddUrlBookmarkRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<AddUrlBookmarkRequest>(request).catch(() => null)
    if (!req || typeof req.target_url !== 'string' || !req.target_url.trim()) {
      this.saveFailed(ctx, request)
      return Failed(ErrorParam())
    }

    console.log(`user ${ctx.getUserId()} add ${req.target_url} ${req.target_title} bookmark`)

    if (!req.target_url.startsWith('https://') && !req.target_url.startsWith('http://')) {
      req.target_url = 'https://' + req.target_url
    }

    try {
      const result = await this.bookmarkAddOrchestrator.addByUrl(ctx, req, { callback: callbackType.NOT_CALLBACK })

      ctx.execution.waitUntil(this.logsService.track(ctx.getUserId(), 'bookmark_add', { bookmark_id: result.bookmarkId, status: 'success' }))
      await this.submitBookmarkEvent(ctx, request, 'bookmark_saved', result.bookmarkId)

      // 非 shortcut 触发 workflow
      if (!result.isShortcut && result.workflowParams) {
        ctx.execution.waitUntil(this.bookmarkAddOrchestrator.kickoffWorkflow(ctx, result.workflowParams))
      }

      // 按现有客户端约定固定返回空字符串
      return Successed({ bmId: '' } satisfies AddBookmarkResponse)
    } catch (e) {
      this.saveFailed(ctx, request, req.target_url)
      // Labs 拦截是预期行为：文案原样透出，前端据 LAB_FEATURE_DISABLED 引导去设置页
      if (LabService.isLabDisabledError(e)) {
        ctx.execution.waitUntil(this.logsService.track(ctx.getUserId(), 'bookmark_add', { channel: 'add_url', status: 'lab_disabled' }))
        return Failed(e)
      }
      // orchestrator 内部已推飞书 'pre_workflow.invalid_input'
      ctx.execution.waitUntil(this.logsService.track(ctx.getUserId(), 'bookmark_add', { channel: 'add_url', status: 'failed' }))
      return Failed(ErrorParam())
    }
  }

  /**
   * 删除收藏
   */
  @Post('/del')
  public async handleUserDeleteBookmarkRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<BookmarkIdRequest>(request)
    console.log(`user ${ctx.getUserId()} delete ${req.bookmark_id} bookmark`)

    const bmId = ctx.hashIds.decodeId(req.bookmark_id)
    if (bmId < 1) return Failed(ErrorParam())

    const properties = await this.bookmarkEventProperties(ctx, bmId)
    const res = await this.bookmarkService.deleteBookmark(ctx, ctx.getUserId(), bmId)
    const remaining = await this.bookmarkEventState(ctx, bmId)
    if (properties && remaining === null) submitServerEvent(ctx, request, 'bookmark_deleted', { ...properties, source: this.bookmarkSource(ctx, request) })
    return Successed(res)
  }

  /**
   * 将收藏丢进垃圾篓
   */
  @Post('/trash')
  public async handleUserTrashBookmarkRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<BookmarkIdRequest>(request)
    console.log(`user ${ctx.getUserId()} trash ${req.bookmark_id} bookmark`)

    const bmId = ctx.hashIds.decodeId(req.bookmark_id)
    if (bmId < 1) return Failed(ErrorParam())

    const previous = await this.bookmarkEventState(ctx, bmId)
    const res = await this.bookmarkService.trashBookmark(ctx, bmId)
    ctx.execution.waitUntil(this.logsService.track(ctx.getUserId(), 'trash', { bookmark_id: bmId, channel: 'rest' }))
    const current = await this.bookmarkEventState(ctx, bmId)
    if (previous?.bookmark && !previous.deleted_at && (current === null || current?.deleted_at)) {
      submitServerEvent(ctx, request, 'bookmark_deleted', propertiesForBookmark(previous, this.bookmarkSource(ctx, request)))
    }
    return Successed(res)
  }

  /**
   * 将收藏移出垃圾篓
   */
  @Post('/trash_revert')
  public async handleUserTrashRevertBookmarkRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<BookmarkIdRequest>(request)
    console.log(`user ${ctx.getUserId()} revert ${req.bookmark_id} bookmark`)

    const bmId = ctx.hashIds.decodeId(req.bookmark_id)
    if (bmId < 1) return Failed(ErrorParam())

    const res = await this.bookmarkService.trashRevertBookmark(ctx, bmId)
    ctx.execution.waitUntil(this.logsService.track(ctx.getUserId(), 'trash_revert', { bookmark_id: bmId, channel: 'rest' }))
    return Successed(res)
  }

  /**
   * 获取收藏列表
   */
  @Get('/list')
  public async handleUserGetBookmarksRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.query<{
      page: number
      size: number
      filter?: string
      topic_id?: number
      topic_ids?: string
      collection_id?: number
      source?: string
    }>(request)
    if (params.page < 1 || params.size < 1 || params.page === undefined || params.size === undefined) {
      return Failed(ErrorParam())
    }

    let res: bookmarkPO[] = []
    if (params.filter === 'topics') {
      // topic_ids=a,b filters by intersection; topic_id kept for older clients
      const topicIds = decodeIdList(ctx, params.topic_ids || params.topic_id)
      if (topicIds.length < 1) return Failed(ErrorParam())

      res = await this.bookmarkService.bookmarkListByTopics(ctx, Number(params.page), Number(params.size), topicIds)
    } else if (params.filter === 'collections') {
      params.collection_id = ctx.hashIds.decodeId(params.collection_id || 0)
      if (params.collection_id < 1) return Failed(ErrorParam())

      res = await this.collectionService.getUserCollectionList(ctx, Number(params.page), Number(params.size), params.collection_id)
    } else {
      res = await this.bookmarkService.bookmarkList(ctx, Number(params.page), Number(params.size), params.filter || 'all', params.source)
    }

    return Successed(res)
  }

  /**
   * 获取收藏详情
   */
  @Get('/detail')
  public async handleUserGetBookmarkDetailRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.query<{ bookmark_id: string }>(request)
    if (!params || !params.bookmark_id) return Failed(ErrorParam())

    const bmId = ctx.hashIds.decodeId(Number(params.bookmark_id))
    if (bmId < 1 || isNaN(bmId)) return Failed(ErrorParam())

    const res = await this.bookmarkOrchestrator.bookmarkDetail(ctx, bmId)
    return Successed(res)
  }

  /**
   * 获取收藏元数据
   */
  @Get('/metadata')
  public async handleUserGetBookmarkMetadataRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.query<{ bookmark_uid: string }>(request)
    if (!params || !params.bookmark_uid) return Failed(ErrorParam())

    const res = await this.bookmarkOrchestrator.bookmarkMetadata(ctx, params.bookmark_uid)
    return Successed(res)
  }

  /**
   * 判断收藏是否存在
   */
  @Post('/exists')
  public async handleUserBookmarkExistsRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<{ target_url: string }>(request)
    if (!req || !req.target_url) return Failed(ErrorParam())

    const res = await this.bookmarkService.bookmarkExists(ctx, req.target_url)
    return Successed(res)
  }

  /**
   * 内容归档/稍后读
   */
  @Post('/archive')
  public async handleUserBookmarkArchiveRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<ArchiveBookmarkRequest>(request)
    if (!req || (!req.bookmark_id && !req.bookmark_uid) || !req.status) return Failed(ErrorParam())

    const bmId = await this.bookmarkService.getBookmarkId(ctx, { bmId: req.bookmark_id, bmUId: req.bookmark_uid })
    if (bmId < 1) return Failed(ErrorParam())

    const previous = await this.bookmarkEventState(ctx, bmId)
    await this.bookmarkService.bookmarkArchive(ctx, bmId, req.status)
    ctx.execution.waitUntil(this.logsService.track(ctx.getUserId(), req.status))

    const current = await this.bookmarkEventState(ctx, bmId)
    if (previous && current?.bookmark && previous.archive_status !== current.archive_status && [0, 1].includes(current.archive_status)) {
      submitServerEvent(ctx, request, current.archive_status === 1 ? 'bookmark_archived' : 'bookmark_unarchived', propertiesForBookmark(current, this.bookmarkSource(ctx, request)))
    }

    return Successed(null)
  }

  /**
   * 加星/取消加星
   */
  @Post('/star')
  public async handleUserBookmarkStarRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<StarBookmarkRequest>(request)
    if (!req || (!req.bookmark_id && !req.bookmark_uid) || !req.status) return Failed(ErrorParam())

    const bmId = await this.bookmarkService.getBookmarkId(ctx, { bmId: req.bookmark_id, bmUId: req.bookmark_uid })
    if (bmId < 1) return Failed(ErrorParam())

    const previous = await this.bookmarkEventState(ctx, bmId)
    await this.bookmarkOrchestrator.bookmarkStar(ctx, bmId, req.status)
    // 非 star 一律按取消，两向都埋
    ctx.execution.waitUntil(this.logsService.track(ctx.getUserId(), req.status === 'star' ? 'star' : 'unstar', { bookmark_id: bmId, channel: 'rest' }))

    const current = await this.bookmarkEventState(ctx, bmId)
    if (previous && current?.bookmark && previous.is_starred !== current.is_starred) {
      submitServerEvent(ctx, request, current.is_starred ? 'bookmark_starred' : 'bookmark_unstarred', propertiesForBookmark(current, this.bookmarkSource(ctx, request)))
    }

    return Successed(null)
  }

  /**
   * 修改别名
   */
  @Post('/alias_title')
  public async handleUserBookmarkAliasTitleRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<RenameBookmarkRequest>(request)
    if (!req || (!req.bookmark_id && !req.bookmark_uid) || !req.alias_title) return Failed(ErrorParam())

    const bmId = await this.bookmarkService.getBookmarkId(ctx, { bmId: req.bookmark_id, bmUId: req.bookmark_uid })
    if (bmId < 1) return Failed(ErrorParam())

    await this.bookmarkService.bookmarkAliasTitle(ctx, bmId, req.alias_title)
    return Successed(null)
  }

  /**
   * 导入第三方平台书签
   */
  @Post('/import')
  public async handleUserImportBookmarkRequest(ctx: ContextManager, request: Request) {
    const query = await RequestUtils.query<{ type: string; file_type: string; include_feed?: string }>(request)
    if (!query || !query.type || !query.file_type || (!['pocket', 'omnivore'].includes(query.type) && !isNewImportSource(query.type))) {
      return Failed(ErrorParam())
    }

    await this.importService.ensureImportCapacity(ctx)

    try {
      const importData = await readImportBody(request)
      const id = await this.importService.importBookmark(ctx, query.type, query.file_type, importData, query.include_feed === 'true')
      return Successed({ id: ctx.hashIds.encodeId(id) })
    } catch (error) {
      if (error instanceof ImportFormatError || error instanceof SyntaxError) return Failed(ErrorParam())
      throw error
    }
  }

  @Post('/import_preview')
  public async handleUserImportPreviewRequest(ctx: ContextManager, request: Request) {
    const query = await RequestUtils.query<{ type: string; file_type: string; include_feed?: string }>(request)
    if (!query.file_type || !isNewImportSource(query.type)) return Failed(ErrorParam())
    try {
      return Successed(this.importService.previewImport(query.type, await readImportBody(request), query.include_feed === 'true'))
    } catch (error) {
      if (error instanceof ImportFormatError || error instanceof SyntaxError) return Failed(ErrorParam())
      throw error
    }
  }

  /**
   * 获取导入书签状态
   */
  @Get('/import_status')
  public async handleUserImportBookmarkStatusRequest(ctx: ContextManager, request: Request) {
    const taskStatus = await this.importService.getImportInfo(ctx)
    return Successed(taskStatus)
  }

  /**
   * 获取导入失败的书签列表
   */
  @Get('/import_failed')
  public async handleUserImportFailedBookmarksRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.query<{ import_id: string; page: string; limit: string }>(request)
    if (!params || !params.import_id) return Failed(ErrorParam())

    const importId = ctx.hashIds.decodeId(Number(params.import_id))
    if (importId < 1) return Failed(ErrorParam())

    const page = parseInt(params.page) || 1
    const limit = parseInt(params.limit) || 20

    if (page < 1 || limit < 1 || limit > 100) {
      return Failed(ErrorParam())
    }

    try {
      const res = await this.bookmarkService.getImportFailedBookmarks(ctx, importId, page, limit)
      return Successed(res)
    } catch (error) {
      console.error('getImportFailedBookmarks error:', error)
      return Failed(ErrorParam())
    }
  }

  /**
   * 批量删除导入失败的书签
   */
  @Post('/import/batch_delete')
  public async handleUserBatchDeleteFailedBookmarksRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<{ bookmark_ids: number[]; import_id: number; delete_all: boolean }>(request)
    // 校验参数是否正确
    // 如果不是删除全部且没传ids，需要报错
    if (!req.import_id) return Failed(ErrorParam())

    const importId = ctx.hashIds.decodeId(req.import_id)
    if (importId < 1) return Failed(ErrorParam())

    const decodedIds = req.bookmark_ids.map(id => ctx.hashIds.decodeId(id)).filter(id => id > 0)
    if (!req.delete_all && (!decodedIds || decodedIds.length === 0)) return Failed(ErrorParam())

    try {
      await this.bookmarkService.batchDeleteFailedImportBookmarkRelations(ctx.getUserId(), importId, decodedIds, req.delete_all)
      return Successed({})
    } catch (error) {
      console.error('batchDeleteImportFailedBookmarks error:', error)
      return Failed(ErrorParam())
    }
  }

  /**
   * 获取书签对应的ai总结列表数据
   */
  @Get('/summaries')
  public async handleUserBookmarkSummariesRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.query<{ bookmark_id?: number; share_code?: string; cb_id?: number; collection_code?: string; bookmark_uid?: string }>(request)
    if (!params || (!params.bookmark_id && !params.share_code && !(params.cb_id && params.collection_code) && !params.bookmark_uid)) return Failed(ErrorParam())

    const bmId = await this.bookmarkService.getBookmarkId(ctx, {
      bmId: params.bookmark_id,
      shareCode: params.share_code,
      cbId: params.cb_id,
      collectionCode: params.collection_code,
      bmUId: params.bookmark_uid
    })
    if (!bmId || bmId < 1) return Failed(ErrorParam())

    const res = await this.bookmarkService.getBookmarkSummaries(ctx, bmId)
    return Successed(res)
  }

  /**
   * 搜索书签
   */
  @Post('/search')
  public async handleUserBookmarkSearchRequest(ctx: ContextManager, request: Request) {
    const params = await RequestUtils.json<{ keyword: string }>(request)
    if (!params || !params.keyword) return Failed(ErrorParam())

    const searchResult = await this.searchService.hybridSearch(ctx, params.keyword)
    return Successed(
      searchResult.map(item => {
        item.bookmark_id = ctx.hashIds.encodeId(item.bookmark_id)
        return item
      })
    )
  }

  /**
   * TEMP: 本地开发环境修复全文索引数据缺失，用完即删
   */
  @Post('/dev_rebuild_search_index')
  public async handleDevRebuildSearchIndex(ctx: ContextManager, request: Request) {
    if (ctx.env.RUN_ENV !== 'development') return new Response(null, { status: 404 })
    try {
      const { limit = 10 } = await RequestUtils.json<{ limit?: number }>(request)
      if (!Number.isInteger(limit) || limit < 1 || limit > 100) return Failed(ErrorParam())

      const bmItems = await this.searchService.getUserBookmarkItem(ctx)
      console.log(`[dev_rebuild] found ${bmItems.length} bookmarks for user ${ctx.getUserId()}, will process ${limit}`)

      const result = { total: bmItems.length, processed: 0, success: 0, failed: 0, errors: [] as string[] }

      // 只处理前 N 个，避免超时
      const toProcess = bmItems.slice(0, limit)

      for (const item of toProcess) {
        try {
          await this.searchService.addSearchRecordByBmId(ctx, item.bmId)
          result.success++
          console.log(`✓ [${result.processed + 1}/${toProcess.length}] bookmark ${item.bmId}`)
        } catch (e) {
          result.failed++
          const msg = e instanceof Error ? e.message : String(e)
          result.errors.push(`bookmark ${item.bmId}: ${msg}`)
          console.error(`✗ [${result.processed + 1}/${toProcess.length}] bookmark ${item.bmId}: ${msg}`)
        }
        result.processed++

        // 每处理一个就休息 200ms，避免过载
        await new Promise(resolve => setTimeout(resolve, 200))
      }

      console.log(`[dev_rebuild] done: ${result.success} success, ${result.failed} failed out of ${result.processed} processed`)
      return Successed(result)
    } catch (e) {
      console.error('[dev_rebuild] fatal error:', e)
      return Failed(ServerError())
    }
  }

  /**
   * TEMP: 清除搜索相关的 KV 缓存
   */
  @Post('/dev_clear_search_cache')
  public async handleDevClearSearchCache(ctx: ContextManager, request: Request) {
    const userId = ctx.getUserId()
    await Promise.all([ctx.env.KV.delete(`search:bm_shard:${userId}`), ctx.env.KV.delete(`search:bm_rows:${userId}`), ctx.env.KV.delete(`search:valid_bm_ids:${userId}`)])
    console.log(`[dev_clear_cache] cleared search cache for user ${userId}`)
    return Successed({ message: 'cache cleared' })
  }

  /**
   * 添加标签
   */
  @Post('/add_tag')
  public async handleUserBookmarkAddTagRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<AddBookmarkTagRequest>(request)
    if (!req || (!req.bookmark_id && !req.bookmark_uid)) return Failed(ErrorParam())

    const bmId = await this.bookmarkService.getBookmarkId(ctx, { bmId: req.bookmark_id, bmUId: req.bookmark_uid })
    if (bmId < 1) return Failed(ErrorParam())

    const res = await this.tagService.addBookmarkTag(ctx, bmId, req.tag_name, req.tag_id)
    return Successed(res)
  }

  /**
   * 添加标签
   */
  @Post('/add_tags')
  public async handleUserBookmarkAddTagsRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<SetBookmarkTagsRequest>(request)
    if (!req || (!req.bookmark_id && !req.bookmark_uid) || !req.tags || !req.tags.length) return Failed(ErrorParam())

    const bmId = await this.bookmarkService.getBookmarkId(ctx, { bmId: req.bookmark_id, bmUId: req.bookmark_uid })
    if (bmId < 1) return Failed(ErrorParam())

    const res = await this.tagService.addBookmarkTags(ctx, bmId, req.tags)
    return Successed(res)
  }

  /**
   * 删除标签
   */
  @Post('/del_tag')
  public async handleUserBookmarkDelTagRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<RemoveBookmarkTagRequest>(request)
    if (!req || (!req.bookmark_id && !req.bookmark_uid) || !req.tag_id) return Failed(ErrorParam())

    const bmId = await this.bookmarkService.getBookmarkId(ctx, { bmId: req.bookmark_id, bmUId: req.bookmark_uid })
    const tagId = ctx.hashIds.decodeId(req.tag_id)
    if (bmId < 1 || !tagId) return Failed(ErrorParam())

    await this.tagService.deleteBookmarkTag(ctx, bmId, tagId)
    return Successed(null)
  }

  /**
   * 获取全量书签记录
   */
  @Get('/all_changes')
  public async handleUserGetAllBookmarkChangesRequest(ctx: ContextManager, request: Request) {
    await this.userDeletionService.ensureUserNotDeleted(ctx.getUserId())
    console.log(`user ${ctx.getUserId()} get all changes`)

    const res = await this.bookmarkService.getAllBookmarkChangesLog(ctx, ctx.getUserId())
    return Successed(res)
  }

  /**
   * 获取增量书签记录
   */
  @Get('/partial_changes')
  public async handleUserGetPartialBookmarkChangesRequest(ctx: ContextManager, request: Request) {
    await this.userDeletionService.ensureUserNotDeleted(ctx.getUserId())
    const req = await RequestUtils.query<{ previous_sync: number }>(request)

    // 校验 previous_sync 的时间戳合法性
    if (!req.previous_sync || isNaN(req.previous_sync) || req.previous_sync < 0 || `${req.previous_sync}`.length !== 13) {
      return Failed(ErrorParam())
    }

    // 判断时间是否比现在晚15天
    if (req.previous_sync < Date.now() - 15 * 24 * 60 * 60 * 1000) {
      return Failed(BookmarkChangesSyncTooOldError())
    }

    const res = await this.bookmarkService.getPartialBookmarkChangesLog(ctx, ctx.getUserId(), Number(req.previous_sync))
    return Successed(res)
  }

  /**
   * 获取连接实时增量书签记录 socket
   */
  @Get('/connect_changes')
  public async handleUserGetConnectBookmarkChangesRequest(ctx: ContextManager, request: Request) {
    const upgradeHeader = request.headers.get('Upgrade')
    if (!upgradeHeader || upgradeHeader !== 'websocket') return Failed(ErrorConnectionParam())
    const query = await RequestUtils.query<{ token: string }>(request)
    if (!query.token) return Failed(ErrorConnectionParam())

    return await this.bookmarkService.connectBookmarkChanges(ctx, request, query.token)
  }

  @Get('/mark_list')
  public async handleUserGetBookmarkMarkListRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.query<{ bookmark_id: number; bookmark_uid: string }>(request)
    if (!req || (!req.bookmark_id && !req.bookmark_uid)) return Failed(ErrorParam())

    const bmId = await this.bookmarkService.getBookmarkId(ctx, { bmId: req.bookmark_id, bmUId: req.bookmark_uid })
    if (bmId < 1) return Failed(ErrorParam())

    const res = await this.bookmarkOrchestrator.getBookmarkMarkList(ctx, ctx.getUserId(), bmId)
    return Successed(res)
  }

  @Get('/brief')
  public async handleUserTestRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.query<{ bookmark_id: number; bookmark_uid: string }>(request)
    if (!req || (!req.bookmark_id && !req.bookmark_uid)) return Failed(ErrorParam())

    const bmId = await this.bookmarkService.getBookmarkId(ctx, { bmId: req.bookmark_id, bmUId: req.bookmark_uid })
    if (bmId < 1) return Failed(ErrorParam())

    const res = await this.bookmarkOrchestrator.getBookmarkBriefInfo(ctx, bmId)
    return Successed(res)
  }

  @Post('/content')
  public async handleStreamBookmarkContent(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{ bookmark_uid: string }>(request)
    if (!req || !req.bookmark_uid) return Failed(ErrorParam())

    const stream = await this.bookmarkService.getStreamBookmarkContent(ctx, req.bookmark_uid)

    if (!stream) return Failed(BookmarkContentNotFoundError())

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache'
      }
    })
  }

  @Post('/overview')
  public async handleUserGetBookmarkOverviewRequest(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{ bookmark_id: number; bookmark_uid: string }>(request)
    if (!req || (!req.bookmark_id && !req.bookmark_uid)) return Failed(ErrorParam())

    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    ctx.execution.waitUntil(
      this.bookmarkOrchestrator
        .generateBookmarkOverviewStream(ctx, { bmId: req.bookmark_id, bmUId: req.bookmark_uid, writer, encoder, isForce: false })
        .catch(async error => {
          if (!error) return
          try {
            await writer.write(
              encoder.encode(
                JSON.stringify({
                  type: 'error',
                  message: error instanceof Error ? error.message : 'Unknown error'
                }) + '\n'
              )
            )
          } catch {}
        })
        .finally(() => writer.close().catch(() => {}))
    )
    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', ...corsHeader }
    })
  }

  @Post('/outline')
  public async handlerUserGetBookmarkOutlineRequest(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<{ bookmark_id: number; bookmark_uid: string }>(request)
    if (!req || (!req.bookmark_id && !req.bookmark_uid)) return Failed(ErrorParam())

    const { readable, writable } = new TransformStream()
    const writer = writable.getWriter()
    const encoder = new TextEncoder()

    ctx.execution.waitUntil(
      this.bookmarkOrchestrator
        .generateBookmarkOutlineStream(ctx, { bmId: req.bookmark_id, bmUId: req.bookmark_uid, writer, encoder, isForce: false })
        .catch(async error => {
          if (!error) return
          try {
            await writer.write(
              encoder.encode(
                JSON.stringify({
                  type: 'error',
                  message: error instanceof Error ? error.message : 'Unknown error'
                }) + '\n'
              )
            )
          } catch {}
        })
        .finally(() => writer.close().catch(() => {}))
    )

    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', ...corsHeader }
    })
  }
}
