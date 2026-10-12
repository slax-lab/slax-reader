import { ContextManager } from '@/utils/context'
import { AigcService, completionQuote } from '@/domain/aigc'
import { NotSubscriptionError, ProhibitedContentError } from '@/const/err'
import { inject } from '@/decorators/di'
import { Controller } from '@/decorators/controller'
import { Post } from '@/decorators/route'
import { UserService } from '@/domain/user'
import { BookmarkService } from '@/domain/bookmark'
import { LogsService } from '@/domain/logs'
import { RequestUtils } from '@/utils/requestUtils'
import { ChatCompletionMessageParam } from 'openai/resources/index.mjs'
import { corsHeader } from '@/middleware/cors'
import { convertToGeminiContent } from '@/utils/conversation'

type SummaryRequest = {
  bm_id?: number
  bookmark_uid?: string
  share_code?: string
  cb_id?: number
  collection_code: string
  force: boolean
  raw_content?: string
}

type CompletionsRequest = {
  bm_id?: number
  bookmark_uid?: string
  share_code?: string
  cb_id?: number
  collection_code?: string
  title?: string
  raw_content?: string
  messages: ChatCompletionMessageParam[]
  quote?: completionQuote[]
  platform?: 'mobile' | 'desktop'
  model?: string
}

const ALLOWED_CHAT_MODELS = ['gemini-3-flash-preview', 'gemini-3.5-flash', 'gemini-3.1-flash-lite']
const DEFAULT_CHAT_MODEL = 'gemini-3-flash-preview'

@Controller('/v1/aigc')
export class AigcController {
  constructor(
    @inject(AigcService) private aigcService: AigcService,
    @inject(UserService) private userService: UserService,
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(LogsService) private logsSvc: LogsService
  ) {}

  @Post('/summaries')
  public async handleSummariesRequest(ctx: ContextManager, request: Request): Promise<Response> {
    const req = await RequestUtils.json<SummaryRequest>(request)

    const aiSvc = this.aigcService
    const { readable, writable } = new TransformStream({
      transform: (chunk, controller) => aiSvc.recordChunks(chunk, controller)
    })

    const user = await this.userService.getUserInfo(ctx)
    ctx.set('ai_lang', user.ai_lang || user.lang?.slice(0, 2) || 'en')
    ctx.set('country', request.cf?.country || '')
    ctx.set('continent', request.cf?.continent || '')

    if (!req.force && (req.bm_id || req.bookmark_uid)) {
      const summary = await this.bookmarkService.getUserBookmarkSummary(ctx, {
        bmId: req.bm_id,
        shareCode: req.share_code,
        cbId: req.cb_id,
        collectionCode: req.collection_code,
        bmUId: req.bookmark_uid
      })

      if (summary) {
        return new Response(summary.content, {
          headers: { 'Content-Type': 'text/event-stream; charset=utf-8', ...corsHeader }
        })
      }
    }

    const { title, content, bmId, moderationResult } = await this.bookmarkService.getBookmarkTitleContent(ctx, {
      bmId: req.bm_id,
      shareCode: req.share_code,
      cbId: req.cb_id,
      collectionCode: req.collection_code,
      title: 'no title',
      content: req.raw_content,
      bmUId: req.bookmark_uid
    })
    if (moderationResult > 0) throw ProhibitedContentError()
    ctx.execution.waitUntil(
      aiSvc.bookmarkSummary(ctx, content, writable, async result => {
        bmId > 0 && (await this.bookmarkService.saveSummary(ctx, bmId, result.provider, result.response, result.model))
      })
    )

    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', ...corsHeader }
    })
  }

  @Post('/chat')
  public async handleCompletionsRequest(ctx: ContextManager, request: Request): Promise<Response> {
    const sub = await this.userService.getUserSubscriptionInfo(ctx)
    if (!sub.subscription_end_at || sub.subscription_end_at < new Date()) throw NotSubscriptionError()

    const req = await RequestUtils.json<CompletionsRequest>(request)
    const userMsgCount = req.messages?.filter(m => m.role === 'user').length ?? 0
    if (userMsgCount > 1) {
      ctx.execution.waitUntil(this.logsSvc.track(ctx.getUserId(), 'ai_chat'))
    }

    const [user, { title, content, bmId, moderationResult }] = await Promise.all([
      this.userService.getUserInfo(ctx),
      this.bookmarkService.getBookmarkTitleContent(ctx, {
        bmId: req.bm_id,
        shareCode: req.share_code,
        cbId: req.cb_id,
        collectionCode: req.collection_code,
        title: req.title,
        content: req.raw_content,
        bmUId: req.bookmark_uid
      })
    ])

    if (moderationResult > 0) throw ProhibitedContentError()

    // 设置上下文
    ctx.set('req_url', request.url)
    ctx.set('req_auth', request.headers.get('Authorization') || '')
    ctx.set('country', request.cf?.country || '')
    ctx.set('continent', request.cf?.continent || '')
    ctx.set('ai_lang', user.ai_lang || user.lang?.slice(0, 2) || 'en')
    ctx.set('platform', req.platform === 'mobile' ? 'mobile' : 'desktop')
    ctx.set('chat_model', req.model && ALLOWED_CHAT_MODELS.includes(req.model) ? req.model : DEFAULT_CHAT_MODEL)
    ctx.set('bm_id', bmId)

    const aiSvc = this.aigcService
    const { readable, writable } = new TransformStream()
    ctx.execution.waitUntil(aiSvc.bookmarkChat(ctx, title, content, convertToGeminiContent(req.messages), writable, req.quote || []))

    return new Response(readable, {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8', ...corsHeader }
    })
  }
}
