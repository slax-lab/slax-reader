import { inject, injectable } from '../../decorators/di'
import { ContextManager } from '@/utils/context'
import { ImportService } from '../import'
import { BookmarkService } from '../bookmark'
import { CrawlService } from '../crawl'
import type { LazyInstance } from '../../decorators/lazy'
import { KVClient } from '../../infra/repository/KVClient'
import { importBookmarkMessage } from '../../infra/queue/queueClient'
import { Hashid } from '@/utils/hashids'
import { isNewImportSource } from '@/utils/importFormats'
import { bookmarkEventProperties, EVENT_CONTEXT_KEY, submitServerEvent } from '../events'

@injectable()
export class ImportOrchestrator {
  constructor(
    @inject(ImportService) private importService: ImportService,
    @inject(KVClient) private kvClient: LazyInstance<KVClient>,
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(CrawlService) private crawlService: CrawlService
  ) {}

  /**
   * 慢速导入 — fire ImportParseWorkflow per bookmark (browser-only)
   */
  public async processImportBookmarkSlow(ctx: ContextManager, message: { id: number; info: importBookmarkMessage }) {
    this.restoreEventContext(ctx, message.info)
    let skipParseCount = 0
    let dispatchedCount = 0
    let totalItems = message.info.data?.length || 1

    try {
      const bookmarkData = await this.importService.processImportBookmark(ctx, message)
      totalItems = bookmarkData.length
      console.log(`import bookmark slow: ${bookmarkData.length} items`)
      const batchMessage = await this.bookmarkService.batchAddUrlBookmark(ctx, bookmarkData)
      if (isNewImportSource(message.info.type)) skipParseCount = totalItems - batchMessage.filter(Boolean).length

      const hashids = new Hashid(ctx.env, ctx.getUserId())
      const enUserId = hashids.encodeId(ctx.getUserId())

      for (const item of batchMessage) {
        if (!item) continue
        await this.bookmarkService.createBookmarkImportRelation(ctx.getUserId(), item.bookmarkId, message.info.id)
        await this.trackImportedBookmark(ctx, item, message.info.type)

        if (item.skipParse) {
          skipParseCount++
          await this.bookmarkService.updateBookmarkImportRelationStatus(ctx.getUserId(), item.bookmarkId, message.info.id, 1)
          continue
        }

        // Fire ImportParseWorkflow (browser-only) — don't await result
        try {
          await this.crawlService.createImportParseWorkflow(
            ctx.env,
            {
              url: item.targetUrl,
              bookmarkId: item.bookmarkId,
              userId: item.userId,
              enUserId,
              userLang: ctx.getlang() || 'en',
              importTaskId: message.info.id,
              ignoreGenerateTag: item.ignoreGenerateTag
            },
            3,
            ctx
          )
          dispatchedCount++
        } catch (err) {
          dispatchedCount++
          console.error(`Failed to create import parse workflow for bookmark ${item.bookmarkId}: ${err}`)
          // createImportParseWorkflow 已经 handle 了 FAILED 状态和 alert
          // 但需要更新 import relation
          try {
            await this.bookmarkService.updateBookmarkImportRelationStatus(ctx.getUserId(), item.bookmarkId, message.info.id, 2)
            await this.importService.incrImportTask(ctx, ctx.getUserId(), message.info.id, 0, 1)
          } catch (importErr) {
            console.error(`Failed to update import status for bookmark ${item.bookmarkId}: ${importErr}`)
          }
        }
      }
    } catch (err) {
      console.error(`import bookmark slow process failed: ${err}`)
      const undispatchedCount = totalItems - dispatchedCount - skipParseCount
      if (undispatchedCount > 0) {
        await this.importService
          .incrImportTask(ctx, ctx.getUserId(), message.info.id, 0, undispatchedCount)
          .catch(e => console.error(`Failed to mark undispatched items as failed: ${e}`))
      }
    }

    // skipParse 的立即计入进度；其余由 workflow 异步更新
    if (skipParseCount > 0) {
      await this.importService.incrImportTask(ctx, ctx.getUserId(), message.info.id, skipParseCount, 0)
    }

    console.log(`import bookmark slow: ${message.id} dispatched, skipParse: ${skipParseCount}`)
  }

  /**
   * 快速导入 — fire CrawlWorkflow per bookmark (full parsing pipeline)
   */
  public async processImportBookmark(ctx: ContextManager, message: { id: number; info: importBookmarkMessage }) {
    this.restoreEventContext(ctx, message.info)
    ctx.set('is_retry_task', message.info.type === 'fetch_retry')
    ctx.set('is_import_task', true)

    let skipParseCount = 0
    let dispatchedCount = 0
    let totalItems = message.info.data?.length || 1

    try {
      const bookmarkData = await this.importService.processImportBookmark(ctx, message)
      totalItems = bookmarkData.length
      console.log(`import bookmark fast: ${bookmarkData.length} items`)
      const batchMessage = await this.bookmarkService.batchAddUrlBookmark(ctx, bookmarkData)
      if (isNewImportSource(message.info.type)) skipParseCount = totalItems - batchMessage.filter(Boolean).length

      const hashids = new Hashid(ctx.env, ctx.getUserId())
      const enUserId = hashids.encodeId(ctx.getUserId())

      for (const item of batchMessage) {
        if (!item) continue
        await this.bookmarkService.createBookmarkImportRelation(ctx.getUserId(), item.bookmarkId, message.info.id)
        await this.trackImportedBookmark(ctx, item, message.info.type)

        if (item.skipParse) {
          skipParseCount++
          await this.bookmarkService.updateBookmarkImportRelationStatus(ctx.getUserId(), item.bookmarkId, message.info.id, 1)
          continue
        }

        // Fire CrawlWorkflow with importTaskId — don't await parsing
        try {
          await this.crawlService.createWorkflow(
            ctx.env,
            {
              url: item.targetUrl,
              bookmarkId: item.bookmarkId,
              userId: item.userId,
              enUserId,
              userLang: ctx.getlang() || 'en',
              ignoreGenerateTag: item.ignoreGenerateTag,
              importTaskId: message.info.id
            },
            3,
            ctx
          )
          dispatchedCount++
        } catch (err) {
          dispatchedCount++
          console.error(`Failed to create crawl workflow for import bookmark ${item.bookmarkId}: ${err}`)
          // createWorkflow 已经 handle 了 FAILED 状态和 alert
          // 但需要更新 import relation
          try {
            await this.bookmarkService.updateBookmarkImportRelationStatus(ctx.getUserId(), item.bookmarkId, message.info.id, 2)
            await this.importService.incrImportTask(ctx, ctx.getUserId(), message.info.id, 0, 1)
          } catch (importErr) {
            console.error(`Failed to update import status for bookmark ${item.bookmarkId}: ${importErr}`)
          }
        }
      }
    } catch (err) {
      console.error(`import bookmark fast process failed: ${err}`)
      const undispatchedCount = totalItems - dispatchedCount - skipParseCount
      if (undispatchedCount > 0) {
        await this.importService
          .incrImportTask(ctx, ctx.getUserId(), message.info.id, 0, undispatchedCount)
          .catch(e => console.error(`Failed to mark undispatched items as failed: ${e}`))
      }
    }

    // skipParse 的立即计入进度；其余由 workflow 异步更新
    if (skipParseCount > 0) {
      await this.importService.incrImportTask(ctx, ctx.getUserId(), message.info.id, skipParseCount, 0)
    }

    console.log(`import bookmark fast: ${message.id} dispatched, skipParse: ${skipParseCount}`)
  }

  private restoreEventContext(ctx: ContextManager, info: importBookmarkMessage) {
    if (!info.eventContext) return
    const context = info.eventContext
    ctx.set(EVENT_CONTEXT_KEY, { ...context, source: info.type === 'fetch_retry' ? context.source : 'import' })
  }

  private async trackImportedBookmark(ctx: ContextManager, item: { bookmarkId: number; userId: number }, type: string) {
    if (type === 'fetch_retry' || !ctx.get(EVENT_CONTEXT_KEY)) return
    try {
      const relation = await this.bookmarkService.getUserBookmarkWithDetail(item.userId, item.bookmarkId)
      if (relation?.bookmark) submitServerEvent(ctx, undefined, 'bookmark_saved', bookmarkEventProperties(relation, 'import'), { userId: item.userId })
    } catch (error) {
      console.error('[events] failed to load imported bookmark:', error)
    }
  }
}
