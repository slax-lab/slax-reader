import { inject, injectable } from '../../decorators/di'
import { ContextManager } from '@/utils/context'
import { ImportService } from '../import'
import { BookmarkService, type addUrlBookmarkReq } from '../bookmark'
import { BookmarkForkService } from '../bookmarkFork'
import { parseReaderBookmarkUrl } from '@/utils/readerBookmarkUrl'
import { CrawlService } from '../crawl'
import type { LazyInstance } from '../../decorators/lazy'
import { KVClient } from '../../infra/repository/KVClient'
import { importBookmarkMessage } from '../../infra/queue/queueClient'
import { Hashid } from '@/utils/hashids'
import { isNewImportSource } from '@/utils/importFormats'
import { bookmarkEventProperties, EVENT_CONTEXT_KEY, submitServerEvent } from '../events'

type ImportSaveItem = addUrlBookmarkReq & { raw_target_url?: string; saveOperationKey?: string }

@injectable()
export class ImportOrchestrator {
  constructor(
    @inject(ImportService) private importService: ImportService,
    @inject(KVClient) private kvClient: LazyInstance<KVClient>,
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(CrawlService) private crawlService: CrawlService,
    @inject(BookmarkForkService) private bookmarkForkService: BookmarkForkService
  ) {}

  /**
   * 慢速导入 — fire ImportParseWorkflow per bookmark (browser-only)
   */
  public async processImportBookmarkSlow(ctx: ContextManager, message: { id: number; info: importBookmarkMessage }) {
    this.restoreEventContext(ctx, message.info)
    let skipParseCount = 0
    let dispatchedCount = 0
    let handledReaderCount = 0
    let readerSucceededCount = 0
    let readerFailedCount = 0
    let totalItems = message.info.data?.length || 1

    try {
      const bookmarkData = await this.importService.processImportBookmark(ctx, message)
      totalItems = bookmarkData.length
      console.log(`import bookmark slow: ${bookmarkData.length} items`)
      const readerItems: { item: ImportSaveItem; index: number; readerUid: string }[] = []
      const normalItems: ImportSaveItem[] = []
      bookmarkData.forEach((item: ImportSaveItem, index: number) => {
        const reader = parseReaderBookmarkUrl(item.raw_target_url ?? item.target_url, ctx.env)
        if (reader) readerItems.push({ item, index, readerUid: reader.bookmarkUid })
        else normalItems.push({ ...item, saveOperationKey: `import-save:${message.info.id}:${(Number.isSafeInteger(message.info.idx) ? message.info.idx : message.id) + index}` })
      })
      const readerOutcome = await this.processReaderForkImports(ctx, message, readerItems)
      handledReaderCount = readerItems.length
      readerSucceededCount = readerOutcome.succeeded
      readerFailedCount = readerOutcome.failed
      const batchMessage = normalItems.length ? await this.bookmarkService.batchAddUrlBookmark(ctx, normalItems) : []
      if (isNewImportSource(message.info.type)) skipParseCount = normalItems.length - batchMessage.filter(Boolean).length

      const hashids = new Hashid(ctx.env, ctx.getUserId())
      const enUserId = hashids.encodeId(ctx.getUserId())

      for (const item of batchMessage) {
        if (!item) continue
        await this.bookmarkService.createBookmarkImportRelation(
          ctx.getUserId(),
          item.bookmarkId,
          message.info.id,
          ...(item.writeVersion == null ? [] : [{ version: item.writeVersion, createdTarget: item.createdTarget === true }])
        )
        if (!item.saveReplayed) await this.trackImportedBookmark(ctx, item, message.info.type)

        if (item.skipParse) {
          if (
            await this.bookmarkService.updateBookmarkImportRelationStatus(
              ctx.getUserId(),
              item.bookmarkId,
              message.info.id,
              1,
              ...(item.writeVersion == null ? [] : [item.writeVersion])
            )
          )
            skipParseCount++
          continue
        }

        // Fire ImportParseWorkflow (browser-only) — don't await result
        try {
          await this.crawlService.createImportParseWorkflow(
            ctx.env,
            {
              url: item.targetUrl,
              bookmarkId: item.bookmarkId,
              writeVersion: item.writeVersion,
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
            if (
              await this.bookmarkService.updateBookmarkImportRelationStatus(
                ctx.getUserId(),
                item.bookmarkId,
                message.info.id,
                2,
                ...(item.writeVersion == null ? [] : [item.writeVersion])
              )
            ) {
              await this.importService.incrImportTask(ctx, ctx.getUserId(), message.info.id, 0, 1)
            }
          } catch (importErr) {
            console.error(`Failed to update import status for bookmark ${item.bookmarkId}: ${importErr}`)
          }
        }
      }
    } catch (err) {
      console.error(`import bookmark slow process failed: ${err}`)
      const undispatchedCount = totalItems - dispatchedCount - skipParseCount - handledReaderCount
      if (undispatchedCount > 0) {
        await this.importService
          .incrImportTask(ctx, ctx.getUserId(), message.info.id, 0, undispatchedCount)
          .catch(e => console.error(`Failed to mark undispatched items as failed: ${e}`))
      }
    }

    // skipParse 的立即计入进度；其余由 workflow 异步更新
    if (skipParseCount + readerSucceededCount > 0) {
      await this.importService.incrImportTask(ctx, ctx.getUserId(), message.info.id, skipParseCount + readerSucceededCount, 0)
    }
    if (readerFailedCount > 0) {
      await this.importService.incrImportTask(ctx, ctx.getUserId(), message.info.id, 0, readerFailedCount)
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
    let handledReaderCount = 0
    let readerSucceededCount = 0
    let readerFailedCount = 0
    let totalItems = message.info.data?.length || 1

    try {
      const bookmarkData = await this.importService.processImportBookmark(ctx, message)
      totalItems = bookmarkData.length
      console.log(`import bookmark fast: ${bookmarkData.length} items`)
      const readerItems: { item: ImportSaveItem; index: number; readerUid: string }[] = []
      const normalItems: ImportSaveItem[] = []
      bookmarkData.forEach((item: ImportSaveItem, index: number) => {
        const reader = parseReaderBookmarkUrl(item.raw_target_url ?? item.target_url, ctx.env)
        if (reader) readerItems.push({ item, index, readerUid: reader.bookmarkUid })
        else normalItems.push({ ...item, saveOperationKey: `import-save:${message.info.id}:${(Number.isSafeInteger(message.info.idx) ? message.info.idx : message.id) + index}` })
      })
      const readerOutcome = await this.processReaderForkImports(ctx, message, readerItems)
      handledReaderCount = readerItems.length
      readerSucceededCount = readerOutcome.succeeded
      readerFailedCount = readerOutcome.failed
      const batchMessage = normalItems.length ? await this.bookmarkService.batchAddUrlBookmark(ctx, normalItems) : []
      if (isNewImportSource(message.info.type)) skipParseCount = normalItems.length - batchMessage.filter(Boolean).length

      const hashids = new Hashid(ctx.env, ctx.getUserId())
      const enUserId = hashids.encodeId(ctx.getUserId())

      for (const item of batchMessage) {
        if (!item) continue
        await this.bookmarkService.createBookmarkImportRelation(
          ctx.getUserId(),
          item.bookmarkId,
          message.info.id,
          ...(item.writeVersion == null ? [] : [{ version: item.writeVersion, createdTarget: item.createdTarget === true }])
        )
        if (!item.saveReplayed) await this.trackImportedBookmark(ctx, item, message.info.type)

        if (item.skipParse) {
          if (
            await this.bookmarkService.updateBookmarkImportRelationStatus(
              ctx.getUserId(),
              item.bookmarkId,
              message.info.id,
              1,
              ...(item.writeVersion == null ? [] : [item.writeVersion])
            )
          )
            skipParseCount++
          continue
        }

        // Fire CrawlWorkflow with importTaskId — don't await parsing
        try {
          await this.crawlService.createWorkflow(
            ctx.env,
            {
              url: item.targetUrl,
              bookmarkId: item.bookmarkId,
              writeVersion: item.writeVersion,
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
            if (
              await this.bookmarkService.updateBookmarkImportRelationStatus(
                ctx.getUserId(),
                item.bookmarkId,
                message.info.id,
                2,
                ...(item.writeVersion == null ? [] : [item.writeVersion])
              )
            ) {
              await this.importService.incrImportTask(ctx, ctx.getUserId(), message.info.id, 0, 1)
            }
          } catch (importErr) {
            console.error(`Failed to update import status for bookmark ${item.bookmarkId}: ${importErr}`)
          }
        }
      }
    } catch (err) {
      console.error(`import bookmark fast process failed: ${err}`)
      const undispatchedCount = totalItems - dispatchedCount - skipParseCount - handledReaderCount
      if (undispatchedCount > 0) {
        await this.importService
          .incrImportTask(ctx, ctx.getUserId(), message.info.id, 0, undispatchedCount)
          .catch(e => console.error(`Failed to mark undispatched items as failed: ${e}`))
      }
    }

    // skipParse 的立即计入进度；其余由 workflow 异步更新
    if (skipParseCount + readerSucceededCount > 0) {
      await this.importService.incrImportTask(ctx, ctx.getUserId(), message.info.id, skipParseCount + readerSucceededCount, 0)
    }
    if (readerFailedCount > 0) {
      await this.importService.incrImportTask(ctx, ctx.getUserId(), message.info.id, 0, readerFailedCount)
    }

    console.log(`import bookmark fast: ${message.id} dispatched, skipParse: ${skipParseCount}`)
  }

  /** Canonical Reader imports complete through stored-object copying, without crawl dispatch. */
  private async processReaderForkImports(
    ctx: ContextManager,
    message: { id: number; info: importBookmarkMessage },
    items: { item: ImportSaveItem; index: number; readerUid: string }[]
  ): Promise<{ succeeded: number; failed: number }> {
    let succeeded = 0
    let failed = 0
    const baseIndex = Number.isSafeInteger(message.info.idx) ? message.info.idx : message.id
    for (const { item, index, readerUid } of items) {
      const operationKey = `import:${message.info.id}:${baseIndex + index}`
      try {
        const result = await this.bookmarkForkService.fork(ctx, { bookmark_uid: readerUid }, operationKey)
        const bookmarkId = ctx.hashIds.decodeId(result.bookmark_id)
        const first = await this.bookmarkService.applyForkImportMetadata(ctx, {
          bookmarkId,
          bookmarkUid: result.bookmark_uid,
          importId: message.info.id,
          operationKey,
          savedAt: item.saved_at ? new Date(item.saved_at) : undefined,
          isArchive: item.is_archive === true,
          isStarred: item.is_starred === true,
          tags: item.tags ?? []
        })
        if (first) {
          succeeded++
          await this.trackImportedBookmark(ctx, { bookmarkId, userId: ctx.getUserId() }, message.info.type)
        }
      } catch (error) {
        failed++
        console.error(`Reader Fork import failed for row ${baseIndex + index}:`, error)
      }
    }
    return { succeeded, failed }
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
