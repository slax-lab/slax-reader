import { pickTagsForBookmark } from '@/utils/tags'
import { inject, injectable } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { BookmarkService } from '@/domain/bookmark'
import { BookmarkTag, TagService } from '@/domain/tag'
import { MarkService } from '@/domain/mark'
import { CollectionService } from '@/domain/collection'
import { NotificationService } from '@/domain/notification'
import { AigcService, MixTagsOverviewResult } from '@/domain/aigc'
import { UserService } from '@/domain/user'
import { BookmarkContentNotFoundError, BookmarkNotFoundError, ProhibitedContentError, UserNotFoundError, BookmarkOverviewContentError } from '@/const/err'
import { MultiLangError } from '@/utils/multiLangError'
import { BucketClient } from '@/infra/repository/bucketClient'
import type { LazyInstance } from '@/decorators/lazy'
import { isProhibitedContentUrl } from '@/utils/prohibitedContentDetector'

@injectable()
export class BookmarkOrchestrator {
  private notifySvc: NotificationService
  private collectSvc: CollectionService
  private markSvc: MarkService
  private aigcSvc: AigcService
  private bookmarkSvc: BookmarkService
  private tagSvc: TagService
  private userSvc: UserService

  constructor(
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(TagService) private tagService: TagService,
    @inject(MarkService) private markService: MarkService,
    @inject(CollectionService) collectionService: CollectionService,
    @inject(NotificationService) notificationService: NotificationService,
    @inject(AigcService) aigcService: AigcService,
    @inject(UserService) userService: UserService,
    @inject(BucketClient) bucketClient: LazyInstance<BucketClient>
  ) {
    this.notifySvc = notificationService
    this.collectSvc = collectionService
    this.markSvc = markService
    this.aigcSvc = aigcService
    this.bookmarkSvc = bookmarkService
    this.tagSvc = tagService
    this.userSvc = userService
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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { id, content_key, content_md_key, private_user, ...bookmarkWithoutId } = res.bookmark
    const { overview, key_takeaways } = this.parseOverviewRes(overviewResult.status === 'fulfilled' ? (overviewResult.value ?? null) : null)

    return {
      ...bookmarkWithoutId,
      bookmark_id: ctx.hashIds.encodeId(res.bookmark.id),
      bookmark_user_uuid: res.uuid,
      content: contentResult.status === 'fulfilled' ? contentResult.value : undefined,
      archived: res.archive_status === 1 ? 'archive' : res.archive_status === 2 ? 'later' : 'inbox',
      starred: res.is_starred ? 'star' : 'unstar',
      trashed_at: res.deleted_at,
      marks: marksResult.status === 'fulfilled' ? marksResult.value : { mark_list: [], user_list: {} },
      alias_title: res.alias_title,
      tags: tagsResult.status === 'fulfilled' ? tagsResult.value : [],
      user_id: ctx.hashIds.encodeId(userId),
      type: res.type === 1 ? 'shortcut' : 'article',
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
      description: bm.description,
      tags,
      created_at: bm.created_at,
      updated_at: bm.updated_at,
      published_at: bm.published_at,
      byline: bm.byline,
      content_word_count: bm.content_word_count,
      target_url: bm.target_url,
      status: bm.status
    }
  }

  // 书签加星标
  public async bookmarkStar(ctx: ContextManager, bmId: number, status: 'star' | 'unstar') {
    return this.bookmarkService.updateBookmarkStarStatus(ctx.getUserId(), bmId, status === 'star').then(async res => {
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

  private writeProgress = async (params: { writer: WritableStreamDefaultWriter<Uint8Array>; encoder: TextEncoder; data: any }) => {
    const { writer, encoder, data } = params
    try {
      await writer.write(encoder.encode(JSON.stringify({ type: 'progress', data }) + '\n'))
    } catch {}
  }

  private async generateBaseStream(params: { cacheHandler: () => Promise<boolean>; generateHandler: () => Promise<void> }): Promise<void> {
    const { cacheHandler, generateHandler } = params

    const res = await cacheHandler()
    if (res) return

    await generateHandler()
  }

  private async resolveBookmarkAiAccess(
    ctx: ContextManager,
    params: { bookmarkId?: number; bookmarkUid?: string }
  ): Promise<{ bookmarkId: number; ownerId: number; readOnly: boolean } | null> {
    const userId = ctx.getUserId()
    if (params.bookmarkUid) {
      const access = await this.bookmarkSvc.getBookmarkReadAccess(ctx, params.bookmarkUid)
      if (!access) return null
      const userBookmark = access.bookmark

      return {
        bookmarkId: userBookmark.bookmark_id,
        ownerId: userBookmark.user_id,
        readOnly: userBookmark.user_id !== userId
      }
    }

    const bookmarkId = await this.bookmarkSvc.getBookmarkId(ctx, { bmId: params.bookmarkId })
    if (bookmarkId < 1) return null

    return {
      bookmarkId,
      ownerId: userId,
      readOnly: false
    }
  }

  public async generateBookmarkOverviewStream(
    ctx: ContextManager,
    params: {
      bmId?: number
      bmUId?: string
      writer: WritableStreamDefaultWriter<Uint8Array>
      encoder: TextEncoder
      isForce: boolean
    }
  ): Promise<void> {
    const { bmId, bmUId, writer, encoder, isForce } = params
    const userId = ctx.getUserId()
    const access = await this.resolveBookmarkAiAccess(ctx, { bookmarkId: bmId, bookmarkUid: bmUId })
    if (!access) {
      await this.writeProgress({ writer, encoder, data: { done: true } })
      return
    }
    const { bookmarkId, ownerId, readOnly } = access

    const writerBaseParams = {
      writer,
      encoder
    }

    return await this.generateBaseStream({
      cacheHandler: async () => {
        if (!readOnly) {
          const bookmarkTags = await this.tagSvc.getBookmarkTags(ctx, userId, bookmarkId)
          if (bookmarkTags.length > 0) {
            await this.writeProgress({ ...writerBaseParams, data: { tags: bookmarkTags.map(tag => ({ name: tag.name, id: tag.id })) } })
          }
        }

        if (!isForce) {
          const existingOverview = await this.bookmarkSvc.getUserBookmarkOverview(ownerId, bookmarkId)
          let keyTakeaways: string[] = []
          let { overview, content } = existingOverview ?? {}
          if (content) {
            const res = JSON.parse(content) as Omit<MixTagsOverviewResult, 'tags'>
            overview = res.overview
            keyTakeaways = res.key_takeaways
          }

          if (overview) {
            // output overview
            await this.writeProgress({ ...writerBaseParams, data: { overview: overview || '' } })
            // output key_takeaways
            keyTakeaways.length > 0 && (await this.writeProgress({ ...writerBaseParams, data: { key_takeaways: keyTakeaways || '' } }))
            // output done
            await this.writeProgress({ ...writerBaseParams, data: { done: true } })
            return true
          }
        }

        if (readOnly) {
          await this.writeProgress({ ...writerBaseParams, data: { done: true } })
          return true
        }

        return false
      },
      generateHandler: async () => {
        ctx.execution.waitUntil(this.cancelPendingBatchTasks(userId, bookmarkId))
        await this.generateOverviewStream(ctx, { writer, encoder, userId, bmId: bookmarkId, bookmarkTags: [] })
      }
    })
  }

  public async generateBookmarkOutlineStream(
    ctx: ContextManager,
    params: {
      bmId?: number
      bmUId?: string
      writer: WritableStreamDefaultWriter<Uint8Array>
      encoder: TextEncoder
      isForce: boolean
    }
  ): Promise<void> {
    const { bmId, bmUId, writer, encoder, isForce } = params
    const userId = ctx.getUserId()
    const access = await this.resolveBookmarkAiAccess(ctx, { bookmarkId: bmId, bookmarkUid: bmUId })
    if (!access) {
      await this.writeProgress({ writer, encoder, data: { done: true } })
      return
    }
    const { bookmarkId, ownerId, readOnly } = access

    const writerBaseParams = {
      writer,
      encoder
    }

    return await this.generateBaseStream({
      cacheHandler: async () => {
        if (!isForce) {
          const outline = readOnly ? await this.bookmarkSvc.getBookmarkOutline(bookmarkId, ownerId) : (await this.bookmarkSvc.getUserBookmarkSummary(ctx, { bmId, bmUId }))?.content

          if (outline) {
            await this.writeProgress({ ...writerBaseParams, data: { outline } })
            await this.writeProgress({ ...writerBaseParams, data: { done: true } })
            return true
          }
        }

        if (readOnly) {
          await this.writeProgress({ ...writerBaseParams, data: { done: true } })
          return true
        }

        return false
      },
      generateHandler: async () => {
        await this.generateOutlineStream(ctx, { writer, encoder, userId, bmId: bookmarkId })
      }
    })
  }

  private async generateOverviewStream(
    ctx: ContextManager,
    params: { writer: WritableStreamDefaultWriter<Uint8Array>; encoder: TextEncoder; userId: number; bmId: number; bookmarkTags: BookmarkTag[] }
  ) {
    const { writer, encoder, userId, bmId, bookmarkTags } = params
    const [user, bookmark, userTags, userBookmark] = await Promise.all([
      this.userSvc.getUserInfo(ctx),
      this.bookmarkSvc.getBookmarkById(bmId),
      this.tagSvc.listUserTags(ctx),
      this.bookmarkSvc.getUserBookmark(bmId, userId)
    ])

    if (!user || !userBookmark) throw UserNotFoundError()
    if (!bookmark?.content_md_key) throw BookmarkNotFoundError()
    if (isProhibitedContentUrl(bookmark.target_url)) throw ProhibitedContentError()
    if (bookmark.moderation_result > 0) throw ProhibitedContentError()

    ctx.set('ai_lang', user.ai_lang)

    const textContent = await this.bookmarkSvc.getBookmarkContent(bookmark.content_md_key)
    if (!textContent) throw BookmarkContentNotFoundError()

    const writerBaseParams = {
      writer,
      encoder
    }

    try {
      const result = await this.aigcSvc.generateOverviewTag(ctx, bookmark.title, textContent, bookmark.byline || '', userTags)

      if (result.overview.length > 0) {
        await this.bookmarkSvc.createBookmarkOverview(userId, bookmark.id, '', JSON.stringify({ overview: result.overview || '', key_takeaways: result.key_takeaways }))
        await this.writeProgress({ ...writerBaseParams, data: { overview: result.overview || '' } })
        await this.writeProgress({ ...writerBaseParams, data: { key_takeaways: result.key_takeaways || '' } })
      }

      if (bookmarkTags.length > 0) return

      if (result.tags === null || result.tags.length === 0) {
        console.log('No tags generated')
        return
      }

      // mine first, then auto, capped at 3
      const availableTagNames: string[] = []
      for (const userTag of pickTagsForBookmark(result.tags, userTags)) {
        availableTagNames.push(userTag.name)
        await this.writeProgress({ ...writerBaseParams, data: { tag: { id: userTag.id, name: userTag.name } } })
      }

      // 并发执行标签更新操作
      const updateRes = await this.tagSvc.updateUserTagsDisplay(userId, availableTagNames)
      if (!updateRes) return

      await this.tagSvc.upsertBookmarkTags(bmId, userId, updateRes)
    } catch (error) {
      console.error('Generate overview stream failed:', error)
      throw error
    } finally {
      await this.writeProgress({ ...writerBaseParams, data: { done: true } })
    }
  }

  private async generateOutlineStream(ctx: ContextManager, params: { writer: WritableStreamDefaultWriter<Uint8Array>; encoder: TextEncoder; userId: number; bmId: number }) {
    const { writer, encoder, userId, bmId } = params
    const [user, bookmark, userBookmark] = await Promise.all([
      this.userSvc.getUserInfo(ctx),
      this.bookmarkSvc.getBookmarkById(bmId),
      this.bookmarkSvc.getUserBookmark(bmId, userId)
    ])

    if (!user || !userBookmark) throw UserNotFoundError()
    if (!bookmark?.content_md_key) throw BookmarkNotFoundError()
    if (isProhibitedContentUrl(bookmark.target_url)) throw ProhibitedContentError()
    if (bookmark.moderation_result > 0) throw ProhibitedContentError()

    ctx.set('ai_lang', user.ai_lang)

    const textContent = await this.bookmarkSvc.getBookmarkContent(bookmark.content_md_key)
    if (!textContent) throw BookmarkContentNotFoundError()

    const writerBaseParams = {
      writer,
      encoder
    }

    try {
      let outline = ''
      const result = await this.aigcSvc.generateOutline(ctx, textContent, async chunk => {
        if (chunk instanceof MultiLangError) {
          await this.writeProgress({ ...writerBaseParams, data: { done: true } })
        } else if (chunk.content) {
          outline = chunk.content || ''
          await this.writeProgress({ ...writerBaseParams, data: { outline: chunk.content || '' } })
        }
      })

      if (outline.length > 0) {
        await this.writeProgress({ ...writerBaseParams, data: { outline: outline || '' } })
        bmId > 0 && (await this.bookmarkSvc.saveSummary(ctx, bmId, result.model, outline, result.model))
      }
    } catch (error) {
      console.error('Generate outline stream failed:', error)
      throw error
    } finally {
      await this.writeProgress({ ...writerBaseParams, data: { done: true } })
    }
  }

  private async cancelPendingBatchTasks(userId: number, bmId: number) {
    try {
      const tasks = await this.bookmarkSvc.getUserBookmarkBatchTasks(userId, bmId, 'tags_overview')
      await Promise.all(tasks.map(task => this.aigcSvc.cancelBatchTask(task.batch_request_id).catch(() => {})))
    } catch (e) {
      console.log(`cancel batch tasks failed: ${e}`)
    }
  }
}
