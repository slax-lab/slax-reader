import { inject, injectable } from '@/decorators/di'
import { UserService } from '@/domain/user'
import { DBSyncBatchOperation, type SyncCommitObserver } from '@/infra/repository/dbSyncBatch'
import { QueueClient, queueRetryParseMessage, callbackType } from '@/infra/queue/queueClient'
import { ContextManager } from '@/utils/context'
import { parserType, URLPolicie } from '@/utils/urlPolicie'
import { CrawlService } from '@/domain/crawl'
import { GA4AnalyticsClient } from '@/infra/external/ga4Analytics'
import { LogsService } from '@/domain/logs'
import { CollectionRepo } from '@/infra/repository/dbCollection'
import { BookmarkSearchRepo } from '@/infra/repository/dbBookmarkSearch'
import { BookmarkRepo, queueStatus } from '@/infra/repository/dbBookmark'
import { LabService } from '@/domain/lab'
import { SearchService } from '@/domain/search'
import { bookmarkEventProperties, getEventContext, submitServerEvent } from '@/domain/events'
import { ErrorMarkTypeError, ErrorParam, SyncTableRuleError, SyncTableTagNameError, UserNotFoundError } from '@/const/err'
import { SignJWT } from 'jose'
import { markType } from '@/infra/repository/dbMark'

export type SyncExecOperation = 'PUT' | 'PATCH' | 'DELETE'

export interface SyncChangeItem {
  table: string
  id: string
  op: SyncExecOperation
  data?: Record<string, string>
  preData?: Record<string, string>
}

export interface SyncChangeUserBookmarkMetadata {
  tags?: string[]
  share?: SyncChangeUserBookmarkShare
  bookmark?: SyncChangeUserBookmark
}

export interface CreateTagData {
  tagName: string
}

export interface CreateBookmarkData {
  targetUrl: string
  title: string
  thumbnail?: string
  description?: string
  isArchive: boolean
  isNewBookmark: boolean
}

export interface UpdateBookmarkData {
  is_read?: boolean
  archive_status?: 0 | 1
  is_starred?: boolean
  alias_title?: string
}

export interface UpdateTagsData {
  tagsToAdd: string[]
  tagsToDelete: string[]
}

export interface UpdateShareData {
  isEnable: boolean
}

export interface CreateCommentData {
  userBookmarkUuid: string
  type: number
  source: string
  comment: string
  rootUuid: string
  parentUuid: string
  approxSource: string
  content: string
  sourceType: string
  sourceId: string
}

export interface DeleteCommentData {
  isDeleted: boolean
}

type SyncOperation<T extends string, D = undefined, U = string> = {
  userId: number
  type: T
  bookmarkUuid: U
  data: D
}

type TagSyncOperation<T extends string, D = undefined, U = string> = {
  userId: number
  type: T
  tagUuid: U
  data: D
}

type CommentSyncOperation<T extends string, D = undefined, U = string> = {
  userId: number
  type: T
  commentUuid: U
  data: D
}

export type OrderedSyncOperation =
  | TagSyncOperation<'create_tag', CreateTagData, string>
  | SyncOperation<'create_bookmark', CreateBookmarkData, string>
  | SyncOperation<'update_bookmark', UpdateBookmarkData, string>
  | SyncOperation<'update_tags', UpdateTagsData, string>
  | SyncOperation<'update_share', UpdateShareData, string>
  | SyncOperation<'delete_bookmark', undefined, string>
  | SyncOperation<'restore_bookmark', undefined, string>
  | CommentSyncOperation<'create_comment', CreateCommentData, string>
  | CommentSyncOperation<'delete_comment', DeleteCommentData, string>

export interface SyncChangeUserBookmark {
  uuid: string
  title: string
  byline: string
  status: string
  host_url: string
  site_name: string
  target_url: string
  description: string
  content_icon: string
  published_at: string
  content_cover: string
  content_word_count: number
}

export interface SyncChangeUserBookmarkShare {
  is_enable?: boolean
  show_line?: boolean
  allow_line?: boolean
  created_at?: boolean
  share_code?: boolean
  show_comment?: boolean
  show_userinfo?: boolean
}

@injectable()
export class SyncOrchestrator {
  constructor(
    @inject(UserService) private userService: UserService,
    @inject(DBSyncBatchOperation) private dbSyncBatch: DBSyncBatchOperation,
    @inject(QueueClient) private queueClient: QueueClient,
    @inject(SearchService) protected searchService: SearchService,
    @inject(CrawlService) private crawlService: CrawlService,
    @inject(GA4AnalyticsClient) private ga4Client: GA4AnalyticsClient,
    @inject(LogsService) private logsService: LogsService,
    @inject(CollectionRepo) private collectionRepo: CollectionRepo,
    @inject(BookmarkSearchRepo) private bookmarkSearchRepo: BookmarkSearchRepo,
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo,
    @inject(LabService) private labService: LabService
  ) {}

  /** sign token */
  public async signToken(ctx: ContextManager) {
    const userInfo = await this.userService.getUserInfo(ctx)
    if (!userInfo.uuid) throw UserNotFoundError()

    const payload = {
      sub: userInfo.uuid,
      aud: 'reader-sync'
    }

    const privateJwk = JSON.parse(ctx.env.POWERSYNC_JWK_PRIVATE_KEY.replace(/\\/g, ''))
    const jwt = await new SignJWT(payload)
      .setProtectedHeader({ alg: 'RS256', kid: privateJwk.kid })
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(await crypto.subtle.importKey('jwk', privateJwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']))

    return { token: jwt, endpoint: ctx.env.POWERSYNC_SG_API_URL }
  }

  private async commitBookmarkChanges(ctx: ContextManager, changes: SyncChangeItem[]) {
    const userInfo = await this.userService.getUserInfo(ctx)
    if (!userInfo.uuid) throw UserNotFoundError()

    const userId = ctx.getUserId()
    const orderedOperations: OrderedSyncOperation[] = []

    for (const change of changes) {
      if (change.table === 'sr_user_bookmark') {
        this.processUserBookmarkChange(change, userId, orderedOperations)
      } else if (change.table === 'sr_user_tag' && change.op === 'PUT') {
        this.processUserTagChange(change, userId, orderedOperations)
      } else if (change.table === 'sr_bookmark_comment') {
        this.processUserBookmarkCommentChange(change, userId, orderedOperations)
      } else {
        throw SyncTableRuleError()
      }
    }

    const observer = this.syncCommitObserver(ctx)
    const result = observer ? await this.dbSyncBatch.executeOrderedOperations(orderedOperations, observer) : await this.dbSyncBatch.executeOrderedOperations(orderedOperations)
    for (const newBookmark of result) {
      await this.sendRetryParseEvent(ctx, newBookmark)
    }

    // 同步删除/恢复需补清缓存
    if (orderedOperations.some(op => op.type === 'delete_bookmark' || op.type === 'restore_bookmark')) {
      await this.searchService.clearSearchCache(ctx, userId)
    }
  }

  private appendCommentOperation(change: SyncChangeItem, userId: number, operations: OrderedSyncOperation[]) {
    if (!change.data) return

    // soft delete comment
    if (change.op === 'PATCH' && change.data && change.data.hasOwnProperty('is_deleted')) {
      const isDeleted = change.data.is_deleted === 'true' || change.data.is_deleted === '1'
      if (!isDeleted) return

      operations.push({
        type: 'delete_comment',
        commentUuid: change.id,
        userId,
        data: {
          isDeleted: true
        }
      })
      return
    }

    // create comment
    if (change.op === 'PUT') {
      const userBookmarkUuid = change.data['user_bookmark_uuid'] || ''
      if (!userBookmarkUuid) throw ErrorParam()

      const type = parseInt(change.data['type'] || '0')
      if (![markType.LINE, markType.COMMENT, markType.REPLY, markType.ORIGIN_LINE, markType.ORIGIN_COMMENT].includes(type)) {
        throw ErrorMarkTypeError()
      }

      let rootUuid = ''
      let parentUuid = ''
      if (change.data['metadata']) {
        try {
          const metadata = JSON.parse(change.data['metadata']) as { root_id?: string; parent_id?: string }
          rootUuid = metadata.root_id || ''
          parentUuid = metadata.parent_id || ''
        } catch {
          // metadata parse failure
        }
      }

      operations.push({
        type: 'create_comment',
        commentUuid: change.id,
        userId,
        data: {
          userBookmarkUuid,
          type,
          source: change.data['source'] || '[]',
          comment: change.data['comment'] || '',
          rootUuid,
          parentUuid,
          approxSource: change.data['approx_source'] || '',
          content: change.data['content'] || '',
          sourceType: 'bookmark',
          sourceId: ''
        }
      })
      return
    }
  }

  /** user bookmark change */
  public processUserBookmarkChange(change: SyncChangeItem, userId: number, operations: OrderedSyncOperation[]) {
    if (!change.data) return

    // create new bookmark
    if (change.op === 'PUT' && change.data.hasOwnProperty('metadata')) {
      const bookmarkData = JSON.parse(change.data['metadata'].replaceAll('\\\\', '')) as SyncChangeUserBookmarkMetadata
      if (!bookmarkData.bookmark) throw ErrorParam()
      operations.push({
        type: 'create_bookmark',
        bookmarkUuid: change.id,
        userId,
        data: {
          targetUrl: bookmarkData.bookmark.target_url,
          title: bookmarkData.bookmark.title,
          thumbnail: bookmarkData.bookmark.content_icon,
          description: bookmarkData.bookmark.description,
          isArchive: change.data.archive_status === '1',
          isNewBookmark: true
        }
      })
      return
    }

    // soft delete/restore
    if (change.data.hasOwnProperty('deleted_at')) {
      const isRestore = !change.data['deleted_at']
      operations.push({
        type: isRestore ? 'restore_bookmark' : 'delete_bookmark',
        bookmarkUuid: change.id,
        userId,
        data: undefined
      })
      return
    }

    // update bookmark field
    const updates: UpdateBookmarkData = {}
    if (change.data.hasOwnProperty('is_read')) {
      updates.is_read = true
    }
    if (change.data.hasOwnProperty('archive_status')) {
      updates.archive_status = parseInt(change.data.archive_status) as 0 | 1
    }
    if (change.data.hasOwnProperty('is_starred')) {
      updates.is_starred = change.data.is_starred === '1'
    }
    if (change.data.hasOwnProperty('alias_title')) {
      updates.alias_title = change.data.alias_title
    }

    if (Object.keys(updates).length > 0) {
      operations.push({
        type: 'update_bookmark',
        bookmarkUuid: change.id,
        userId,
        data: updates
      })
    }

    // update tags
    if (change.data.hasOwnProperty('metadata.tags')) {
      this.processTagsChange(change, userId, operations)
    }

    // update share status
    if (change.data.hasOwnProperty('metadata.share.is_enable')) {
      this.processShareChange(change, userId, operations)
    }
  }

  /** update tags */
  public processTagsChange(change: SyncChangeItem, userId: number, operations: OrderedSyncOperation[]) {
    if (!change.data) return

    const tags = JSON.parse(change.data['metadata.tags'].replaceAll('\\\\', '')) as string[]
    const preTags = change.preData?.['metadata.tags'] ? (JSON.parse(change.preData['metadata.tags'].replaceAll('\\\\', '')) as string[]) : []
    const newTags = tags.filter(tag => !preTags.includes(tag))
    const deletedTags = preTags.filter(tag => !tags.includes(tag))

    if (newTags.length > 0 || deletedTags.length > 0) {
      operations.push({
        type: 'update_tags',
        bookmarkUuid: change.id,
        userId,
        data: {
          tagsToAdd: newTags,
          tagsToDelete: deletedTags
        }
      })
    }
  }

  /** create user tag */
  public processUserTagChange(change: SyncChangeItem, userId: number, operations: OrderedSyncOperation[]) {
    if (!change.data) return

    const tagName = change.data['tag_name']
    if (!tagName) throw SyncTableTagNameError()

    operations.push({
      type: 'create_tag',
      userId,
      tagUuid: change.id,
      data: {
        tagName
      }
    })
  }

  public async syncChanges(ctx: ContextManager, changes: SyncChangeItem[]) {
    const subscriberChanges = changes.filter(c => c.table === 'sr_user_collection_subscriber')
    for (const change of subscriberChanges) {
      await this.processCollectionSubscriberChange(ctx, change)
    }

    const rest = changes.filter(c => c.table !== 'sr_user_collection_subscriber')
    if (rest.length > 0) {
      await this.commitBookmarkChanges(ctx, rest)
      // 落库成功后再埋，避免误记
      this.trackBookmarkChanges(ctx, rest)
    }
  }

  protected syncCommitObserver(ctx: ContextManager): SyncCommitObserver {
    return (mutations, committedAt) => {
      const context = getEventContext(ctx)
      for (const { operation, before, after } of mutations) {
        const options = { userId: operation.userId, occurredAt: committedAt }
        if (operation.type === 'create_comment' || operation.type === 'delete_comment') {
          const mark = after || before
          if (!mark || mark.type !== 1 || !mark.user_bookmark_uuid) continue
          const properties = { highlight_id: mark.uuid, bookmark_id: mark.user_bookmark_uuid }
          if (!before && after && !after.is_deleted) submitServerEvent(ctx, undefined, 'highlight_created', properties, options)
          if (before && !before.is_deleted && (!after || after.is_deleted)) submitServerEvent(ctx, undefined, 'highlight_deleted', properties, options)
          continue
        }
        const relation = after || before
        if (!relation?.bookmark) continue
        const properties = bookmarkEventProperties({ ...relation, bookmark: relation.bookmark }, context.source)
        if (operation.type === 'create_bookmark' && !before && after) submitServerEvent(ctx, undefined, 'bookmark_saved', properties, options)
        if (operation.type === 'delete_bookmark' && before && !before.deleted_at && (!after || after.deleted_at)) {
          submitServerEvent(ctx, undefined, 'bookmark_deleted', properties, options)
        }
        if (operation.type === 'update_bookmark' && before && after) {
          if (before.archive_status !== after.archive_status)
            submitServerEvent(ctx, undefined, after.archive_status === 1 ? 'bookmark_archived' : 'bookmark_unarchived', properties, options)
          if (before.is_starred !== after.is_starred) submitServerEvent(ctx, undefined, after.is_starred ? 'bookmark_starred' : 'bookmark_unstarred', properties, options)
        }
      }
    }
  }

  // dweb 加星/回收站不走 REST
  private trackBookmarkChanges(ctx: ContextManager, changes: SyncChangeItem[]) {
    const userId = ctx.getUserId()
    for (const change of changes) {
      if (change.table !== 'sr_user_bookmark') continue

      // 复用上游解析，避免口径分叉
      const operations: OrderedSyncOperation[] = []
      try {
        this.processUserBookmarkChange(change, userId, operations)
      } catch {
        continue
      }

      for (const operation of operations) {
        if (operation.type === 'delete_bookmark') {
          ctx.execution.waitUntil(this.logsService.track(userId, 'trash', { bookmark_uuid: operation.bookmarkUuid, channel: 'powersync' }))
        } else if (operation.type === 'update_bookmark' && operation.data.is_starred !== undefined) {
          const event = operation.data.is_starred ? 'star' : 'unstar'
          ctx.execution.waitUntil(this.logsService.track(userId, event, { bookmark_uuid: operation.bookmarkUuid, channel: 'powersync' }))
        }
      }
    }
  }

  private async processCollectionSubscriberChange(ctx: ContextManager, change: SyncChangeItem) {
    if (change.op !== 'PATCH' || !change.data || !change.data['last_read_at']) return
    const lastReadAt = new Date(change.data['last_read_at'])
    if (isNaN(lastReadAt.getTime())) return
    await this.collectionRepo.updateSubscriberLastReadAt(ctx.getUserId(), change.id, lastReadAt)
  }

  public processUserBookmarkCommentChange(change: SyncChangeItem, userId: number, operations: OrderedSyncOperation[]) {
    const operationCount = operations.length
    this.appendCommentOperation(change, userId, operations)

    if (change.op !== 'PUT' || operations.length === operationCount || !change.data?.metadata) return

    try {
      const metadata = JSON.parse(change.data.metadata) as { source_type?: string; source_id?: string }
      const operation = operations.at(-1)
      if (operation?.type === 'create_comment' && metadata.source_type === 'collection' && metadata.source_id) {
        operation.data.sourceType = 'collection'
        operation.data.sourceId = metadata.source_id
      }
    } catch {}
  }

  public processShareChange(change: SyncChangeItem, userId: number, operations: OrderedSyncOperation[]) {
    if (!change.data) return

    const rawIsEnable = change.data['metadata.share.is_enable']
    if (!rawIsEnable) return

    const share = JSON.parse(rawIsEnable.replaceAll('\\\\', '')) as boolean | { is_enable?: boolean }
    const isEnable = typeof share === 'boolean' ? share : share.is_enable
    if (typeof isEnable !== 'boolean') return

    operations.push({
      type: 'update_share',
      bookmarkUuid: change.id,
      userId,
      data: { isEnable }
    })
  }

  public async sendRetryParseEvent(ctx: ContextManager, newBookmark: { bookmarkId: number; targetUrl: string; userId: number }) {
    try {
      await this.bookmarkSearchRepo.upsertUserBookmark(newBookmark.userId, newBookmark.bookmarkId)
      await this.searchService.clearSearchCache(ctx, newBookmark.userId)
    } catch (error) {
      console.error(`Failed to sync search relation for bookmark ${newBookmark.bookmarkId}:`, error)
    }

    try {
      const police = new URLPolicie(ctx.env, newBookmark.targetUrl)
      const pType = police.getParserType()

      if (pType === parserType.BLOCK_PARSE) return

      // Labs gate: the client already wrote the row, so the most the server can do is not crawl it
      try {
        await this.labService.assertUrlAllowed(ctx, newBookmark.targetUrl)
      } catch (error) {
        if (!LabService.isLabDisabledError(error)) throw error
        await this.bookmarkRepo.updateBookmarkStatus(newBookmark.bookmarkId, queueStatus.FAILED)
        ctx.execution.waitUntil(
          this.logsService.track(newBookmark.userId, 'bookmark_add', { bookmark_id: newBookmark.bookmarkId, channel: 'powersync_batch', status: 'lab_disabled' })
        )
        return
      }

      ctx.execution.waitUntil(
        this.ga4Client.trackEvent(newBookmark.userId, 'bookmark_add_start', {
          channel: 'powersync_batch',
          method: 'manual_paste'
        })
      )

      await this.crawlService.createWorkflow(
        ctx.env,
        {
          url: newBookmark.targetUrl,
          bookmarkId: newBookmark.bookmarkId,
          userId: newBookmark.userId,
          enUserId: ctx.getEncodeUserId(),
          userLang: ctx.getlang(),
          callbackChatId: 0,
          callbackOriginMessageId: 0,
          ignoreGenerateTag: false
        },
        3,
        ctx
      )

      ctx.execution.waitUntil(this.logsService.track(newBookmark.userId, 'bookmark_add', { bookmark_id: newBookmark.bookmarkId, channel: 'powersync_batch', status: 'success' }))
    } catch (error) {
      console.error(`Failed to create crawl workflow for bookmark ${newBookmark.bookmarkId}:`, error)
      ctx.execution.waitUntil(this.logsService.track(newBookmark.userId, 'bookmark_add', { bookmark_id: newBookmark.bookmarkId, channel: 'powersync_batch', status: 'failed' }))
    }
  }
}
