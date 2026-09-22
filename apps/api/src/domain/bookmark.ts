import type { MarkDetail } from '@slax-reader/contracts'
import type { BookmarkExportResponse, AddBookmarkRequest as addBookmarkReq, AddUrlBookmarkRequest as addUrlBookmarkReq } from '@slax-reader/contracts'
import { bookmarkPO, BookmarkRepo, queueStatus, bookmarkParsePO, AigcBatchTaskStatus, bookmarkFetchRetryStatus, bookmarkParseStatus } from '@/infra/repository/dbBookmark'
import { BucketClient } from '@/infra/repository/bucketClient'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { BookmarkSearchRepo } from '@/infra/repository/dbBookmarkSearch'
import { VectorizeRepo } from '@/infra/repository/dbVectorize'
import { MarkRepo } from '@/infra/repository/dbMark'
import { UserRepo } from '@/infra/repository/dbUser'
import { callbackType, QueueClient, queueParseMessage } from '@/infra/queue/queueClient'
import { ContextManager } from '@/utils/context'
import { NotificationMessage } from '@/infra/message/notification'
import { parserType, processTargetUrl, URLPolicie } from '@/utils/urlPolicie'
import { ServerError, ErrorParam, BookmarkContentNotFoundError, BookmarkNotFoundError, CreateBookmarkFailError, UserNotFoundError, BlockTargetUrlError } from '@/const/err'
import { CrawlService } from '@/domain/crawl'
import { Hashid } from '@/utils/hashids'
import { LabService } from '@/domain/lab'
import { SearchService } from '@/domain/search'
import { BookmarkTag } from '@/domain/tag'
import { supportedLang } from '@/const/lang'
import type { Prisma } from '@prisma/hyperdrive-client'
import { MultiLangError } from '@/utils/multiLangError'
import { authToken } from '@/middleware/auth'
import { randomUUID } from 'crypto'
import { selectDORegion } from '@/utils/location'
import { resolveBookmarkReadAccess } from '@/utils/bookmarkAccess'

export type { BookmarkExportItem } from '@slax-reader/contracts'
export type { BookmarkExportResponse } from '@slax-reader/contracts'
export type { AddBookmarkRequest as addBookmarkReq } from '@slax-reader/contracts'
export type { AddUrlBookmarkRequest as addUrlBookmarkReq } from '@slax-reader/contracts'
export type { BookmarkExistsResponse as userBookmarkExistsResp } from '@slax-reader/contracts'

type UserBookmarkListRow = Prisma.sr_user_bookmarkGetPayload<{ include: { bookmark: true; sr_user_bookmark_tag: true } }>

export interface BookmarkDetailResp {
  bookmark_id?: number
  bookmark_user_uuid?: string
  title: string
  alias_title?: string
  host_url: string
  target_url: string
  content_icon: string
  content_cover: string
  content?: string
  content_word_count?: number
  description?: string
  byline?: string
  status: string
  created_at?: Date
  updated_at?: Date
  archived: string
  starred: string
  trashed_at: Date | null
  user_id: number
  marks: markDetail
  tags: BookmarkTag[]
  type: 'shortcut' | 'article'
  overview?: string
}

export type markDetail = MarkDetail<Date>

export type MarkPathItem =
  | {
      type: 'text'
      path: string
      start: number
      end: number
    }
  | {
      type: 'image'
      path: string
    }

export type UpdateParseQueueRetryOptions =
  | { status: bookmarkFetchRetryStatus.PENDING; retryCount?: number }
  | { status: bookmarkFetchRetryStatus.SUCCESS | bookmarkFetchRetryStatus.FAILED }
  | { status: bookmarkFetchRetryStatus.PARSING; retryCount: number }

@injectable()
export class BookmarkService {
  private bookmarkData: BookmarkRepo
  private bucketData: LazyInstance<BucketClient>
  private userData: UserRepo

  constructor(
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo,
    @inject(BucketClient) private bucket: LazyInstance<BucketClient>,
    @inject(BookmarkSearchRepo) private bookmarkSearchRepo: BookmarkSearchRepo,
    @inject(VectorizeRepo) private dbVectorize: VectorizeRepo,
    @inject(MarkRepo) private markRepo: MarkRepo,
    @inject(UserRepo) private userRepo: UserRepo,
    @inject(QueueClient) private queue: LazyInstance<QueueClient>,
    @inject(NotificationMessage) private notifyMessage: NotificationMessage,
    @inject(CrawlService) private crawlService: CrawlService,
    @inject(LabService) private labService: LabService,
    @inject(SearchService) private searchService: SearchService
  ) {
    this.bookmarkData = bookmarkRepo
    this.bucketData = bucket
    this.userData = userRepo
  }

  public async createBookmarkBase(options: {
    ctx: ContextManager
    targetUrl: string
    hostUrl: string
    title: string
    type: number
    icon?: string
    cover?: string
    privateUser?: number
    description?: string
    siteName?: string
    isArchive?: boolean
    importMetadata?: { savedAt?: Date; starred: boolean }
  }) {
    if (options.type === 1) {
      const urlEntity = new URL(options.targetUrl)
      const paths = urlEntity.pathname.split('/')
      if (paths.length !== 3) throw ErrorParam()

      const [_, __, code] = paths
      const res = await this.getShareCodeUsername(code)

      options.siteName = res.username
      options.title = res.title
    }
    const bookmarkPO = {
      title: options.title,
      host_url: options.hostUrl,
      target_url: options.targetUrl,
      content_icon: options.icon ?? '',
      content_cover: options.cover ?? '',
      private_user: options.privateUser ?? 0,
      description: options.description ?? '',
      site_name: options.siteName ?? ''
    }

    const status = options.type === 0 ? queueStatus.PENDING : queueStatus.SUCCESS
    const bmInfo = await this.bookmarkRepo.createBookmark(bookmarkPO, status)
    if (!bmInfo) return null

    if (bmInfo.status === queueStatus.FAILED) {
      // 如果是失败了的状态那就调整成重新解析状态
      await this.bookmarkRepo.updateBookmarkStatus(bmInfo.id, queueStatus.PENDING_RETRY)
    }

    const [_, relation] = await Promise.all([
      this.bookmarkSearchRepo.upsertUserBookmark(options.ctx.getUserId(), bmInfo.id),
      this.bookmarkRepo.createBookmarkRelation(options.ctx.getUserId(), bmInfo.id, options.type, options.isArchive || false, options.importMetadata)
    ])

    if (relation.deleted_at) {
      await this.trashRevertBookmark(options.ctx, relation.bookmark_id)
    }

    if (relation) {
      // 在数据库中增加收藏添加记录
      try {
        const changeTime = options.importMetadata ? new Date() : relation.created_at
        await this.bookmarkRepo.createBookmarkChangeLog(options.ctx.getUserId(), options.targetUrl, relation.bookmark_id, 'add', changeTime)
        options.ctx.execution.waitUntil(
          this.notifyMessage.sendBookmarkChange(options.ctx.env, {
            user_id: options.ctx.getUserId(),
            bookmark_id: options.ctx.hashIds.encodeId(relation.bookmark_id),
            created_at: changeTime,
            target_url: options.targetUrl,
            action: 'add'
          })
        )
      } catch (e) {
        console.error('create bookmark change log error:', e)
      }
    }

    await this.searchService.clearSearchCache(options.ctx, options.ctx.getUserId())

    return bmInfo
  }

  /**
   * 添加收藏
   */
  private async createInlineBookmark(ctx: ContextManager, req: addBookmarkReq) {
    if (!req) throw ErrorParam()

    let { target_url, target_title, target_icon, taget_cover, content, description } = req
    const urlEntity = new URL(target_url)

    // 处理URL
    const urlPolicie = new URLPolicie(ctx.env, urlEntity)
    if (urlPolicie.isBlocked()) throw BlockTargetUrlError()
    target_url = processTargetUrl(urlEntity)

    const privateUser = ctx.getUserId()
    const lastBm = await this.bookmarkRepo.getBookmark(target_url, privateUser)

    const bmInfo = await this.createBookmarkBase({
      ctx,
      targetUrl: target_url,
      hostUrl: urlEntity.host,
      privateUser,
      type: urlPolicie.isUrlShortcut() ? 1 : 0,
      title: lastBm?.title ?? (urlPolicie.isServerParse() ? target_url : target_title),
      icon: lastBm?.content_icon ?? target_icon,
      cover: lastBm?.content_cover ?? taget_cover,
      description: lastBm?.description ?? description
    })
    if (!bmInfo) throw CreateBookmarkFailError()

    // 快捷方式不需要解析
    if (!urlPolicie.isUrlShortcut()) {
      return {
        id: bmInfo.id.toString(),
        info: {
          targetUrl: target_url,
          resource: content,
          userId: ctx.getUserId(),
          parserType: urlPolicie.getParserType(),
          bookmarkId: bmInfo.id,
          callback: callbackType.NOT_CALLBACK,
          ignoreGenerateTag: false,
          privateUser: bmInfo.private_user,
          targetTitle: target_title ?? '',
          skipParse: false
        }
      }
    }

    return bmInfo.id
  }

  /**
   * 批量添加URL收藏
   */
  public async batchAddUrlBookmark(ctx: ContextManager, req: addUrlBookmarkReq[]) {
    const batchMessage: queueParseMessage[] = []

    for (const item of req) {
      if (!item.target_url || item.target_url === '') continue

      const res = await this.addUrlBookmarkItem(ctx, item)
      if (!res) continue

      batchMessage.push(res)
    }

    return batchMessage
  }

  private async createUrlBookmark(ctx: ContextManager, req: addUrlBookmarkReq, callback: callbackType, callbackPayload: any = {}) {
    if (!req.target_url) throw ErrorParam()

    const target_url = new URL(req.target_url)
    const urlPolicie = new URLPolicie(ctx.env, target_url)

    // 检查URL策略
    let ptype = urlPolicie.getParserType()
    if (urlPolicie.isBlocked()) throw BlockTargetUrlError()
    if (ptype === parserType.CLIENT_PARSE) ptype = parserType.SERVER_PUPPETEER_PARSE

    // 处理URL
    const targetUrl = processTargetUrl(target_url)
    const privateUser = ctx.getUserId()
    const lastBm = await this.bookmarkRepo.getBookmark(targetUrl, privateUser)

    // 创建书签
    const bmInfo = await this.createBookmarkBase({
      ctx,
      targetUrl,
      hostUrl: target_url.host,
      privateUser,
      type: urlPolicie.isUrlShortcut() ? 1 : 0,
      title: lastBm?.title ?? req.target_title ?? targetUrl,
      icon: '',
      cover: lastBm?.content_cover ?? req.thumbnail ?? '',
      description: lastBm?.description ?? req.description ?? ''
    })

    if (!bmInfo) throw CreateBookmarkFailError()

    // 推送队列消息
    if (!urlPolicie.isUrlShortcut()) {
      return {
        id: bmInfo.id.toString(),
        info: {
          targetUrl,
          resource: '',
          parserType: ptype,
          userId: ctx.getUserId(),
          bookmarkId: bmInfo.id,
          callback,
          callbackPayload,
          ignoreGenerateTag: false,
          privateUser: bmInfo.private_user,
          skipParse: false
        }
      }
    }
    return bmInfo.id
  }

  public async getShareCodeUsername(shareCode: string) {
    const share = await this.bookmarkRepo.getBookmarkShareByShareCode(shareCode)
    if (!share) throw BookmarkNotFoundError()

    const getUser = async () => {
      const user = await this.userRepo.getInfoByUserId(share.user_id)
      if (!user) throw UserNotFoundError()
      return user
    }
    const getBookmark = async () => {
      const bm = await this.bookmarkRepo.getBookmarkById(share.bookmark_id)
      if (!bm) throw BookmarkNotFoundError()
      return bm
    }
    const [user, bm] = await Promise.all([getUser(), getBookmark()])

    return { username: user.name, title: bm.title }
  }

  /**
   * 删除收藏（跟移入垃圾箱不同，这个是从表中彻底删除收藏）
   */
  public async deleteBookmark(ctx: ContextManager, userId: number, bmId: number): Promise<string> {
    const bmRepo = this.bookmarkRepo
    const searchRepo = this.bookmarkSearchRepo

    // 删除slax_user_bookmark ， slax_user_bookmark_tag 标签数据
    const deleteUserBookmark = async () => {
      const bmInfo = await bmRepo.getUserBookmarkWithDetail(bmId, userId)
      if (!bmInfo) {
        console.log('delete user bookmark not found:', bmId, ' user:', userId)
        return null
      }

      console.log('delete user bookmark:', bmId, ' user:', userId, ' deleted_at: ', bmInfo.deleted_at, ' id: ', bmInfo.id)

      const deleteDate = new Date()
      const [resErr, _] = await Promise.all([
        bmRepo.deleteUserBookmark(bmId, userId),
        searchRepo.deleteUserBookmark(userId, bmId),
        this.markRepo.deleteByBookmarkId(bmInfo.id),
        bmRepo.createBookmarkChangeLog(userId, bmInfo.bookmark?.target_url ?? '', bmId, 'delete', deleteDate)
      ])

      ctx.execution.waitUntil(
        this.notifyMessage.sendBookmarkChange(ctx.env, {
          user_id: userId,
          bookmark_id: new Hashid(ctx.env, userId).encodeId(bmId),
          created_at: deleteDate,
          target_url: bmInfo.bookmark?.target_url ?? '',
          action: 'delete'
        })
      )

      if (resErr instanceof MultiLangError) {
        console.error('delete user bookmark error:', resErr)
        return resErr
      }
    }

    // 判断是否需要删除slax_bookmark （根据private_user === 用户自己的id）
    // 	- 如果上一步需要删除，根据content_key、content_md_key去R2删除文件
    //  - 删除summary数据
    const deleteBookmarkContentTry = async () => {
      const bmPO = await bmRepo.deleteBookmarkTry(bmId, userId)
      if (!bmPO) {
        // bookmark is public (private_user !== userId) or not found, skip deleting sr_bookmark itself
        return null
      }

      try {
        const promiseList = [
          this.bucket().R2Bucket.delete(bmPO.content_key || ''),
          this.bucket().R2Bucket.delete(bmPO.content_md_key || ''),
          this.bookmarkSearchRepo.deleteBookmarkRaw(bmId)
        ]

        const shard = await this.bookmarkRepo.getVectorShard(bmId)
        if (!!shard) {
          promiseList.push(this.dbVectorize.deleteVector(bmId, shard.bucket_idx))
        }
        await Promise.all(promiseList)
      } catch (error) {
        console.log('delete bookmark content key error:', bmPO)
      }
    }

    // 删除share数据
    const deleteBookmarkShareTry = async () => {
      try {
        await bmRepo.deleteBookmarkShare(bmId, userId)
      } catch (error) {
        console.log('delete bookmark share error:', bmId, error)
      }
    }

    await deleteUserBookmark()

    ctx.execution.waitUntil(Promise.allSettled([deleteBookmarkContentTry(), deleteBookmarkShareTry()]))

    await this.searchService.clearSearchCache(ctx, userId)

    return 'ok'
  }

  /** 将收藏丢进垃圾篓  */
  public async trashBookmark(ctx: ContextManager, bmId: number): Promise<string> {
    const bmRepo = this.bookmarkRepo
    const userId = ctx.getUserId()

    await Promise.allSettled([bmRepo.updateBookmarkDeleteAt(bmId, userId, true), bmRepo.updateBookmarkShareIsEnable(bmId, userId, false)])

    await this.searchService.clearSearchCache(ctx, userId)

    return 'ok'
  }

  /** 将收藏移出垃圾篓 */
  public async trashRevertBookmark(ctx: ContextManager, bmId: number): Promise<string> {
    const bmRepo = this.bookmarkRepo

    await Promise.allSettled([bmRepo.updateBookmarkDeleteAt(bmId, ctx.getUserId(), false), bmRepo.updateBookmarkArchiveStatus(bmId, ctx.getUserId(), 0)])

    await this.searchService.clearSearchCache(ctx, ctx.getUserId())

    return 'ok'
  }

  /** 收藏是否存在  */
  public async bookmarkExists(ctx: ContextManager, targetUrl: string) {
    const uUrl = new URL(targetUrl)
    const police = new URLPolicie(ctx.env, uUrl)
    let privateUser = 0
    if (police.isClientParse()) privateUser = ctx.getUserId()
    if (police.isUrlShortcut()) uUrl.searchParams.forEach((value, key) => uUrl.searchParams.delete(key))

    const bmRepo = this.bookmarkRepo
    const res = await bmRepo.getBookmark(uUrl.toString(), privateUser)

    let relatetion
    if (res && res.bookmark_id) relatetion = await bmRepo.getUserBookmark(res.bookmark_id, ctx.getUserId())

    return {
      exists: !!relatetion,
      bookmark_id: !!res?.bookmark_id ? ctx.hashIds.encodeId(res.bookmark_id) : 0,
      parse_type: police.getParserType()
    }
  }

  /** one list row for the client: bookmark fields + user state + live tag chips */
  private mapUserBookmarkRows(ctx: ContextManager, rows: UserBookmarkListRow[]) {
    return rows
      .filter(({ bookmark }) => bookmark !== null)
      .map(({ uuid, bookmark, alias_title, archive_status, is_starred, deleted_at, type, created_at, updated_at, sr_user_bookmark_tag }) => {
        const { private_user, content_md_key, content_key, ...bookmarkWithout } = bookmark!
        return {
          ...bookmarkWithout,
          alias_title,
          id: ctx.hashIds.encodeId(bookmark!.id),
          bookmark_user_uuid: uuid,
          archived: archive_status === 1 ? 'archive' : archive_status === 2 ? 'later' : 'inbox',
          starred: is_starred ? 'star' : 'unstar',
          trashed_at: !!deleted_at ? deleted_at : undefined,
          type: type === 1 ? 'shortcut' : 'article',
          created_at,
          updated_at,
          tags: (sr_user_bookmark_tag || []).map(t => ({
            id: ctx.hashIds.encodeId(t.tag_id),
            name: t.tag_name,
            show_name: t.tag_name,
            added_by: t.source
          }))
        }
      })
  }

  /** 获取收藏列表 */
  public async bookmarkList(ctx: ContextManager, page: number, size: number, filter: string, source?: string) {
    return this.mapUserBookmarkRows(ctx, await this.bookmarkRepo.listUserBookmarks(ctx.getUserId(), (page - 1) * size, size, filter, source))
  }

  /** 按标签交集获取收藏列表 */
  public async bookmarkListByTopics(ctx: ContextManager, page: number, size: number, tagIds: number[]): Promise<bookmarkPO[]> {
    return this.mapUserBookmarkRows(ctx, await this.bookmarkRepo.listUserBookmarksByTagIds(ctx.getUserId(), tagIds, (page - 1) * size, size))
  }

  /** 根据标签ID获取收藏列表（单标签，保留给旧调用方） */
  public async bookmarkListByTopic(ctx: ContextManager, page: number, size: number, tagId: number): Promise<bookmarkPO[]> {
    return this.bookmarkListByTopics(ctx, page, size, [tagId])
  }

  public async getBookmarkContent(bmKey: string) {
    if (!bmKey) return
    const target = await this.bucket().R2Bucket.get(bmKey)
    if (target) {
      const content = await target.text()
      return content
    }
  }

  public async bookmarkArchive(ctx: ContextManager, bmId: number, status: string) {
    const updateStatus = status === 'archive' ? 1 : status === 'later' ? 2 : 0
    await this.bookmarkRepo.updateBookmarkArchiveStatus(bmId, ctx.getUserId(), updateStatus)
    return null
  }

  public async bookmarkAliasTitle(ctx: ContextManager, bmId: number, alias_title: string) {
    await this.bookmarkRepo.updateBookmarkAliasTitle(bmId, ctx.getUserId(), alias_title)
  }

  public async clearExpiredTrashedBookmarkTask(ctx: ContextManager) {
    // 1. 扫表，扫描需要删除slax_user_bookmark
    // 2. 判断是否需要删除slax_bookmark （根据private_user === 用户自己的id）
    // 	-  如果上一步需要删除，根据content_key、content_md_key去R2删除文件
    // 3. 删除share数据
    // 4. 删除summary数据
    // 5. 删除comment数据
    // 6. 删除slax_user_bookmark_tag标签数据
    // 7. 可选 - 扫描内容中的图片，根据key去真删除
    const bmRepo = this.bookmarkRepo
    const bookmarks = await bmRepo.getExpiredTrashedBookmark()

    for (const bookmark of bookmarks) {
      console.log('clear expired trashed bookmark:', bookmark.bookmark_id, ' user:', bookmark.user_id)
      try {
        await this.deleteBookmark(ctx, bookmark.user_id, bookmark.bookmark_id)
      } catch (error) {
        console.error('clear expired trashed bookmark task failed:', error)
      }
    }
  }

  /**
   * 获取书签总结列表
   */
  public async getBookmarkSummaries(ctx: ContextManager, bmId: number) {
    const bmRepo = this.bookmarkRepo
    const userId = ctx.getUserId()
    const lang = ctx.getlang()

    if (!userId || !bmId || supportedLang.indexOf(lang) === -1) throw ErrorParam()

    const summaries = await bmRepo.getBookmarkSummariesRaw(bmId, lang, userId, 6)
    const selfSummary = summaries.find(summary => summary.user_id === userId)

    return [...(selfSummary ? [selfSummary] : []), ...summaries.filter(summary => summary.user_id !== userId)].map(summary => {
      const { user_id, content, updated_at } = summary

      return {
        content,
        updated_at,
        is_self: user_id === ctx.getUserId()
      }
    })
  }

  public async getBookmarkReadAccess(ctx: ContextManager, uuid: string) {
    return resolveBookmarkReadAccess(this.bookmarkRepo, this.userRepo, ctx.getUserId(), uuid)
  }

  /** 获取当前用户有权访问的书签ID */
  public async getBookmarkId(ctx: ContextManager, params: { bmId?: number; shareCode?: string; cbId?: number; collectionCode?: string; bmUId?: string; uBmId?: string }) {
    const { bmId, shareCode, cbId, collectionCode, bmUId, uBmId } = params
    const userId = ctx.getUserId()
    if (bmId) {
      if (userId < 1) return 0
      const bookmark = await this.bookmarkRepo.getUserBookmarkWithDetail(ctx.hashIds.decodeId(bmId), userId)
      if (!bookmark?.bookmark || (bookmark.bookmark.private_user > 0 && bookmark.bookmark.private_user !== userId)) return 0
      return bookmark.bookmark_id
    }

    if (shareCode) {
      const share = await this.bookmarkRepo.getBookmarkShareByShareCode(shareCode)
      if (!share) return 0
      const bookmark = await this.bookmarkRepo.getUserBookmark(share.bookmark_id, share.user_id)
      if (!bookmark) return 0
      const access = await this.getBookmarkReadAccess(ctx, bookmark.uuid)
      return access?.bookmark.bookmark_id ?? 0
    }
    if (cbId) {
      if (!collectionCode) return 0
      const bookmark = await this.bookmarkRepo.getCollectionBookmarkById(ctx.hashIds.decodeId(cbId), collectionCode, userId)
      if (!bookmark) return 0
      const access = await this.getBookmarkReadAccess(ctx, bookmark.uuid)
      return access?.bookmark.bookmark_id ?? 0
    }

    const uuid = bmUId || uBmId
    if (uuid && userId > 0) {
      const bookmark = await this.bookmarkRepo.getUserBookmarkByUId(uuid, userId)
      if (!bookmark?.bookmark || (bookmark.bookmark.private_user > 0 && bookmark.bookmark.private_user !== userId)) return 0
      return bookmark.bookmark_id
    }

    return 0
  }

  /**
   * AI attaches vocabulary words to a bookmark. Names are resolved without touching
   * ownership or display, links are written with source "ai", last_used_at stays put.
   */
  public async tagBookmark(ctx: ContextManager, userId: number, bmId: number, tags: string[]) {
    if (tags.length < 1) return
    // a plain lookup: the bookmark may belong to several users and a name that is not in
    // this user's live vocabulary must be dropped, never created
    const rows = await this.bookmarkRepo.getUserTagsByNames(userId, tags)
    if (rows.length < 1) return
    await this.bookmarkRepo.upsertBookmarkTags(bmId, userId, rows, 'ai')
  }

  /** 创建书签概述 */
  public async createBookmarkOverview(userId: number, bookmarkId: number, overview: string, content: string) {
    return await this.bookmarkRepo.createBookmarkOverview(userId, bookmarkId, overview, content)
  }

  /** 获取用户书签概述 */
  public async getUserBookmarkOverview(userId: number, bookmarkId: number) {
    return await this.bookmarkRepo.getUserBookmarkOverview(userId, bookmarkId)
  }

  /** 更新书签解析队列重试 */
  public async updateBookmarkParseQueueRetry(bookmarkId: number, userIds: number[], options: UpdateParseQueueRetryOptions) {
    if (options.status === bookmarkFetchRetryStatus.PENDING) {
      if (options.retryCount !== undefined) {
        await Promise.allSettled(userIds.map(userId => this.bookmarkRepo.createBookmarkFetchRetry(bookmarkId, userId, options.retryCount)))
      } else {
        await this.bookmarkRepo.updateBookmarkFetchRetry(bookmarkId, {
          status: bookmarkFetchRetryStatus.PENDING
        })
      }
    } else if (options.status === bookmarkFetchRetryStatus.PARSING) {
      await this.bookmarkRepo.updateBookmarkFetchRetry(bookmarkId, {
        status: bookmarkFetchRetryStatus.PARSING,
        retry_count: options.retryCount,
        last_retry_at: new Date()
      })
    } else if ([bookmarkFetchRetryStatus.SUCCESS, bookmarkFetchRetryStatus.FAILED, bookmarkFetchRetryStatus.PARSING].indexOf(options.status) !== -1) {
      await this.bookmarkRepo.updateBookmarkFetchRetry(bookmarkId, { status: options.status })
    }
  }

  /** 检查并获取需要重试的书签 */
  public async checkAndFetchRetryBookmarks(ctx: ContextManager) {
    const bmRepo = this.bookmarkRepo

    // 找出retry表中，pending状态的书签
    const list = await bmRepo.getFilterBookmarkFetchRetries({ status: bookmarkFetchRetryStatus.PENDING })
    if (!list) {
      return
    }

    const res = list
      .map(item => {
        // 因为存在一个书签多个用户，因此涉及状态（比如重试次数）的变更和获取都给予值最高的那个来处理。
        const userIds = item.user_ids.split(',').map(id => Number(id))
        const retryCounts = item.retry_counts.split(',').map(count => Number(count))
        const maxRetryCount = Math.max(...retryCounts)

        return {
          bookmark_id: item.bookmark_id,
          user_ids: userIds,
          retry_count: maxRetryCount,
          created_at: new Date(item.created_at)
        }
      })
      .sort((a, b) => a.created_at.getTime() - b.created_at.getTime())

    if (res.length === 0) {
      return
    }

    for (const item of res) {
      const bmInfo = await bmRepo.getBookmarkById(item.bookmark_id)
      if (!bmInfo) {
        await bmRepo.updateBookmarkFetchRetry(item.bookmark_id, { status: bookmarkFetchRetryStatus.FAILED })
        continue
      }

      const target_url = new URL(bmInfo.target_url)
      const urlPolicie = new URLPolicie(ctx.env, target_url)

      if (urlPolicie.isBlocked()) {
        await bmRepo.updateBookmarkFetchRetry(item.bookmark_id, { status: bookmarkFetchRetryStatus.FAILED })
        continue
      }

      const { retry_count, user_ids } = item

      // 更新状态为QUEUEING
      await bmRepo.updateBookmarkFetchRetry(item.bookmark_id, { status: bookmarkFetchRetryStatus.QUEUEING })

      if (!urlPolicie.isUrlShortcut()) {
        await this.queue().pushRetryMessage(ctx, {
          targetUrl: bmInfo.target_url,
          resource: '',
          parserType: parserType.SERVER_PUPPETEER_PARSE,
          bookmarkId: bmInfo.id,
          callback: callbackType.NOT_CALLBACK,
          ignoreGenerateTag: false,
          retry: { retryCount: retry_count, userIds: user_ids }
        })
      }
    }
  }

  /** 检查并覆盖失败的书签 */
  public async checkAndCoverFailBookmark(targetUrl: string, userId: number, privateUser: number) {
    const bmRepo = this.bookmarkRepo

    // 找到用户相同targetUrl下的另外一个书签（如果是公有的就去找它私有的，如果是私有的就去找它公有的）
    const res = await bmRepo.getBookmark(targetUrl, privateUser === 0 ? userId : 0)
    if (!res || !res.bookmark_id || (res.status !== bookmarkParseStatus.FAILED && res.status !== bookmarkParseStatus.PENDING)) return

    await bmRepo.deleteUserBookmark(res.bookmark_id, userId)
  }

  /** 检查并填充公用书签数据 */
  async checkAndFillPublicBookmarkData(ctx: ContextManager, bookmarkId: number, targetUrl: string) {
    const bmRepo = this.bookmarkRepo

    // 根据targetUrl 查看是否有公用的书签
    const publicBookmark = await bmRepo.getBookmark(targetUrl, 0)
    if (!publicBookmark || !publicBookmark.bookmark_id || publicBookmark.status !== bookmarkParseStatus.SUCCESS) return

    // 看看用户是否已经有存了公用书签了
    const publicUserBookmark = await bmRepo.getUserBookmark(publicBookmark.bookmark_id, ctx.getUserId())
    if (publicUserBookmark) return // 已经存在了

    // 找到用户失败的书签
    const userBookmark = await bmRepo.getUserBookmark(bookmarkId, ctx.getUserId())
    if (!userBookmark) return

    // 更新用户书签中的id，指向公用书签
    await bmRepo.updateUserBookmarkBookmarkId(userBookmark.id, publicBookmark.bookmark_id)
  }

  public async getUserBookmarkByUuidWithDetail(uuid: string) {
    return await this.bookmarkRepo.getUserBookmarkByUuidWithDetail(uuid)
  }

  public async getBookmarkShareByBookmarkId(bmId: number, userId: number) {
    return await this.bookmarkRepo.getBookmarkShareByBookmarkId(bmId, userId)
  }

  public async getUserBookmarkWithDetail(userId: number, bmId: number) {
    return (await this.bookmarkRepo.getUserBookmarkWithDetail(bmId, userId)) ?? null
  }

  public async updateBookmarkStarStatus(userId: number, bmId: number, status: boolean) {
    return await this.bookmarkRepo.updateBookmarkStarStatus(bmId, userId, status)
  }

  public async getBookmarkById(bmId: number) {
    return await this.bookmarkRepo.getBookmarkById(bmId)
  }

  public async getUserBookmark(bmId: number, userId: number) {
    return await this.bookmarkRepo.getUserBookmark(bmId, userId)
  }

  public async updateBookmark(bmId: number, info: bookmarkParsePO) {
    return await this.bookmarkRepo.updateBookmark(bmId, info)
  }

  public async updateBookmarkStatus(bmId: number, status: queueStatus) {
    return await this.bookmarkRepo.updateBookmarkStatus(bmId, status)
  }

  public async getAllBookmarkChangesLog(ctx: ContextManager, userId: number) {
    const res = (await this.bookmarkRepo.getAllBookmarkChanges(userId)) || []

    const logs = res.map(item => ({
      target_url: item.target_url,
      bookmark_id: ctx.hashIds.encodeId(item.bookmark_id)
    }))

    const previous_sync = res.length > 0 ? res[0].created_at.getTime() : null

    return {
      logs,
      ...(previous_sync ? { previous_sync } : {})
    }
  }

  public async getPartialBookmarkChangesLog(ctx: ContextManager, userId: number, time: number) {
    const res = (await this.bookmarkRepo.getPartialBookmarkChanges(userId, time)) || []

    const previous_sync = res.length > 0 ? res[res.length - 1].created_at.getTime() : null

    const logs = res
      .slice()
      .reverse()
      .map(item => ({
        target_url: item.target_url,
        bookmark_id: ctx.hashIds.encodeId(item.bookmark_id),
        action: item.action
      }))

    return {
      logs,
      ...(previous_sync ? { previous_sync } : {})
    }
  }

  public async connectBookmarkChanges(ctx: ContextManager, request: Request, token: string) {
    await authToken(ctx, token)
    await this.userData.requireActiveUser(ctx.getUserId())

    let pushToken = String(randomUUID())
    const headers = new Headers(request.headers)
    const locationHint = selectDORegion(request)
    const doId = ctx.env.WEBSOCKET_SERVER.idFromName('global')
    const stub = ctx.env.WEBSOCKET_SERVER.get(doId, { locationHint })

    headers.set('uuid', pushToken)
    headers.set('region', locationHint)
    headers.set('user_id', ctx.getUserId().toString())
    headers.set('connect_type', 'extensions')
    console.log(`locationHint, user ${ctx.getUserId()} from ${request.cf?.country} match ${locationHint}, push uuid ${pushToken}`)

    return stub
      .fetch(
        new Request(request, {
          headers
        })
      )
      .catch(async (e: any) => {
        pushToken = ''
        console.log('fetch error', e)
        return new Response(null, { status: 500 })
      })
  }

  public async getUserBookmarkSummary(ctx: ContextManager, params: { bmId?: number; shareCode?: string; cbId?: number; collectionCode?: string; bmUId?: string }) {
    const bookmarkId = await this.getBookmarkId(ctx, params)
    if (!bookmarkId || bookmarkId < 1) throw ErrorParam()

    return await this.bookmarkRepo.getUserBookmarkSummary(bookmarkId, ctx.getUserId(), ctx.get('ai_lang'))
  }

  public async getBookmarkOutline(bookmarkId: number, userId: number): Promise<string | null> {
    const summary = await this.bookmarkRepo.getBookmarkOutline(bookmarkId, userId)
    return summary?.content ?? null
  }

  public async getUserBookmarkSummaryByMCP(bmId: number, userId: number, lang: string) {
    const bookmark = await this.getBookmarkById(bmId)
    if (!bookmark || bookmark instanceof MultiLangError || !bookmark.content_md_key) {
      throw BookmarkNotFoundError()
    }
    return await this.bookmarkRepo.getUserBookmarkSummary(bmId, userId, lang)
  }

  async saveSummary(ctx: ContextManager, bmId: number, provider: string, content: string, model: string) {
    const info = { content: content, ai_name: provider || '', ai_model: model || '', bookmark_id: bmId, user_id: ctx.getUserId(), lang: ctx.get('ai_lang') }
    await this.bookmarkRepo.upsertBookmarkSummary(info)
  }

  public getQueue(): LazyInstance<QueueClient> {
    return this.queue
  }

  public async getBookmarkTitleContent(
    ctx: ContextManager,
    params: { bmId?: number; shareCode?: string; cbId?: number; collectionCode?: string; title?: string; content?: string; bmUId?: string }
  ): Promise<{ title: string; content: string; bmId: number; targetUrl: string; moderationResult: number }> {
    const { bmId, shareCode, cbId, collectionCode, title, content, bmUId } = params

    const emptyId = !bmId && !shareCode && !cbId && !bmUId
    if (emptyId && !title && !content) throw ErrorParam()
    if (emptyId && title && content) {
      return { title, content, bmId: 0, targetUrl: '', moderationResult: 0 }
    }

    const bookmarkId = await this.getBookmarkId(ctx, { bmId, shareCode, cbId, collectionCode, bmUId })
    if (!bookmarkId || bookmarkId < 1) throw ErrorParam()

    const bookmark = await this.getBookmarkById(bookmarkId)
    if (!bookmark || bookmark instanceof MultiLangError || !bookmark.content_md_key) {
      throw BookmarkNotFoundError()
    }

    const body = await this.getBookmarkContent(bookmark.content_md_key)

    if (!body) throw BookmarkContentNotFoundError()

    return { title: bookmark.title, content: body, bmId: bookmarkId, targetUrl: bookmark.target_url, moderationResult: bookmark.moderation_result }
  }

  private static readonly EXPORT_PAGE_SIZE = 500
  private static readonly EXPORT_CURSOR_VERSION = 1
  private static isExportCursorData(data: unknown): data is { v: number; user: number; after: number; upper: number } {
    if (!data || typeof data !== 'object') return false
    const cursor = data as Record<string, unknown>
    return Number.isInteger(cursor.v) && Number.isInteger(cursor.user) && Number.isInteger(cursor.after) && Number.isInteger(cursor.upper)
  }

  public async exportBookmarks(ctx: ContextManager, cursor: string | null): Promise<BookmarkExportResponse> {
    const userId = ctx.getUserId()
    const parsed = await this.parseExportCursor(userId, cursor)
    if (!parsed) return { items: [], next_cursor: null }

    const rows = await this.bookmarkData.listExportUserBookmarks(userId, parsed.after, parsed.upper, BookmarkService.EXPORT_PAGE_SIZE + 1)
    const hasMore = rows.length > BookmarkService.EXPORT_PAGE_SIZE
    const pageRows = hasMore ? rows.slice(0, BookmarkService.EXPORT_PAGE_SIZE) : rows

    const items: BookmarkExportResponse['items'] = pageRows.map(row => {
      if (!row.bookmark) throw new Error('Saved link has no bookmark record')
      return {
        url: row.bookmark.target_url,
        title: row.alias_title || row.bookmark.title || row.bookmark.target_url,
        tags: row.sr_user_bookmark_tag.map(tag => ({ name: tag.tag_name, source: tag.source })),
        saved_at: row.created_at.toISOString(),
        is_read: row.is_read,
        is_archived: row.archive_status === 1,
        is_starred: row.is_starred,
        type: row.type === 1 ? 'shortcut' : 'article'
      }
    })

    if (!hasMore) return { items, next_cursor: null }
    const next = this.encodeExportCursor({ user: userId, after: pageRows[pageRows.length - 1]!.id, upper: parsed.upper })
    return { items, next_cursor: next }
  }

  private encodeExportCursor(payload: { user: number; after: number; upper: number }) {
    const raw = JSON.stringify({ v: BookmarkService.EXPORT_CURSOR_VERSION, ...payload })
    return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  }

  private decodeExportCursor(cursor: string) {
    const normalized = cursor.replace(/-/g, '+').replace(/_/g, '/')
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
    return JSON.parse(atob(padded))
  }

  private async parseExportCursor(userId: number, cursor: string | null): Promise<{ after: number; upper: number } | null> {
    if (cursor === null) {
      const latest = await this.bookmarkData.getLatestActiveUserBookmarkId(userId)
      if (!latest) return null
      return { after: 0, upper: latest.id }
    }

    if (!cursor) throw ErrorParam()

    let data: unknown
    try {
      data = this.decodeExportCursor(cursor)
    } catch {
      throw ErrorParam()
    }

    if (!BookmarkService.isExportCursorData(data)) throw ErrorParam()

    if (data.v !== BookmarkService.EXPORT_CURSOR_VERSION || data.user !== userId || data.after < 0 || data.upper < data.after) {
      throw ErrorParam()
    }

    return { after: data.after, upper: data.upper }
  }

  public async getStreamBookmarkContent(ctx: ContextManager, bookmarkUid: string): Promise<ReadableStream | null> {
    console.log(`[bookmark/content] user ${ctx.getUserId()} requests bookmark ${bookmarkUid}`)

    const access = await this.getBookmarkReadAccess(ctx, bookmarkUid)
    const contentKey = access?.bookmark.bookmark.content_key
    if (!contentKey) return null

    const r2Object = await this.bucketData().R2Bucket.get(contentKey)
    return r2Object?.body ?? null
  }

  /**
   * 添加收藏
   */
  public async addBookmark(ctx: ContextManager, req: addBookmarkReq) {
    // Labs gate runs before any row is written; the crawl workflow starts too late to stop it
    await this.labService.assertUrlAllowed(ctx, req.target_url)
    try {
      return await this.createInlineBookmark(ctx, req)
    } catch (e) {
      console.error(`addBookmark error: ${e}`)
      throw e
    }
  }

  public async addUrlBookmarkItem(ctx: ContextManager, item: addUrlBookmarkReq) {
    // 跳过非法的URL
    let target_url: URL
    try {
      target_url = new URL(item.target_url)
    } catch (e) {
      console.log(`addUrlBookmarkItem invalid url: ${item.target_url}, ${e}`)
      return null
    }
    if (target_url.host.includes('localhost') || target_url.host.includes('127.0.0.1')) {
      console.log(`addUrlBookmarkItem skip localhost: ${item.target_url}`)
      return null
    }

    // Imports never throw for one bad row: a Labs-gated URL is skipped like a blocked one
    try {
      await this.labService.assertUrlAllowed(ctx, item.target_url)
    } catch (e) {
      if (!LabService.isLabDisabledError(e)) throw e
      console.log(`addUrlBookmarkItem skip lab-gated url: ${item.target_url}`)
      return null
    }

    const urlPolicie = new URLPolicie(ctx.env, target_url)
    let ptype = urlPolicie.getParserType()
    if (urlPolicie.isBlocked()) return null

    // 参数处理
    const targetUrl = processTargetUrl(target_url)

    const privateUser = ctx.getUserId()
    const lastBm = await this.bookmarkData.getBookmark(targetUrl, privateUser)
    if (item.import_only && lastBm?.bookmark_id && (await this.bookmarkData.getUserBookmark(lastBm.bookmark_id, privateUser))) return null
    const bmInfo = await this.createBookmarkBase({
      ctx,
      targetUrl,
      hostUrl: target_url.host,
      privateUser,
      type: urlPolicie.isUrlShortcut() ? 1 : 0,
      title: lastBm?.title ?? item.target_title ?? targetUrl,
      icon: '',
      cover: lastBm?.content_cover ?? item.thumbnail ?? '',
      description: item.description ?? '',
      isArchive: item.is_archive ?? false,
      importMetadata: item.import_only ? { savedAt: item.saved_at ? new Date(item.saved_at) : undefined, starred: item.is_starred ?? false } : undefined
    })

    if (!bmInfo) {
      console.error(`create bookmark failed: ${item.target_url}`)
      return null
    }

    if (item.tags.length > 0) {
      try {
        // 导入来的词进自动标签（用户在标签页确认后才算我的标签），关联算用户贴的，隐藏过的词恢复显示
        const tagResults = await this.bookmarkData.updateUserTagsDisplay(ctx.getUserId(), item.tags, true, 'auto')
        if (tagResults.length > 0) {
          await this.bookmarkData.upsertBookmarkTags(bmInfo.id, ctx.getUserId(), tagResults, 'user')
          await this.bookmarkData.touchUserTagsLastUsed(
            ctx.getUserId(),
            tagResults.map(t => t.id)
          )
        }
      } catch (e) {
        console.error(`addUrlBookmarkItem batch create tags failed: ${e}`)
      }
    }

    return {
      targetUrl: targetUrl,
      resource: '',
      parserType: ptype === parserType.CLIENT_PARSE ? parserType.SERVER_PUPPETEER_PARSE : ptype,
      userId: ctx.getUserId(),
      bookmarkId: bmInfo.id,
      callback: callbackType.NOT_CALLBACK,
      ignoreGenerateTag: true,
      privateUser: bmInfo.private_user,
      skipParse: item.import_only ? false : item.is_archive || false
    }
  }

  public async addUrlBookmark(ctx: ContextManager, req: addUrlBookmarkReq, callback: callbackType, callbackPayload: any = {}) {
    // Covers /add_url, Telegram and the CLI; the extension and iOS share go through addBookmark
    await this.labService.assertUrlAllowed(ctx, req.target_url)
    try {
      return await this.createUrlBookmark(ctx, req, callback, callbackPayload)
    } catch (e) {
      console.error(`addUrlBookmark error: ${e}`)
      throw e
    }
  }

  /** 获取书签标题和文本内容 */
  public async getBookmarkTitleAndTextContentTry(bookmarkId: number) {
    const bmRepo = this.bookmarkData

    const res = await bmRepo.getBookmarkById(bookmarkId)
    if (!res || res.status !== queueStatus.SUCCESS) {
      return null
    }

    const textContent = await this.getBookmarkContent(res.content_md_key)
    if (!textContent) {
      return null
    }

    return {
      title: res.title,
      textContent: textContent,
      byline: res.byline,
      privateUser: res.private_user
    }
  }

  public async updateBookmarkModerationResult(bmId: number, moderationResult: number) {
    return this.bookmarkData.updateBookmarkModerationResult(bmId, moderationResult)
  }

  public async disableBookmarkShare(bmId: number, userId: number) {
    return this.bookmarkData.disableBookmarkShareUpsert(bmId, userId)
  }

  public async createBookmarkImportRelation(userId: number, bookmarkId: number, importTaskId: number) {
    return this.bookmarkData.createBookmarkImportRelation(userId, bookmarkId, importTaskId)
  }

  public async updateBookmarkImportRelationStatus(userId: number, bookmarkId: number, importTaskId: number, status: number) {
    return this.bookmarkData.updateBookmarkImportRelationStatus(userId, bookmarkId, importTaskId, status)
  }

  /** 获取导入失败的书签列表 */
  public async getImportFailedBookmarks(ctx: ContextManager, importId: number, page: number, limit: number) {
    return (await this.bookmarkData.getImportFailedBookmarks(ctx.getUserId(), importId, page, limit)).map(item => ({
      id: ctx.hashIds.encodeId(item.id),
      site_name: item.site_name,
      title: item.title,
      target_url: item.target_url
    }))
  }

  /** 批量删除导入失败的书签关系记录 */
  public async batchDeleteFailedImportBookmarkRelations(userId: number, importId: number, relationIds: number[], deleteAll: boolean) {
    let bookmarkIds: number[]

    if (deleteAll) {
      bookmarkIds = await this.bookmarkData.getAllImportBookmarkIds(userId, importId)
    } else {
      bookmarkIds = await this.bookmarkData.validateImportBookmarkIds(userId, importId, relationIds)
    }

    const deletePromises = []
    for (let i = 0; i < bookmarkIds.length; i += 50) {
      const batch = bookmarkIds.slice(i, i + 50)
      deletePromises.push(this.bookmarkData.batchDeleteBookmarksByIds(userId, batch))
    }

    try {
      await Promise.all(deletePromises)
    } catch (err) {
      console.log(`batchDeleteFailedImportBookmarkRelations error: ${err}`)
      throw ServerError()
    }
  }

  public async createAigcBatchTask(userId: number, bookmarkId: number, batchId: string, taskType: string) {
    return this.bookmarkData.createAigcBatchTask(userId, bookmarkId, batchId, taskType)
  }

  public async getUnfinishedAigcBatchTasks(taskType: string) {
    return this.bookmarkData.getPendingAigcBatchTasks(taskType, 50)
  }

  public async updateAigcBatchTaskStatus(batchId: string, status: AigcBatchTaskStatus, result: string, errorMessage?: string) {
    return this.bookmarkData.updateAigcBatchTaskStatus(batchId, status, result, errorMessage)
  }

  public async getUserBookmarkBatchTasks(userId: number, bookmarkId: number, taskType: string) {
    return this.bookmarkData.getUserBookmarkBatchTasks(userId, bookmarkId, taskType)
  }

  public async updateUserBookmarkCreateAt(bmId: number, userId: number, createdAt: Date) {
    await this.bookmarkData.updateUserBookmarkCreateAt(bmId, userId, createdAt)
  }

  // 卡死检测：仅救援 pending/pending_retry 超 4 分钟（workflow 尚未接手就卡住的）
  public async detectStuckAndRetry(ctx: ContextManager) {
    const PENDING_THRESHOLD = 4
    const BATCH_LIMIT = 100
    const CONCURRENCY = 10

    const stuckList = await this.bookmarkData.findStuckBookmarks({
      pendingThresholdMinutes: PENDING_THRESHOLD,
      limit: BATCH_LIMIT
    })

    for (let i = 0; i < stuckList.length; i += CONCURRENCY) {
      const batch = stuckList.slice(i, i + CONCURRENCY)
      const results = await Promise.allSettled(batch.map(bm => this.processStuckBookmark(ctx, bm)))
      for (const r of results) {
        if (r.status === 'rejected') {
          console.error(`[detectStuckAndRetry] processStuckBookmark failed: ${r.reason}`)
        }
      }
    }
  }

  private async processStuckBookmark(ctx: ContextManager, bm: { id: number; target_url: string; status: string; created_at: Date; user_id: number }) {
    const hostname = (() => {
      try {
        return new URL(bm.target_url).hostname || 'unknown'
      } catch {
        return 'unknown'
      }
    })()

    if (!bm.user_id) {
      await this.bookmarkData.casBookmarkStatus(bm.id, bm.status as queueStatus, queueStatus.FAILED)
      return
    }

    const claimed = await this.bookmarkData.casBookmarkStatus(bm.id, bm.status as queueStatus, queueStatus.FAILED)
    if (!claimed) return

    try {
      await this.kickoffWorkflowForRetry(ctx, bm)
      await this.crawlService.sendAddBookmarkStepEvent(bm.user_id, bm.id, hostname, 'stuck_retry', 'success')
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      await this.crawlService.pushBookmarkFailureAlert(bm.user_id, 'stuck.retry_failed', {
        bookmark_id: bm.id,
        url: bm.target_url,
        user_id: bm.user_id,
        error: errMsg
      })
      await this.crawlService.sendAddBookmarkStepEvent(bm.user_id, bm.id, hostname, 'stuck_retry', 'failed', errMsg)
    }
  }

  private async kickoffWorkflowForRetry(ctx: ContextManager, bm: { id: number; target_url: string; user_id: number }) {
    const hashids = new Hashid(ctx.env, bm.user_id)
    const enUserId = hashids.encodeId(bm.user_id)
    const userInfo = await this.userData.getUserInfo(bm.user_id)
    if (!userInfo) {
      console.error(`User not found for bookmark ${bm.id} with user_id ${bm.user_id}`)
      return
    }
    await this.crawlService.createWorkflow(ctx.env, {
      url: bm.target_url,
      bookmarkId: bm.id,
      userId: bm.user_id,
      enUserId,
      userLang: userInfo.ai_lang || 'en',
      callbackChatId: 0,
      callbackOriginMessageId: 0,
      ignoreGenerateTag: false
    })
  }
}
