import {
  SaveReportError,
  UnauthorizedError,
  UserAccountDeletedError,
  PlatformAlreadyBoundError,
  OAuth2StateExpiredError,
  OAuth2TokenExchangeError,
  OAuth2UserInfoError,
  PlatformAccountBoundToOtherUserError,
  ErrorParam,
  NeedCreateUsernameError,
  RegisterUserError,
  UserNotFoundError
} from '@/const/err'
import { userInfoPO, platformBindType, UserRepo } from '@/infra/repository/dbUser'
import { reportType, ReportRepo } from '@/infra/repository/dbReport'
import { SlaxAlertBotClient } from '@/infra/external/slaxAlertBot'
import { subscriptionPO, SubscriptionRepo } from '@/infra/repository/dbSubscription'
import { inject, injectable } from '@/decorators/di'
import type { LazyInstance } from '@/decorators/lazy'
import { BucketClient } from '@/infra/repository/bucketClient'
import { RedisClient } from '@/infra/repository/redisClient'
import { CollectionRepo } from '@/infra/repository/dbCollection'
import { i18n } from '@/const/i18n'
import { ContextManager } from '@/utils/context'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { TwitterOAuth2 } from '@/utils/auth/authTwitter'
import { GA4AnalyticsClient } from '@/infra/external/ga4Analytics'
import { LogsService } from '@/domain/logs'
import { submitServerEvent } from '@/domain/events'
import { Hashid } from '@/utils/hashids'
import { parseClientSource } from '@/utils/clientPlatform'
import { LabService } from '@/domain/lab'
import { resolveDeviceId } from '@/utils/eventContext'
import { Auth } from '@/utils/jwt'
import { RequestUtils } from '@/utils/requestUtils'
import { SlaxAuth } from '@/utils/auth'
import { hashMD5, hashSHA256 } from '@/utils/strings'

export interface userBindPlatformItem {
  platform: string
  user_name: string
  created_at: Date
}

export enum reportPlatform {
  WEB = 'web',
  APP = 'app',
  EXTENSION = 'extension'
}

export enum reportEntryPoint {
  INBOX = 'inbox',
  BOOKMARK_DETAIL = 'bookmark_detail',
  SHARE = 'share',
  COLLECTION = 'collection',
  ORIGINAL_WEBSITE = 'original_website'
}

export interface reportInfoReq {
  user_id: number
  content: string
  type: reportType
  platform: reportPlatform
  entry_point: reportEntryPoint
  bookmark_id?: number
  share_code?: string
  cb_id?: number
  collection_code?: string
  bookmark_uuid?: string
  environment?: string
  version?: string
  target_url?: string
  allow_follow_up?: boolean
}

export type saveReportReq = Omit<reportInfoReq, 'share_code' | 'cb_id' | 'collection_code'> & {
  ip_address?: string
}

export interface userInfoResp {
  userId: number
  email: string
  lang: string
  name: string
  picture: string
  timezone: string
  subscription_type: SubscriptionType
  subscription_end_at: Date
}

interface subscription {
  first_subscription_at?: Date
  subscription_end_at?: Date
  next_invoice_at?: Date
  subscription_homepage?: string
  subscription_type: SubscriptionType
  subscription_credit?: number
  stripe_stripe_currency?: string
}

export interface userInfo {
  account: string
  email: string
  lang: string
  ai_lang: string
  timezone: string
  avatar: string
  name: string
  id: number
  platform: userBindPlatformItem[]
  subscription: subscription
  aff_code?: string
  share_collect: userShareCollectInfo
  uuid: string
}

export interface userShareCollectInfo {
  show_name: string
  avatar: string
  description: string
  collection_code: string
  status: number
  show_marks: boolean
  allow_marks: boolean
  show_profile: boolean
}

export interface userLoginReq {
  id_token?: string
  client_id?: string
  code: string
  redirect_uri: string
  platform: '' | 'web' | 'ios' | 'android' | 'macOS' | 'windows'
  type: '' | 'google' | 'apple'
  given_name?: string
  family_name?: string
  aff_code?: string
  siteverify_code?: string
}

export enum SubscriptionType {
  NO_SUBSCRIPTION = 0,
  FREE_SUBSCRIPTION = 1,
  PAID_SUBSCRIPTION = 2
}

export interface userLoginResp {
  token: string
  user_id: string
  is_new_user: boolean
  email: string
  uuid: string
  login_type: string
}

@injectable()
export class UserService {
  private userRepoData: UserRepo
  private reportRepoData: ReportRepo

  constructor(
    @inject(UserRepo) private userRepo: UserRepo,
    @inject(BucketClient) private bucketClient: LazyInstance<BucketClient>,
    @inject(ReportRepo) private reportRepo: ReportRepo,
    @inject(SubscriptionRepo) private subscriptionRepo: SubscriptionRepo,
    @inject(CollectionRepo) private collectionRepo: CollectionRepo,
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo,
    @inject(RedisClient) private redisClient: LazyInstance<RedisClient>,
    @inject(GA4AnalyticsClient) private ga4Client: GA4AnalyticsClient,
    @inject(LogsService) private logsService: LogsService,
    @inject(LabService) private labService: LabService
  ) {
    this.userRepoData = userRepo
    this.reportRepoData = reportRepo
  }

  /**
   * 登录接口
   * @param ctx
   * @param env
   * @param code
   * @param redirect_uri
   * @param platform
   * @param request
   * @returns
   */
  private async authenticateUser(ctx: ContextManager, request: Request): Promise<userLoginResp> {
    const req = await RequestUtils.json<userLoginReq>(request)
    console.log(
      `[login] request ${JSON.stringify({
        type: req?.type,
        platform: req?.platform,
        hasCode: typeof req?.code === 'string' && req.code.length > 0,
        hasIdToken: typeof req?.id_token === 'string' && req.id_token.length > 0,
        clientId: req?.client_id || undefined
      })}`
    )
    const authRes = await new SlaxAuth(ctx.env).login(req)
    console.log(
      `[login] identity ${JSON.stringify({ type: req.type, sub: authRes.sub, email: authRes.email, emailVerified: authRes.email_verified, aud: authRes.aud, iss: authRes.iss })}`
    )

    let findRes: userInfoPO | null = null
    if (!['apple', 'google'].includes(req.type) || !authRes.sub) {
      console.error(`[login] rejected: unsupported type or missing subject ${JSON.stringify({ type: req.type, sub: authRes.sub, email: authRes.email })}`)
      throw RegisterUserError()
    }

    try {
      const platformBind = await this.userRepo.getUserByPlatform(req.type, authRes.sub)
      console.log(`[login] platform bind ${JSON.stringify({ type: req.type, bound: !!platformBind?.user_id, userId: platformBind?.user_id })}`)
      if (platformBind?.user_id) {
        findRes = await this.userRepo.getInfoByUserId(platformBind.user_id)
      }
    } catch (e) {
      if (!(e instanceof Error) || e.name !== 'UNKNOWN_BIND_USER_ERROR') {
        console.error('[login] platform bind lookup threw:', e)
        throw e
      }
      console.error(`[login] platform bind lookup unknown: ${e instanceof Error ? e.message : String(e)}`)
    }
    if (findRes?.deleted_at) throw UserAccountDeletedError()

    if (!findRes) {
      const emailRes = await this.userRepo.getInfoByEmail(authRes.email)
      if (emailRes instanceof Error) {
        console.error(`[login] rejected: email lookup failed ${JSON.stringify({ email: authRes.email, error: String(emailRes) })}`)
        throw RegisterUserError()
      }
      findRes = emailRes
    }
    console.log(`[login] user record ${JSON.stringify({ found: !!findRes, userId: findRes?.id ?? null })}`)

    let userInfo = (!!findRes ? findRes : {}) as userInfoPO
    const isFirstRegister = !findRes || !findRes.id

    userInfo = UserService.getUserReuqestInfo(request, userInfo)

    const { email, name, picture, given_name, family_name } = authRes
    Object.assign(userInfo, { email, name, picture, given_name, family_name })

    const avatar = await this.bucketClient().putRemoteIfKeyExists(picture, 'image/avartar')
    if (avatar) userInfo.picture = `${ctx.env.IMAGE_PREFIX}${avatar.key}`

    const regRes = await this.userRepo.registerUser(userInfo)

    const regInfo = regRes as userInfoPO
    if (regInfo?.deleted_at) throw UserAccountDeletedError()
    if (!regInfo || !regInfo.id) {
      console.error(`[login] rejected: register returned no user ${JSON.stringify({ email: authRes.email, isFirstRegister, result: regInfo ?? null })}`)
      throw RegisterUserError()
    }
    console.log(`[login] registered ${JSON.stringify({ userId: regInfo.id, isFirstRegister, lang: regInfo.lang })}`)

    await this.userRepo.requireActiveUser(regInfo.id)
    const signUserId = new Hashid(ctx.env).encodeId(regInfo.id)
    const token = await new Auth(ctx.env).sign({ id: String(signUserId), lang: regInfo.lang, email: regInfo.email })

    if (req.type === 'apple' && authRes.sub && authRes.email && !authRes.email.endsWith('@appleid.apple.com')) {
      await this.userRepo.userBindPlatform(regInfo.id, platformBindType.APPLE, authRes.sub, authRes.email)
    }

    if (req.type === 'google' && authRes.sub) {
      await this.userRepo.userBindPlatform(regInfo.id, platformBindType.GOOGLE, authRes.sub, authRes.email)
    }

    // 发放邀请奖励
    //   if (isFirstRegister && req.aff_code) {
    //     const turnstileToken = req.siteverify_code
    //     const secretKey = `${env.TURNSTILE_SECRET_KEY}`
    //     const siteverifyUrl = `${env.TURNSTILE_SITEVERIFY_URL}`
    //     const resp = (await fetch(siteverifyUrl, {
    //       method: 'POST',
    //       body: JSON.stringify({
    //         secret: secretKey,
    //         response: turnstileToken
    //       })
    //     })) as Response

    //     if (!resp.ok) {
    //       return RegisterUserError()
    //     }

    //     const data = (await resp.json()) as { success: boolean }
    //     if (!data.success) {
    //       return RegisterUserError()
    //     }
    //     await new QueueClient(env).pushInviteMessage({
    //       affCode: req.aff_code,
    //       invitedUserId: regInfo.id
    //     })
    //   }

    // await new KVClient(env.KV).delete.USER_INFO(regInfo.id)

    this.bindRequestDevice(ctx, request, regInfo.id, isFirstRegister ? 'signup' : 'login')

    return {
      token,
      user_id: signUserId.toString(),
      is_new_user: isFirstRegister,
      email: regInfo.email,
      uuid: regInfo.uuid,
      login_type: req.type || 'unknown'
    }
  }

  public bindRequestDevice(ctx: ContextManager, request: Request, userId: number, source: 'signup' | 'login') {
    const deviceId = resolveDeviceId(request)
    if (!deviceId || !Number.isInteger(userId) || userId < 1) return
    ctx.execution.waitUntil(this.userRepo.bindUserDeviceAlias(deviceId, userId, source).catch(error => console.error('[events] failed to bind user device:', error)))
  }

  /**
   * 刷新token接口
   * @param ctx
   * @param env
   * @param userId
   * @returns
   */
  refreshToken = async (ctx: ContextManager): Promise<string> => {
    await this.userRepo.requireActiveUser(ctx.getUserId())
    const info = await this.userRepo.getInfoByUserId(ctx.getUserId())
    if (!info || info.deleted_at) throw UserAccountDeletedError()
    const userToken = new Hashid(ctx.env).encodeId(ctx.getUserId())
    return await new Auth(ctx.env).sign({ id: String(userToken), lang: info.lang, email: info.email })
  }

  /**
   * 保存用户设置
   * @param ctx
   * @param env
   * @param data
   * @returns
   */
  public async saveUserSetting(ctx: ContextManager, data: { key: string; value: string }): Promise<undefined> {
    if (data.key === 'account') {
      // 判断唯一、长度、是不是特定字符
      await this.userRepo.getInfo({ account: data.value })
      await this.userRepo.updateUserName(ctx.getUserId(), data.value)
    } else if (data.key === 'lang') {
      await this.userRepo.updateUserLang(ctx.getUserId(), data.value)
    } else if (data.key === 'ai_lang') {
      await this.userRepo.updateUserAiLang(ctx.getUserId(), data.value)
    }
    return
  }

  /**
   * 用户设置开关
   * @param ctx
   * @param env
   * @param setting
   * @param enable
   * @returns
   */
  private async updatePlatformSetting(ctx: ContextManager, setting: string, enable: boolean): Promise<string> {
    // const user = await this.userRepo.getInfoByUserId(ctx.getUserId())

    // Labs switches share this endpoint: key "lab:<feature>"
    if (setting.startsWith('lab:')) {
      await this.labService.setEnabled(ctx.getUserId(), setting.slice(4), enable)
      return 'ok'
    }

    if (setting === 'mail_collect' && !enable) {
      await this.userRepo.unbindPlatform(ctx.getUserId(), platformBindType.EMAIL)
    }
    if (setting === 'mail_collect' && enable) {
      const user = await this.userRepo.getInfoByUserId(ctx.getUserId())
      if (!user) throw UserNotFoundError()
      if (!user.account) throw NeedCreateUsernameError()

      await this.userRepo.userBindPlatform(ctx.getUserId(), platformBindType.EMAIL, user.account, `${user.account}@reader.slax.com`)
    }
    if (setting === 'affiliates' && enable) {
      const user = await this.userRepo.getInfoByUserId(ctx.getUserId())
      if (!user) throw UserNotFoundError()
      if (user.invite_code) return 'ok'
      if (!user.id) throw UserNotFoundError()
      const code = await hashMD5(user.id?.toString())
      await this.userRepo.updateInviteCode(ctx.getUserId(), code)
    }
    return 'ok'
  }

  public async getUserBriefInfo(isShowUserInfo: boolean, userId: number): Promise<{ nick_name: string; avatar: string }> {
    if (!isShowUserInfo) return { nick_name: '', avatar: '' }

    const user = await this.userRepo.getInfo({ id: userId })
    if (!user) return { nick_name: '', avatar: '' }

    return { nick_name: user.name, avatar: user.picture }
  }

  public async getOwnerShareInfo(userId: number): Promise<{ nick_name: string; avatar: string; snapshot_sharing: boolean }> {
    const user = await this.userRepo.getInfoByUserId(userId)
    return { nick_name: user.name, avatar: user.picture, snapshot_sharing: user.snapshot_sharing ?? true }
  }

  public async updateShareEnabled(ctx: ContextManager, enabled: boolean) {
    await this.userRepo.updateShareEnabled(ctx.getUserId(), enabled)
  }

  public async getShareEnabled(userId: number): Promise<boolean> {
    try {
      const user = await this.userRepo.getInfoByUserId(userId)
      return user.snapshot_sharing ?? true
    } catch {
      return false
    }
  }

  /** 获取绑定Telegram链接 */
  public async getBindTelegramLink(ctx: ContextManager): Promise<string> {
    const userId = ctx.getUserId()
    const url = new URL(`https://t.me/${ctx.env.SLAX_READER_BOT_NAME}`)
    const token = `${ctx.getEncodeUserId()}-${(await hashSHA256(String(userId + ctx.env.IMAGER_CHECK_DIGST_SALT))).substring(0, 50)}`
    url.searchParams.set('start', token)
    return url.toString()
  }

  /**
   * 用户信息接口
   * @param ctx
   * @param env
   * @param userId
   * @returns
   */
  public async userDetail(ctx: ContextManager): Promise<userInfoResp> {
    if (!ctx.getUserId()) throw UnauthorizedError()
    const userRes = await this.userRepoData.getInfoWithSubscription(ctx.getUserId())
    if (!userRes) throw UnauthorizedError()
    if (userRes.deleted_at) throw UserAccountDeletedError()

    const subInfo = UserService.getUserSubscriptionInfoWithPO(ctx.env, userRes.subscription_info)

    return {
      userId: ctx.hashIds.encodeId(ctx.getUserId()),
      email: userRes.email,
      lang: userRes.lang,
      name: userRes.name,
      picture: userRes.picture || '',
      timezone: userRes.timezone || '',
      subscription_type: subInfo.subscription_type,
      subscription_end_at: subInfo.subscription_end_at || new Date(0)
    }
  }

  /**
   * 保存反馈
   * @param ctx
   * @param env
   * @param req
   * @returns
   */
  public async saveReport(ctx: ContextManager, req: saveReportReq): Promise<undefined> {
    const res = await this.reportRepoData.saveReport({
      user_id: req.user_id,
      type: req.type,
      content: req.content,
      platform: req.platform,
      environment: req.environment,
      version: req.version || '',
      entry_point: req.entry_point,
      bookmark_id: req.bookmark_id || 0,
      target_url: req.target_url || '',
      ip_address: req.ip_address || '',
      allow_follow_up: req.allow_follow_up
    })

    if (!res) throw SaveReportError()

    const user = await this.userRepoData.getInfoByUserId(req.user_id)
    const bm = await this.bookmarkRepo.getBookmarkById(req.bookmark_id || 0)

    const formatCreatedAt = (date: Date): string => {
      const formatter = new Intl.DateTimeFormat('zh-CN', {
        timeZone: 'Asia/Shanghai',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
      })
      const parts = formatter.formatToParts(date).reduce(
        (acc, part) => {
          if (part.type !== 'literal') acc[part.type] = part.value
          return acc
        },
        {} as Record<string, string>
      )
      return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
    }

    const t = i18n('zh')
    const entryPointNameMap: Record<reportEntryPoint, string> = {
      [reportEntryPoint.INBOX]: t.entryPointInbox({}),
      [reportEntryPoint.BOOKMARK_DETAIL]: t.entryPointBookmarkDetail({}),
      [reportEntryPoint.SHARE]: t.entryPointShare({}),
      [reportEntryPoint.COLLECTION]: t.entryPointCollection({}),
      [reportEntryPoint.ORIGINAL_WEBSITE]: t.entryPointOriginalWebsite({})
    }

    const content = t.reportPushTemplate({
      type: req.type === reportType.LIKE ? '👍🏻' : '👎🏻',
      id: String(res.id),
      name: user.name,
      country: user.country,
      content: req.content,
      email: user.email,
      href: bm?.target_url || '',
      version: req.version || t.reportCommonNone({}),
      date: formatCreatedAt(res.created_at),
      platform: req.platform,
      environment: req.environment || t.reportCommonNone({}),
      entry_point: entryPointNameMap[req.entry_point],
      bookmark_id: req.bookmark_id ? String(req.bookmark_id) : t.reportCommonNone({}),
      target_url: req.target_url || t.reportCommonNone({}),
      user_id: ctx.hashIds.encodeId(req.user_id),
      ip_address: req.ip_address || t.reportCommonNone({}),
      allow_follow_up: req.allow_follow_up ? t.reportAllowFollowUp({}) : t.reportDenyFollowUp({})
    })

    await new SlaxAlertBotClient(ctx.env).report.pushMessage(content)

    const feedbackScope = [reportEntryPoint.BOOKMARK_DETAIL, reportEntryPoint.SHARE, reportEntryPoint.COLLECTION, reportEntryPoint.ORIGINAL_WEBSITE].includes(req.entry_point)
      ? 'bookmark'
      : 'app'
    ctx.execution.waitUntil(
      this.ga4Client.trackEvent(req.user_id, 'feedback_submit_complete', {
        scope: feedbackScope
      })
    )
  }

  public async getUserSubscriptionInfo(ctx: ContextManager): Promise<subscription> {
    const subscription = await this.subscriptionRepo.getUserSubscriptionInfoPO(ctx.getUserId())
    return UserService.getUserSubscriptionInfoWithPO(ctx.env, subscription)
  }

  public static getUserSubscriptionInfoWithPO(env: Env, subscription?: subscriptionPO): subscription {
    const subType =
      !subscription || subscription.endTime.getTime() < Date.now()
        ? SubscriptionType.NO_SUBSCRIPTION
        : subscription.stripeSubId && subscription.endTime.getTime() > Date.now()
          ? SubscriptionType.PAID_SUBSCRIPTION
          : SubscriptionType.FREE_SUBSCRIPTION
    return {
      first_subscription_at: subscription?.first_subscription_time,
      subscription_end_at: subscription?.endTime,
      next_invoice_at: subscription?.nextInvoiceAt,
      subscription_homepage: env.STRIPE_SUBSCRIPTION_HOME,
      subscription_type: subType,
      subscription_credit: subscription?.stripeCredit,
      stripe_stripe_currency: subscription?.stripeCurrency
    }
  }

  /**
   * 获取用户设置信息接口
   * @param ctx
   * @param env
   * @returns
   */
  public async getUserInfo(ctx: ContextManager): Promise<userInfo> {
    const [user, bindList, shareCollect, subInfoPO] = await Promise.all([
      this.userRepoData.getInfoWithSubscription(ctx.getUserId()),
      this.userRepoData.getUserBindPlatform(ctx.getUserId()),
      this.collectionRepo.getUserShareCollect(ctx.getUserId()),
      this.subscriptionRepo.getUserSubscriptionInfoPO(ctx.getUserId())
    ])

    const subInfo = UserService.getUserSubscriptionInfoWithPO(ctx.env, subInfoPO)
    const ai_lang = user.ai_lang ? user.ai_lang : user.lang ? user.lang : 'en'

    return {
      name: user.name,
      account: user.account,
      email: user.email,
      lang: user.lang,
      ai_lang,
      timezone: user.timezone,
      avatar: user.picture,
      uuid: user.uuid,
      id: ctx.hashIds.encodeId(ctx.getUserId()),
      platform: bindList.map(item => {
        return {
          platform: item.platform,
          user_name: item.user_name,
          created_at: item.created_at
        }
      }),
      // 上线一周后，再把它删除
      share_collect: {
        show_name: shareCollect?.display_name || '',
        avatar: shareCollect?.avatar || '',
        description: shareCollect?.description || '',
        collection_code: shareCollect?.collection_code || '',
        status: shareCollect?.status || 0,
        show_marks: shareCollect?.show_marks || false,
        allow_marks: shareCollect?.allow_marks || false,
        show_profile: shareCollect?.show_profile || false
      },
      subscription: subInfo,
      aff_code: user.invite_code
    }
  }

  /**
   * 用户设置开关
   * @param ctx
   * @param env
   * @param setting
   * @param enable
   * @returns
   */
  public async enableUserSetting(ctx: ContextManager, setting: string, enable: boolean): Promise<string | userShareCollectInfo> {
    if (setting === 'share_collect') {
      const user = await this.userRepoData.getInfoByUserId(ctx.getUserId())
      const res = await this.collectionRepo.enableUserShareCollect(ctx.getUserId(), enable, user.name, 1)
      return {
        show_name: res.display_name,
        avatar: res.avatar,
        description: res.description,
        collection_code: res.collection_code,
        status: res.status,
        show_marks: res.show_marks,
        allow_marks: res.allow_marks,
        show_profile: res.show_profile
      }
    } else {
      await this.updatePlatformSetting(ctx, setting, enable)
    }
    return 'ok'
  }

  public static getUserReuqestInfo = <T extends userInfoPO>(request: Request, userInfo: T): T => {
    // 获取真实的请求IP
    if (request.headers.has('x-real-ip')) {
      userInfo.last_login_ip = request.headers.get('x-real-ip') || ''
    }
    // 从header头中获取语言信息
    if (request.headers.has('accept-language')) {
      const lang = request.headers.get('accept-language')?.split(',')
      userInfo.lang = lang && lang.length > 1 ? lang[1] : 'en'
    }
    // 从Cloudflare中获取相关国家、IP等信息
    if (request.cf) {
      const { city, country, region, latitude, longitude, timezone } = request.cf
      Object.assign(userInfo, {
        city: city ?? '',
        country,
        region: region ?? '',
        latitude: Number(latitude ?? 0),
        longitude: Number(longitude ?? 0),
        timezone
      })
    }
    return userInfo
  }

  public async userLogin(ctx: ContextManager, request: Request): Promise<userLoginResp> {
    const result = await this.authenticateUser(ctx, request)

    ctx.execution.waitUntil(
      this.ga4Client.trackEvent(result.uuid, 'user_login_complete', {
        is_new_user: result.is_new_user ? true : false,
        login_method: result.login_type
      })
    )

    const ua = request.headers.get('User-Agent') || ''
    const { platform, version } = parseClientSource(ua)
    const metadata: Record<string, string> = { platform }
    if (version) metadata.version = version

    const userId = new Hashid(ctx.env).decodeId(parseInt(result.user_id))
    if (result.is_new_user) {
      ctx.execution.waitUntil(this.logsService.track(userId, 'register', metadata))
      submitServerEvent(ctx, request, 'user_created', { method: result.login_type }, { userId })
    } else {
      ctx.execution.waitUntil(this.logsService.track(userId, 'login', metadata))
      submitServerEvent(ctx, request, 'user_logged_in', { method: result.login_type }, { userId })
    }

    return result
  }

  public async getBindLink(ctx: ContextManager, type: string): Promise<string> {
    if (type === 'telegram') {
      return this.getBindTelegramLink(ctx)
    } else if (type === 'twitter') {
      const userId = ctx.getUserId()
      const existingBind = await this.userRepoData.getUserBindPlatform(userId)
      const twitterBind = existingBind.find(b => b.platform === 'twitter')

      if (twitterBind) throw PlatformAlreadyBoundError()

      const xSrv = new TwitterOAuth2(ctx.env)
      const authRes = await xSrv.generateAuthUrl()

      await this.redisClient().twitterOAuthState(authRes.state).setWithExpire(
        {
          userId: userId,
          codeVerifier: authRes.codeVerifier,
          createdAt: Date.now()
        },
        600
      )

      return authRes.url
    } else {
      throw ErrorParam()
    }
  }

  public async checkDeleteAccountConstraints(userId: number): Promise<{ canDelete: boolean; reason?: string }> {
    const [subscription, hasFreeSubscription] = await Promise.all([this.subscriptionRepo.getUserSubscriptionInfoPO(userId), this.userRepoData.hasReceivedFreeSubscription(userId)])

    if (subscription && (subscription.endTime.getTime() > Date.now() || subscription.autoRenew)) {
      return { canDelete: false, reason: 'active_subscription' }
    }

    // 领取过免费订阅 (REDEEM_CODE)
    if (hasFreeSubscription) {
      return { canDelete: false, reason: 'has_free_subscription_history' }
    }

    return { canDelete: true }
  }

  public async markUserAsDeleted(userId: number): Promise<void> {
    await this.userRepoData.markUserAsDeleted(userId)
  }

  /**
   * 处理 OAuth2 绑定回调
   */
  public async handleOAuth2Bind(ctx: ContextManager, type: string, state: string, code: string): Promise<void> {
    if (type !== 'twitter') {
      throw ErrorParam()
    }

    const redisClient = new RedisClient(ctx.env)

    if (!/^[A-Za-z0-9._~-]{16,128}$/.test(state) || !code) throw OAuth2StateExpiredError()
    const oauthData = await redisClient.twitterOAuthState(state).consume()
    if (!oauthData || !Number.isFinite(oauthData.createdAt) || Date.now() - oauthData.createdAt > 600000 || oauthData.createdAt > Date.now()) throw OAuth2StateExpiredError()

    const userId = oauthData.userId
    await this.userRepoData.requireActiveUser(userId)

    const twitterOAuth = new TwitterOAuth2(ctx.env)

    let tokenResponse
    try {
      tokenResponse = await twitterOAuth.handleCallback({ code, state }, oauthData.codeVerifier, state)
    } catch (error) {
      console.error('[Twitter OAuth] Token exchange failed:', error)
      await redisClient.twitterOAuthState(state).delete()
      throw OAuth2TokenExchangeError()
    }

    let twitterUser
    try {
      twitterUser = await twitterOAuth.getUser(tokenResponse.accessToken)
    } catch (error) {
      console.error('[Twitter OAuth] Get user info failed:', error)
      await redisClient.twitterOAuthState(state).delete()
      throw OAuth2UserInfoError()
    }

    try {
      const existingTwitterUser = await this.userRepoData.getUserByPlatform('twitter', twitterUser.id)
      if (existingTwitterUser) {
        await redisClient.twitterOAuthState(state).delete()
        throw PlatformAccountBoundToOtherUserError()
      }
    } catch (error: any) {
      if (error.name !== 'UNKNOWN_BIND_USER_ERROR') {
        await redisClient.twitterOAuthState(state).delete()
        throw error
      }
    }

    await this.userRepoData.requireActiveUser(userId)
    await this.userRepoData.userBindPlatform(userId, platformBindType.TWITTER, twitterUser.id, twitterUser.username)

    await redisClient.twitterOAuthState(state).delete()

    console.log(`[Twitter OAuth] User ${userId} bound to Twitter @${twitterUser.username}`)
  }
}
