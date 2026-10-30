import { ContextManager } from '@/utils/context'
import { Successed, Failed } from '../../utils/responseUtils'
import { ErrorConnectionParam, ErrorParam, UnauthorizedError } from '../../const/err'
import { parseFeedbackRequest } from '@/utils/feedbackRequest'
import { RequestUtils } from '../../utils/requestUtils'
import { noticeType } from '../../infra/repository/dbUser'
import { Controller } from '../../decorators/controller'
import { Get, Post } from '../../decorators/route'
import { inject } from '../../decorators/di'
import { BookmarkService } from '../../domain/bookmark'
import { NotificationService } from '../../domain/notification'
import { reportInfoReq, reportPlatform, reportEntryPoint, UserService } from '../../domain/user'
import { BookmarkOrchestrator } from '../../domain/orchestrator/bookmark'
import { QueueClient } from '../../infra/queue/queueClient'
import { UserDeletionService } from '../../domain/userDeletion'
import { LabService } from '../../domain/lab'
import { NewsletterService } from '@/domain/newsletter'
import { configuredNewsletterDomain, NEWSLETTER_LOCAL_PREFIX, NewsletterError } from '@/utils/newsletter'
import { isNewsletterAccount, type NewsletterEnableSettingRequest } from '@slax-reader/contracts'

@Controller('/v1/user')
export class UserController {
  private bookmarkOrchestrator: BookmarkOrchestrator

  constructor(
    @inject(UserService) private userService: UserService,
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(NotificationService) private notificationService: NotificationService,
    @inject(BookmarkOrchestrator) private bmOrch: BookmarkOrchestrator,
    @inject(QueueClient) private queueClient: QueueClient,
    @inject(UserDeletionService) private userDeletionService: UserDeletionService,
    @inject(LabService) private labService: LabService,
    @inject(NewsletterService) private newsletter: NewsletterService
  ) {
    this.bookmarkOrchestrator = bmOrch
  }

  /**
   * 用户登录
   */
  @Post('/login')
  public async handleUserLoginRequest(ctx: ContextManager, request: Request) {
    const loginRes = await this.userService.userLogin(ctx, request)
    return Successed(loginRes)
  }

  /**
   * 用户详情
   */
  @Get('/me')
  public async handleUserDetailRequest(ctx: ContextManager, request: Request) {
    const res = await this.userService.userDetail(ctx)
    return Successed(res)
  }

  /**
   * 刷新token
   * 当修改语言、邮箱、重新登录时请求即可
   */
  @Post('/refresh')
  public async handleRefreshTokenRequest(ctx: ContextManager, request: Request) {
    const res = await this.userService.refreshToken(ctx)
    this.userService.bindRequestDevice(ctx, request, ctx.getUserId(), 'login')
    return Successed({ token: res })
  }

  /**
   * 绑定站外体系
   */
  @Post('/bind_link')
  public async handleUserBindLinkRequest(ctx: ContextManager, request: Request) {
    let req = await request.json<{ platform: string }>()
    if (!req) return Failed(ErrorParam())

    if (req.platform !== 'telegram' && req.platform !== 'twitter') {
      return Failed(ErrorParam())
    }

    const bindLink = await this.userService.getBindLink(ctx, req.platform)
    return Successed(bindLink)
  }

  /**
   * 反馈
   */
  @Post('/report')
  public async handleUserReportRequest(ctx: ContextManager, request: Request) {
    if (ctx.getUserId() < 1) throw UnauthorizedError()
    const { report, diagnostic } = await parseFeedbackRequest(request)
    const req = report as Omit<reportInfoReq, 'user_id'>
    const invalidPlatform = !req.platform || ![reportPlatform.APP, reportPlatform.EXTENSION, reportPlatform.WEB].includes(req.platform)
    const invalidEntryPoint =
      !req.entry_point ||
      ![reportEntryPoint.INBOX, reportEntryPoint.BOOKMARK_DETAIL, reportEntryPoint.SHARE, reportEntryPoint.COLLECTION, reportEntryPoint.ORIGINAL_WEBSITE].includes(req.entry_point)

    if (invalidPlatform || invalidEntryPoint) return Failed(ErrorParam())
    const { bookmark_id, share_code, cb_id, collection_code, bookmark_uuid } = req
    let bmId = 0
    if (req.entry_point !== reportEntryPoint.INBOX) {
      if (!bookmark_id && !share_code && !(cb_id && collection_code) && !bookmark_uuid) return Failed(ErrorParam())
      bmId = await this.bookmarkService.getBookmarkId(ctx, { bmId: bookmark_id, shareCode: share_code, cbId: cb_id, collectionCode: collection_code, uBmId: bookmark_uuid })
      if (!bmId || bmId < 1) return Failed(ErrorParam())
    }
    await this.userService.saveReport(
      ctx,
      {
        content: req.content,
        type: req.type,
        platform: req.platform,
        entry_point: req.entry_point,
        environment: req.environment,
        version: req.version,
        target_url: req.target_url,
        allow_follow_up: req.allow_follow_up,
        bookmark_id: bmId,
        user_id: ctx.getUserId(),
        ip_address: request.headers.get('cf-connecting-ip') || ''
      },
      diagnostic
    )
    return Successed('ok')
  }

  /**
   * 设置用户偏好
   */
  @Post('/setting')
  public async handleUserSettingRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<{ key: string; value: string }>(request)
    if (!req || typeof req.key !== 'string' || typeof req.value !== 'string') return Failed(ErrorParam())

    await this.userService.saveUserSetting(ctx, req)
    return Successed('ok')
  }

  /**
   * 启用用户偏好
   */
  @Post('/setting/enable')
  public async handleEnableUserSettingRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<{ key: string } & Pick<NewsletterEnableSettingRequest, 'newsletter_address'>>(request)
    if (!req || typeof req.key !== 'string') return Failed(ErrorParam())

    try {
      if (req.key === 'lab:newsletter' && req.newsletter_address !== undefined) {
        const domain = configuredNewsletterDomain(ctx.env)
        if (!domain) throw new NewsletterError('unavailable', 503)
        const address = req.newsletter_address
        if (
          typeof address !== 'string' ||
          !address.startsWith(NEWSLETTER_LOCAL_PREFIX) ||
          !address.endsWith('@' + domain) ||
          !isNewsletterAccount(address.slice(NEWSLETTER_LOCAL_PREFIX.length, -(domain.length + 1)))
        ) {
          throw new NewsletterError('invalid_account')
        }
      }
      const res = await this.userService.enableUserSetting(ctx, req.key, true)
      if (req.key === 'lab:newsletter' && req.newsletter_address !== undefined) {
        await this.newsletter.address(ctx, true, req.newsletter_address)
      }
      return Successed(res)
    } catch (error) {
      if (!(error instanceof NewsletterError)) throw error
      return Failed({ error: error.code }, error.status, error.code)
    }
  }

  @Get('/newsletter_address')
  public async newsletterAddress(ctx: ContextManager, _request: Request) {
    let response: Response
    try {
      response = Successed(await this.newsletter.address(ctx, false))
    } catch (error) {
      if (!(error instanceof NewsletterError)) throw error
      response = Failed({ error: error.code }, error.status, error.code)
    }
    response.headers.set('Cache-Control', 'private, no-store')
    return response
  }

  /**
   * 禁用用户偏好
   */
  @Post('/setting/disable')
  public async handleDisableUserSettingRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<{ key: string }>(request)
    if (!req) return Failed(ErrorParam())

    const res = await this.userService.enableUserSetting(ctx, req.key, false)
    return Successed(res)
  }

  /**
   * 实验室功能列表（含当前用户的开关状态）
   */
  @Get('/labs')
  public async handleUserLabsRequest(ctx: ContextManager, request: Request) {
    const features = await this.labService.listForUser(ctx.getUserId())
    return Successed({ features })
  }

  /**
   * 获取用户信息
   */
  @Get('/userinfo')
  public async handleUserInfoRequest(ctx: ContextManager, request: Request) {
    await this.userDeletionService.ensureUserNotDeleted(ctx.getUserId())

    const res = await this.userService.getUserInfo(ctx)
    return Successed(res)
  }

  /**
   * 订阅推送api
   */
  @Post('/subscribe/pushapi')
  public async handleUserSubscribePushApiRequest(ctx: ContextManager, request: Request) {
    await this.userDeletionService.ensureUserNotDeleted(ctx.getUserId())

    const req = await RequestUtils.json<{ endpoint: string; keys: { p256dh: string; auth: string } }>(request)
    if (!req) return Failed(ErrorParam())

    await this.notificationService.addUserNoticeDevice(ctx.getUserId(), noticeType.BROWSER, JSON.stringify({ endpoint: req.endpoint, keys: req.keys }))
    return Successed('ok')
  }

  /**
   * 连接通知服务
   */
  @Get('/messages')
  public async handleUserMessagesRequest(ctx: ContextManager, request: Request) {
    const upgradeHeader = request.headers.get('Upgrade')
    if (!upgradeHeader || upgradeHeader !== 'websocket') return Failed(ErrorConnectionParam())
    const query = await RequestUtils.query<{ token: string }>(request)
    if (!query.token) return Failed(ErrorConnectionParam())

    return await this.notificationService.connectNotification(ctx, request, query.token)
  }

  /**
   * 获取未读消息数量，供服务降级使用
   */
  @Get('/unread_count')
  public async handleUserUnreadCountRequest(ctx: ContextManager, request: Request) {
    await this.userDeletionService.ensureUserNotDeleted(ctx.getUserId())

    const res = await this.notificationService.getUserUnreadCount(ctx.getUserId())
    return Successed({ unread_count: res })
  }

  /**
   * 获取通知列表
   */
  @Get('/notifications')
  public async handleUserNotificationListRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.query<{ page: number; page_size: number }>(request)
    if (!req) return Failed(ErrorParam())

    req.page = parseInt(req.page.toString())
    req.page_size = parseInt(req.page_size.toString())
    if (isNaN(req.page) || req.page < 1) req.page = 1
    if (isNaN(req.page_size) || req.page_size < 1) req.page_size = 10

    const messages = await this.notificationService.getUserNoticeList(ctx, req.page, req.page_size)

    return Successed(messages)
  }

  @Post('/read_notifications')
  public async handleUserReadAllNotificationRequest(ctx: ContextManager, request: Request) {
    const res = await this.notificationService.updateUserReadAt(ctx)
    return Successed('ok')
  }

  @Post('/read_notification')
  public async handleUserReadNotificationRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<{ id: number }>(request)
    if (!req) return Failed(ErrorParam())

    req.id = ctx.hashIds.decodeId(req.id)
    if (isNaN(req.id) || req.id < 1) return Failed(ErrorParam())

    const res = await this.notificationService.updateUserNotificationRead(ctx, req.id)
    return Successed('ok')
  }

  @Get('/setting/tabs_config')
  public async handleUserInboxTabsConfigRequest(ctx: ContextManager, request: Request) {
    const res = await this.bookmarkOrchestrator.getHighlightAndCollectionExist(ctx)
    return Successed({
      highlight: res.highlight,
      collection: res.collection
    })
  }

  @Get('/share_settings')
  public async handleGetShareSettingsRequest(ctx: ContextManager, request: Request) {
    const user = await this.userService.getUserInfo(ctx)
    const shareEnabled = await this.userService.getShareEnabled(ctx.getUserId())
    return Successed({ snapshot_sharing: shareEnabled })
  }

  @Post('/share_settings')
  public async handleUpdateShareSettingsRequest(ctx: ContextManager, request: Request) {
    const req = await RequestUtils.json<{ snapshot_sharing: boolean }>(request)
    if (!req || typeof req.snapshot_sharing !== 'boolean') return Failed(ErrorParam())

    await this.userService.updateShareEnabled(ctx, req.snapshot_sharing)
    return Successed('ok')
  }

  @Post('/delete_my_account')
  public async handleDeleteUserAccountRequest(ctx: ContextManager, request: Request) {
    const userId = ctx.getUserId()

    // 检查是否满足删除条件
    const check = await this.userService.checkDeleteAccountConstraints(userId)
    if (!check.canDelete) {
      return Successed(check)
    }

    await this.userService.markUserAsDeleted(userId)

    const server = ctx.env.WEBSOCKET_SERVER.get(ctx.env.WEBSOCKET_SERVER.idFromName('global'))
    await Promise.all([server.revokeUser(userId), ctx.env.USER_DELETION_QUEUE.send({ userId })])

    return Successed(check)
  }
}
