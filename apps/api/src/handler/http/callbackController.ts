import { ContextManager } from '@/utils/context'
import { TelegramBotService } from '../../domain/telegram'
import { Controller } from '../../decorators/controller'
import { All, Post } from '../../decorators/route'
import { inject } from '../../decorators/di'
import { Context, webhookCallback } from 'grammy'
import { BookmarkService } from '../../domain/bookmark'
import { callbackType } from '../../infra/queue/queueClient'
import { Hashid } from '@/utils/hashids'
import { SubscriptionService } from '../../domain/subscription'
import { SubscriptionOrchestrator } from '../../domain/orchestrator/subscription'
import { Successed, Failed } from '../../utils/responseUtils'
import { RequestUtils } from '@/utils/requestUtils'
import { ErrorParam } from '@/const/err'
import { SubscriptionAppleService } from '@/domain/subscriptionApple'
import { CrawlService } from '@/domain/crawl'
import { Get } from '@/decorators/route'
import { UserService } from '@/domain/user'
import { GA4AnalyticsClient } from '@/infra/external/ga4Analytics'
import { LogsService } from '@/domain/logs'
import { LabService } from '@/domain/lab'
import { i18n } from '@/const/i18n'
import { MultiLangError } from '@/utils/multiLangError'

@Controller('/callback')
export class CallbackController {
  constructor(
    @inject(TelegramBotService) private telegramBotService: TelegramBotService,
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(SubscriptionService) private subscriptionService: SubscriptionService,
    @inject(SubscriptionAppleService) private appleSubscription: SubscriptionAppleService,
    @inject(SubscriptionOrchestrator) private subscriptionOrchestrator: SubscriptionOrchestrator,
    @inject(CrawlService) private crawlService: CrawlService,
    @inject(UserService) private userService: UserService,
    @inject(GA4AnalyticsClient) private ga4Client: GA4AnalyticsClient,
    @inject(LogsService) private logsService: LogsService
  ) {}

  /**
   * 处理Telegram回调
   */
  @Post('/telegram')
  public async handlerTelegramCallback(ctxManager: ContextManager, req: Request) {
    const secret = ctxManager.env.TELEGRAM_WEBHOOK_SECRET
    if (req.method !== 'POST') return new Response(null, { status: 405 })
    if (!secret || req.headers.get('X-Telegram-Bot-Api-Secret-Token') !== secret) return new Response(null, { status: 401 })
    const tgSvc = this.telegramBotService
    const bot = await tgSvc.initTelegramBot(ctxManager.env)

    // 处理内容消息
    const handleMessageText = async (ctx: Context) => {
      // 判断内容是否为URL、是否绑定Telegram
      const res = await tgSvc.replyText(ctx)
      if (!res) return
      // 处理CTX并异步添加标签
      const hashIds = new Hashid(ctxManager.env, res.userId)
      const enUserId = hashIds.encodeId(res.userId)
      ctxManager.setHashIds(hashIds)
      // Telegram has no JWT; take the language from the sender so error copy matches
      const lang = (ctx.from?.language_code ?? '').slice(0, 2)
      ctxManager.setUserInfo(res.userId, enUserId, '', lang)
      let addRes: Awaited<ReturnType<BookmarkService['addUrlBookmark']>>
      try {
        addRes = await this.bookmarkService.addUrlBookmark(ctxManager, { target_url: res.url, tags: [] }, callbackType.CALLBACK_TELEGRAM, {
          chat_id: res.chatId,
          origin_message_id: res.msgId
        })
      } catch (e) {
        const t = i18n(lang)
        if (LabService.isLabDisabledError(e)) {
          ctxManager.execution.waitUntil(this.logsService.track(res.userId, 'bookmark_add', { channel: 'telegram', status: 'lab_disabled' }))
          await ctx.reply(t.telegramLabFeatureDisabled({ message: (e as MultiLangError).getMessage, base_front_end_url: ctxManager.env.FRONT_END_URL }), { parse_mode: 'HTML' })
          return
        }
        ctxManager.execution.waitUntil(this.logsService.track(res.userId, 'bookmark_add', { channel: 'telegram', status: 'failed' }))
        await ctx.reply(t.telegramBookmarkError({}))
        return
      }
      // 处理回执
      if (typeof addRes === 'number') {
        ctxManager.execution.waitUntil(this.logsService.track(res.userId, 'bookmark_add', { channel: 'telegram', bookmark_id: addRes, status: 'success' }))
        await tgSvc.sendProcessSuccess(ctx, addRes, {
          chat_id: res.chatId,
          origin_message_id: res.msgId
        })
      } else if (typeof addRes === 'object') {
        ctxManager.execution.waitUntil(this.logsService.track(res.userId, 'bookmark_add', { channel: 'telegram', status: 'success' }))
        ctxManager.execution.waitUntil(
          this.ga4Client.trackEvent(res.userId, 'bookmark_add_start', {
            channel: 'telegram',
            method: 'manual_paste'
          })
        )
        await this.crawlService.createWorkflow(ctxManager.env, {
          url: res.url,
          bookmarkId: addRes.info.bookmarkId,
          userId: res.userId,
          enUserId: ctxManager.getEncodeUserId(),
          userLang: ctxManager.getlang(),
          callbackChatId: res.chatId,
          callbackOriginMessageId: res.msgId,
          ignoreGenerateTag: false
        })
      }
    }

    // 处理回调
    const handleCallbackQuery = async (ctx: Context) => {
      await tgSvc.handlePaginationCallback(ctx)
    }

    bot.use(tgSvc.checkFromId.bind(tgSvc))
    bot.command('start', tgSvc.commandStart.bind(tgSvc))
    bot.command('help', tgSvc.commandHelp.bind(tgSvc))
    bot.command('me', tgSvc.commandMe.bind(tgSvc))
    bot.command('list', tgSvc.commandList.bind(tgSvc))
    bot.command('topics', tgSvc.commandTopics.bind(tgSvc))
    bot.reaction('🔥', tgSvc.replyReaction.bind(tgSvc))
    bot.on('message_reaction', tgSvc.replyReaction.bind(tgSvc))
    bot.on('message:text', handleMessageText)
    bot.on('message', tgSvc.notSupportType.bind(tgSvc))
    bot.on('callback_query:data', handleCallbackQuery)

    return await webhookCallback(bot, 'cloudflare-mod', { secretToken: secret })(req)
  }

  /**
   * 处理Stripe回调
   */
  @All('/stripe')
  public async handlerStripeCallback(ctx: ContextManager, req: Request) {
    const body = await req.text()
    await this.subscriptionService.decryptCallbackEvent(ctx, body, req.headers.get('stripe-signature') || '')
    return Successed('ok')
  }

  @All('/apple_notifications')
  public async handlerAppleNotificationsCallback(ctx: ContextManager, req: Request) {
    const body = await RequestUtils.json<{ signedPayload: string }>(req)
    if (!body || !body.signedPayload) return Failed(ErrorParam())

    await this.appleSubscription.handleAppleIAPNotificationEvent(ctx, body.signedPayload)

    return Successed('ok')
  }

  @Get('/twitter')
  public async handlerTwitterCallback(ctxManager: ContextManager, req: Request) {
    const query = await RequestUtils.query<{ state: string; code: string }>(req)
    if (!query || !query.state || !query.code) {
      return Response.redirect(ctxManager.env.X_CLIENT_CALLBACK_URL + '?error_alert=missing_params')
    }

    try {
      await this.userService.handleOAuth2Bind(ctxManager, 'twitter', query.state, query.code)
      return Response.redirect(ctxManager.env.X_CLIENT_CALLBACK_URL)
    } catch (error: any) {
      const errorParam = this.mapOAuthErrorToParam(error)
      return Response.redirect(ctxManager.env.X_CLIENT_CALLBACK_URL + `?error_alert=${errorParam}`)
    }
  }

  private mapOAuthErrorToParam(error: any): string {
    const errorName = error?.name
    switch (errorName) {
      case 'OAUTH2_STATE_EXPIRED':
        return 'state_expired'
      case 'OAUTH2_TOKEN_EXCHANGE_ERROR':
        return 'token_exchange_failed'
      case 'OAUTH2_USER_INFO_ERROR':
        return 'get_user_info_failed'
      case 'PLATFORM_ACCOUNT_BOUND_TO_OTHER_USER':
        return 'account_already_bound'
      default:
        console.error('[OAuth Error]', error)
        return 'unknown_error'
    }
  }
}
