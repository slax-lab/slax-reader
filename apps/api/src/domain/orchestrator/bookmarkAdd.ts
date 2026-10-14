import { inject, injectable } from '../../decorators/di'
import { ContextManager } from '@/utils/context'
import { BookmarkService } from '../bookmark'
import { CrawlService } from '../crawl'
import { callbackType } from '../../infra/queue/queueClient'
import type { addBookmarkReq, addUrlBookmarkReq } from '@/domain/bookmark'
import { needsResolve } from '../../utils/platformDetector'
import { LabService } from '../lab'

export interface PreWorkflowResult {
  bookmarkId: number
  isShortcut: boolean
  workflowParams: {
    url: string
    bookmarkId: number
    userId: number
    inlineContent?: string
  } | null
}

@injectable()
export class BookmarkAddOrchestrator {
  constructor(
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(CrawlService) private crawlService: CrawlService
  ) {}

  public async addByUrl(ctx: ContextManager, req: addUrlBookmarkReq, opts: { callback?: callbackType; callbackPayload?: any } = {}): Promise<PreWorkflowResult> {
    try {
      // 解短链降级：失败时仍用原 URL，但同步告警
      await this.tryResolveShortLink(ctx, req)

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
          url: res.info.targetUrl,
          bookmarkId: res.info.bookmarkId,
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

  public async addByContent(ctx: ContextManager, req: addBookmarkReq): Promise<PreWorkflowResult & { resource?: string }> {
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
    params: { url: string; bookmarkId: number; userId: number; inlineContent?: string },
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
          inlineContent: params.inlineContent
        },
        3,
        ctx
      )
    } catch (e) {
      console.error(`kickoffWorkflow failed for bookmark ${params.bookmarkId}: ${e}`)
    }
  }

  private async tryResolveShortLink(ctx: ContextManager, req: addUrlBookmarkReq) {
    if (!needsResolve(req.target_url)) return
    try {
      const url = await this.crawlService.resolveFinalUrl(ctx, req.target_url)
      if (url) req.target_url = url
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e)
      console.error(`resolveFinalUrl failed for ${req.target_url}, falling back to original: ${errMsg}`)
      ctx.execution.waitUntil(
        this.crawlService.pushBookmarkFailureAlert(ctx.getUserId(), 'pre_workflow.resolve_short_link_failed', {
          url: req.target_url,
          user_id: ctx.getUserId(),
          error: errMsg
        })
      )
    }
  }
}
