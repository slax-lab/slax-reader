import { bookmarkContentType } from '@slax-reader/contracts/pdf'
import { inject, injectable } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { BookmarkService } from '@/domain/bookmark'
import { TagService } from '@/domain/tag'
import type { MixTagsOverviewResult } from '@/domain/aigc'
import { MarkService } from '@/domain/mark'
import { CollectionService } from '@/domain/collection'
import { NotificationService } from '@/domain/notification'
import { BookmarkNotFoundError, BookmarkOverviewContentError } from '@/const/err'
import { BucketClient } from '@/infra/repository/bucketClient'
import type { LazyInstance } from '@/decorators/lazy'
import { dispatchVectorMaintenance } from '@/domain/vectorMaintenanceHooks'

@injectable()
export class BookmarkOrchestrator {
  private notifySvc: NotificationService
  private collectSvc: CollectionService
  private markSvc: MarkService
  private bookmarkSvc: BookmarkService
  private tagSvc: TagService

  constructor(
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(TagService) private tagService: TagService,
    @inject(MarkService) private markService: MarkService,
    @inject(CollectionService) collectionService: CollectionService,
    @inject(NotificationService) notificationService: NotificationService,
    @inject(BucketClient) bucketClient: LazyInstance<BucketClient>
  ) {
    this.notifySvc = notificationService
    this.collectSvc = collectionService
    this.markSvc = markService
    this.bookmarkSvc = bookmarkService
    this.tagSvc = tagService
  }

  public async getBookmarkMarkList(ctx: ContextManager, userId: number, bmId: number) {
    const res = await this.bookmarkService.getUserBookmarkWithDetail(userId, bmId)
    if (!res || !res.bookmark) throw BookmarkNotFoundError()
    if (res.bookmark.private_user > 0 && res.bookmark.private_user !== userId) throw BookmarkNotFoundError()

    const marksResult = await this.markService.getBookmarkMarkList(ctx, { id: res.id, isShowMarks: true })
    return marksResult
  }

  public async getBookmarkBriefInfo(ctx: ContextManager, bmId: number) {
    const res = await this.bookmarkService.getUserBookmarkWithDetail(ctx.getUserId(), bmId)
    if (!res || !res.bookmark) throw BookmarkNotFoundError()
    if (res.bookmark.private_user > 0 && res.bookmark.private_user !== ctx.getUserId()) throw BookmarkNotFoundError()

    const [marksResult, overviewResult, tagsResult] = await Promise.allSettled([
      this.markService.getBookmarkMarkList(ctx, { id: res.id, isShowMarks: true }),
      this.bookmarkService.getUserBookmarkOverview(ctx.getUserId(), bmId),
      this.tagService.getBookmarkTags(ctx, ctx.getUserId(), bmId)
    ])
    const { id, content_key, content_md_key, private_user, ...bookmarkWithoutId } = res.bookmark
    const { overview, key_takeaways } = this.parseOverviewRes(overviewResult.status === 'fulfilled' ? (overviewResult.value ?? null) : null)

    return {
      ...bookmarkWithoutId,
      bookmark_id: ctx.hashIds.encodeId(res.bookmark.id),
      bookmark_user_uuid: res.uuid,
      archived: res.archive_status === 1 ? 'archive' : res.archive_status === 2 ? 'later' : 'inbox',
      starred: res.is_starred ? 'star' : 'unstar',
      alias_title: res.alias_title,
      tags: tagsResult.status === 'fulfilled' ? tagsResult.value : [],
      marks: marksResult.status === 'fulfilled' ? marksResult.value : [],
      overview,
      key_takeaways
    }
  }

  /** 获取收藏详情 */
  public async bookmarkDetail(ctx: ContextManager, bmId: number) {
    const userId = ctx.getUserId()

    const res = await this.bookmarkService.getUserBookmarkWithDetail(userId, bmId)
    if (!res || !res.bookmark) throw BookmarkNotFoundError()
    if (res.bookmark.private_user > 0 && res.bookmark.private_user !== userId) throw BookmarkNotFoundError()

    const [contentResult, marksResult, tagsResult, overviewResult] = await Promise.allSettled([
      this.bookmarkService.getBookmarkContent(res.bookmark.content_key),
      this.markService.getBookmarkMarkList(ctx, { id: res.id, isShowMarks: true }),
      this.tagService.getBookmarkTags(ctx, userId, bmId),
      this.bookmarkService.getUserBookmarkOverview(userId, bmId)
    ])

    if (res.bookmark.status === 'success' && res.bookmark.content_key?.startsWith('html/') && (contentResult.status === 'rejected' || !contentResult.value))
      throw new Error('Stored bookmark content is unavailable')

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, content_key, content_md_key, private_user, ...bookmarkWithoutId } = res.bookmark
    const { overview, key_takeaways } = this.parseOverviewRes(overviewResult.status === 'fulfilled' ? (overviewResult.value ?? null) : null)

    return {
      ...bookmarkWithoutId,
      bookmark_id: ctx.hashIds.encodeId(res.bookmark.id),
      bookmark_user_uuid: res.uuid,
      ...(await this.bookmarkService.getForkMetadata(ctx, res)),
      pdf: await this.bookmarkService.getPdfDescriptor(res.bookmark.content_key, res.uuid),
      content: contentResult.status === 'fulfilled' ? contentResult.value : undefined,
      archived: res.archive_status === 1 ? 'archive' : res.archive_status === 2 ? 'later' : 'inbox',
      starred: res.is_starred ? 'star' : 'unstar',
      trashed_at: res.deleted_at,
      marks: marksResult.status === 'fulfilled' ? marksResult.value : { mark_list: [], user_list: {} },
      alias_title: res.alias_title,
      tags: tagsResult.status === 'fulfilled' ? tagsResult.value : [],
      user_id: ctx.hashIds.encodeId(userId),
      type: bookmarkContentType(res.type),
      overview,
      key_takeaways
    }
  }

  // 书签加星标
  parseOverviewRes(overviewRes: { overview: string; content: string } | null) {
    let overview = ''
    let key_takeaways: string[] = []

    if (overviewRes?.content && overviewRes.content.length > 0) {
      try {
        const overviewContent = JSON.parse(overviewRes.content) as Omit<MixTagsOverviewResult, 'tags'>
        overview = overviewContent.overview
        key_takeaways = overviewContent.key_takeaways
      } catch (e) {
        console.error('Failed to parse overview content:', e)
      }
    } else if (overviewRes?.overview) {
      overview = overviewRes.overview
    }

    return { overview, key_takeaways }
  }

  public async bookmarkMetadata(ctx: ContextManager, bookmarkUid: string) {
    const userId = ctx.getUserId()
    const bmId = await this.bookmarkSvc.getBookmarkId(ctx, { bmUId: bookmarkUid })
    if (bmId < 1) throw BookmarkNotFoundError()

    const res = await this.bookmarkSvc.getUserBookmarkWithDetail(userId, bmId)
    if (!res || !res.bookmark) throw BookmarkNotFoundError()
    if (res.bookmark.private_user > 0 && res.bookmark.private_user !== userId) throw BookmarkNotFoundError()

    const tags = await this.tagSvc.getBookmarkTags(ctx, userId, bmId)
    const bm = res.bookmark

    return {
      bookmark_id: ctx.hashIds.encodeId(bm.id),
      host_url: bm.host_url,
      title: bm.title,
      alias_title: res.alias_title,
      uuid: bm.uuid,
      bookmark_user_uuid: res.uuid,
      description: bm.description,
      tags,
      created_at: bm.created_at,
      updated_at: bm.updated_at,
      published_at: bm.published_at,
      byline: bm.byline,
      content_word_count: bm.content_word_count,
      target_url: bm.target_url,
      type: bookmarkContentType(res.type),
      pdf: await this.bookmarkService.getPdfDescriptor(bm.content_key, res.uuid),
      archive_status: res.archive_status,
      is_starred: res.is_starred,
      is_read: res.is_read,
      status: bm.status
    }
  }

  // 书签加星标
  public async bookmarkStar(ctx: ContextManager, bmId: number, status: 'star' | 'unstar') {
    return this.bookmarkService.updateBookmarkStarStatus(ctx.getUserId(), bmId, status === 'star').then(async res => {
      dispatchVectorMaintenance(ctx, { kind: 'article', mode: 'relation', userId: ctx.getUserId(), id: bmId })
      if (status === 'unstar') return res
      const collection = await this.collectSvc.userHasCollection(ctx)
      if (!collection) return res
      ctx.execution.waitUntil(
        this.notifySvc.createSubscribeUpdateNotification(ctx.env, {
          ownerId: collection.owner_id,
          subscriberId: ctx.getUserId(),
          collectionName: collection.display_name,
          collectionCode: collection.collection_code,
          collectionId: collection.id,
          userBookmarkId: res.id
        })
      )
      return res
    })
  }

  public async getHighlightAndCollectionExist(ctx: ContextManager): Promise<{ highlight: boolean; collection: boolean }> {
    const [highlight, collection] = await Promise.all([this.markSvc.getUserHasHighlight(ctx), this.collectSvc.userHasCollectionSubscribe(ctx)])
    return { highlight, collection }
  }
}
