import { isPdfContentKey } from '@slax-reader/contracts/pdf'
import { pickTagsForBookmark } from '@/utils/tags'
import { inject, injectable } from '@/decorators/di'
import { ContextManager } from '@/utils/context'
import { BookmarkReadService } from '@/domain/bookmarkRead'
import { BookmarkTag, TagService } from '@/domain/tag'
import { AigcService, MixTagsOverviewResult } from '@/domain/aigc'
import { UserProfileService } from '@/domain/userProfile'
import { BookmarkContentNotFoundError, PdfTextUnavailableError, BookmarkNotFoundError, ProhibitedContentError, UserNotFoundError } from '@/const/err'
import { MultiLangError } from '@/utils/multiLangError'
import { isProhibitedContentUrl } from '@/utils/prohibitedContentDetector'

// Streams bookmark overview and outline generation for the AI Worker, using only read and AI services.
@injectable()
export class BookmarkAiOrchestrator {
  constructor(
    @inject(BookmarkReadService) private reads: BookmarkReadService,
    @inject(TagService) private tags: TagService,
    @inject(AigcService) private aigc: AigcService,
    @inject(UserProfileService) private profiles: UserProfileService
  ) {}

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
  ): Promise<{
    bookmarkId: number
    ownerId: number
    readOnly: boolean
  } | null> {
    const userId = ctx.getUserId()
    if (params.bookmarkUid) {
      const access = await this.reads.getBookmarkReadAccess(ctx, params.bookmarkUid)
      if (!access) return null
      const userBookmark = access.bookmark

      return {
        bookmarkId: userBookmark.bookmark_id,
        ownerId: userBookmark.user_id,
        readOnly: userBookmark.user_id !== userId
      }
    }

    const bookmarkId = await this.reads.getBookmarkId(ctx, { bmId: params.bookmarkId })
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
          const bookmarkTags = await this.tags.getBookmarkTags(ctx, userId, bookmarkId)
          if (bookmarkTags.length > 0) {
            await this.writeProgress({ ...writerBaseParams, data: { tags: bookmarkTags.map(tag => ({ name: tag.name, id: tag.id })) } })
          }
        }

        if (!isForce) {
          const existingOverview = await this.reads.getUserBookmarkOverview(ownerId, bookmarkId)
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
          const outline = readOnly ? await this.reads.getBookmarkOutline(bookmarkId, ownerId) : (await this.reads.getUserBookmarkSummary(ctx, { bmId, bmUId }))?.content

          if (outline?.trim()) {
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
    params: {
      writer: WritableStreamDefaultWriter<Uint8Array>
      encoder: TextEncoder
      userId: number
      bmId: number
      bookmarkTags: BookmarkTag[]
    }
  ) {
    const { writer, encoder, userId, bmId, bookmarkTags } = params
    const [user, bookmark, userTags, userBookmark] = await Promise.all([
      this.profiles.getUserInfo(ctx),
      this.reads.getBookmarkById(bmId),
      this.tags.listUserTags(ctx),
      this.reads.getUserBookmark(bmId, userId)
    ])

    if (!user || !userBookmark) throw UserNotFoundError()
    if (bookmark && isPdfContentKey(bookmark.content_key) && !bookmark.content_md_key) throw PdfTextUnavailableError()
    if (!bookmark?.content_md_key) throw BookmarkNotFoundError()
    if (isProhibitedContentUrl(bookmark.target_url)) throw ProhibitedContentError()
    if (bookmark.moderation_result > 0) throw ProhibitedContentError()

    ctx.set('ai_lang', user.ai_lang)

    const textContent = await this.reads.getBookmarkContent(bookmark.content_md_key)
    if (!textContent) throw BookmarkContentNotFoundError()

    const writerBaseParams = {
      writer,
      encoder
    }

    try {
      const result = await this.aigc.generateOverviewTag(ctx, bookmark.title, textContent, bookmark.byline || '', userTags)

      if (result.overview.length > 0) {
        await this.reads.createBookmarkOverview(userId, bookmark.id, '', JSON.stringify({ overview: result.overview || '', key_takeaways: result.key_takeaways }))
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
      const updateRes = await this.tags.updateUserTagsDisplay(userId, availableTagNames)
      if (!updateRes) return

      await this.tags.upsertBookmarkTags(bmId, userId, updateRes)
    } catch (error) {
      console.error('Generate overview stream failed:', error)
      throw error
    } finally {
      await this.writeProgress({ ...writerBaseParams, data: { done: true } })
    }
  }

  private async generateOutlineStream(
    ctx: ContextManager,
    params: {
      writer: WritableStreamDefaultWriter<Uint8Array>
      encoder: TextEncoder
      userId: number
      bmId: number
    }
  ) {
    const { writer, encoder, userId, bmId } = params
    const [user, bookmark, userBookmark] = await Promise.all([this.profiles.getUserInfo(ctx), this.reads.getBookmarkById(bmId), this.reads.getUserBookmark(bmId, userId)])

    if (!user || !userBookmark) throw UserNotFoundError()
    if (bookmark && isPdfContentKey(bookmark.content_key) && !bookmark.content_md_key) throw PdfTextUnavailableError()
    if (!bookmark?.content_md_key) throw BookmarkNotFoundError()
    if (isProhibitedContentUrl(bookmark.target_url)) throw ProhibitedContentError()
    if (bookmark.moderation_result > 0) throw ProhibitedContentError()

    ctx.set('ai_lang', user.ai_lang)

    const textContent = await this.reads.getBookmarkContent(bookmark.content_md_key)
    if (!textContent) throw BookmarkContentNotFoundError()

    const writerBaseParams = {
      writer,
      encoder
    }

    try {
      let outline = ''
      const result = await this.aigc.generateOutline(ctx, textContent, async chunk => {
        if (chunk instanceof MultiLangError) {
          await this.writeProgress({ ...writerBaseParams, data: { done: true } })
        } else if (chunk.content) {
          outline = chunk.content || ''
          await this.writeProgress({ ...writerBaseParams, data: { outline: chunk.content || '' } })
        }
      })

      if (result.completed && outline.trim().length > 0) {
        await this.writeProgress({ ...writerBaseParams, data: { outline: outline || '' } })
        bmId > 0 && (await this.reads.saveSummary(ctx, bmId, result.model, outline, result.model))
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
      const tasks = await this.reads.getUserBookmarkBatchTasks(userId, bmId, 'tags_overview')
      await Promise.all(tasks.map(task => this.aigc.cancelBatchTask(task.batch_request_id).catch(() => {})))
    } catch (e) {
      console.log(`cancel batch tasks failed: ${e}`)
    }
  }
}
