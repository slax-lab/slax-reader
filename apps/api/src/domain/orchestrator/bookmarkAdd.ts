import { inject, injectable } from '../../decorators/di'
import { ContextManager } from '@/utils/context'
import { BookmarkService } from '../bookmark'
import { CrawlService } from '../crawl'
import { callbackType } from '../../infra/queue/queueClient'
import type { addBookmarkReq, addUrlBookmarkReq } from '@/domain/bookmark'
import { needsResolve } from '../../utils/platformDetector'
import { LabService } from '../lab'
import { BookmarkForkService } from '../bookmarkFork'
import type { BookmarkForkResponse } from '@slax-reader/contracts'
import { parseReaderBookmarkUrl } from '@/utils/readerBookmarkUrl'

export interface PreWorkflowResult {
  bookmarkId: number
  isShortcut: boolean
  forkResult?: BookmarkForkResponse
  workflowParams: {
    url: string
    bookmarkId: number
    userId: number
    inlineContent?: string
    writeVersion?: number
  } | null
}

@injectable()
export class BookmarkAddOrchestrator {
  constructor(
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(CrawlService) private crawlService: CrawlService,
    @inject(BookmarkForkService) private bookmarkForkService: BookmarkForkService
  ) {}

  public async addByUrl(
    ctx: ContextManager,
    req: addUrlBookmarkReq,
    opts: { callback?: callbackType; callbackPayload?: any; idempotencyKey?: string; rawTargetUrl?: string } = {}
  ): Promise<PreWorkflowResult> {
    const forkResult = await this.tryForkReaderUrl(ctx, opts.rawTargetUrl ?? req.target_url, opts.idempotencyKey)
    if (forkResult) return forkResult

    try {
      // Resolve acquisition links without changing the saved URL identity.
      const fetchUrl = await this.tryResolveShortLink(ctx, req.target_url)

      const res = await this.bookmarkService.addUrlBookmark(ctx, req, opts.callback ?? callbackType.NOT_CALLBACK, opts.callbackPayload ?? {})

      // shortcut 类型直接返回 bookmarkId
      if (typeof res === 'number') {
        return { bookmarkId: res, isShortcut: true, workflowParams: null }
      }

      // 普通类型：需要触发 workflow
      return {
        bookmarkId: res.info.bookmarkId,
        isShortcut: false,
        workflowParams: {
          url: fetchUrl ?? res.info.targetUrl,
          bookmarkId: res.info.bookmarkId,
          writeVersion: res.info.writeVersion,
          userId: res.info.userId
        }
      }
    } catch (e) {
      // Labs 拦截是预期行为，告警只留给故障
      if (LabService.isLabDisabledError(e)) throw e
      const errMsg = e instanceof Error ? e.message : String(e)
      ctx.execution.waitUntil(
        this.crawlService.pushBookmarkFailureAlert(ctx.getUserId(), 'pre_workflow.invalid_input', {
          source: 'add_url',
          url: req.target_url,
          user_id: ctx.getUserId(),
          error: errMsg
        })
      )
      throw e
    }
  }

  public async addByContent(ctx: ContextManager, req: addBookmarkReq, opts: { idempotencyKey?: string } = {}): Promise<PreWorkflowResult & { resource?: string }> {
    const forkResult = await this.tryForkReaderUrl(ctx, req.target_url, opts.idempotencyKey)
    if (forkResult) return forkResult

    try {
      const res = await this.bookmarkService.addBookmark(ctx, req)

      if (typeof res === 'number') {
        return { bookmarkId: res, isShortcut: true, workflowParams: null }
      }

      return {
        bookmarkId: res.info.bookmarkId,
        isShortcut: false,
        workflowParams: {
          url: res.info.targetUrl,
          bookmarkId: res.info.bookmarkId,
          writeVersion: res.info.writeVersion,
          userId: res.info.userId,
          inlineContent: res.info.resource && res.info.resource.length > 0 ? res.info.resource : undefined
        },
        resource: res.info.resource
      }
    } catch (e) {
      if (LabService.isLabDisabledError(e)) throw e
      const errMsg = e instanceof Error ? e.message : String(e)
      ctx.execution.waitUntil(
        this.crawlService.pushBookmarkFailureAlert(ctx.getUserId(), 'pre_workflow.invalid_input', {
          source: 'add',
          url: req.target_url,
          user_id: ctx.getUserId(),
          error: errMsg
        })
      )
      throw e
    }
  }

  public async kickoffWorkflow(
    ctx: ContextManager,
    params: { url: string; bookmarkId: number; userId: number; inlineContent?: string; writeVersion?: number },
    opts: { callbackChatId?: number; callbackOriginMessageId?: number; ignoreGenerateTag?: boolean } = {}
  ) {
    try {
      await this.crawlService.createWorkflow(
        ctx.env,
        {
          url: params.url,
          bookmarkId: params.bookmarkId,
          userId: params.userId,
          enUserId: ctx.getEncodeUserId(),
          userLang: ctx.getlang(),
          callbackChatId: opts.callbackChatId ?? 0,
          callbackOriginMessageId: opts.callbackOriginMessageId ?? 0,
          ignoreGenerateTag: opts.ignoreGenerateTag ?? false,
          writeVersion: params.writeVersion,
          inlineContent: params.inlineContent
        },
        3,
        ctx
      )
    } catch (e) {
      console.error(`kickoffWorkflow failed for bookmark ${params.bookmarkId}: ${e}`)
    }
  }

  private async tryForkReaderUrl(ctx: ContextManager, targetUrl: string, idempotencyKey?: string): Promise<PreWorkflowResult | null> {
    const readerUrl = parseReaderBookmarkUrl(targetUrl, ctx.env)
    if (!readerUrl) return null

    const forkResult = await this.bookmarkForkService.fork(ctx, { bookmark_uid: readerUrl.bookmarkUid }, idempotencyKey)
    return {
      bookmarkId: ctx.hashIds.decodeId(Number(forkResult.bookmark_id)),
      isShortcut: false,
      workflowParams: null,
      forkResult
    }
  }

  private async tryResolveShortLink(ctx: ContextManager, targetUrl: string): Promise<string | undefined> {
    if (!needsResolve(targetUrl)) return
    try {
      return (await this.crawlService.resolveFinalUrl(ctx, targetUrl)) || undefined
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      console.error(`resolveFinalUrl failed for ${targetUrl}, falling back to original: ${errMsg}`)
      ctx.execution.waitUntil(
        this.crawlService.pushBookmarkFailureAlert(ctx.getUserId(), 'pre_workflow.resolve_short_link_failed', {
          url: targetUrl,
          user_id: ctx.getUserId(),
          error: errMsg
        })
      )
    }
  }
}
