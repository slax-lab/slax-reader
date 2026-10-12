import { PrismaClient } from '@prisma/client'
import { AccountNotAllowRegisterError, UserAccountDeletedError, UserNotFoundError, ErrorParam, UnknownBindUserError, PlatformAccountBoundToOtherUserError } from '@/const/err'
import { inject, injectable, singleton } from '@/decorators/di'
import { PRISIMA_CLIENT, PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import { subscriptionPO } from '@/infra/repository/dbSubscription'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { addDays, differenceInHours } from 'date-fns'

export interface userInfoPO {
  id?: number
  email: string
  name: string
  picture: string
  given_name: string
  family_name: string
  lang: string
  country: string
  city: string
  region: string
  timezone: string
  latitude: number
  longitude: number
  last_login_at: Date
  last_login_ip: string
  created_at: Date
  account: string
  ai_lang: string
  invite_code?: string

  last_read_at?: Date
  deleted_at?: Date | null
  subscription_info?: subscriptionPO

  uuid: string
  snapshot_sharing: boolean
}

export enum platformBindType {
  TELEGRAM = 'telegram',
  WECHAT = 'wechat',
  QQ = 'qq',
  EMAIL = 'email',
  APPLE = 'apple',
  TWITTER = 'twitter',
  GOOGLE = 'google'
}

export enum noticeType {
  WEBSOCKET = 'websocket',
  APPLE = 'apple',
  BROWSER = 'browser',
  TELEGRAM = 'telegram'
}

export interface platformBind {
  user_id: number
  platform: platformBindType
  platform_id: string
  user_name: string
  created_at: Date
}

export interface userNoticePO {
  id?: number
  user_id: number
  type: string
  source: string
  title: string
  body: string
  details: string
  is_read: boolean
  created_at: Date
}

@injectable()
export class UserRepo {
  private repoPg: LazyInstance<HyperdrivePrismaClient>

  constructor(
    @inject(PRISIMA_CLIENT) private prisma: LazyInstance<PrismaClient>,
    @inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<HyperdrivePrismaClient>
  ) {
    this.repoPg = prismaPg
  }

  public async bindUserDeviceAlias(deviceId: string, userId: number, bindSource: 'signup' | 'login') {
    if (!deviceId || userId < 1) return
    await this.prisma().user_device_alias.upsert({
      where: { device_id_user_id: { device_id: deviceId, user_id: userId } },
      create: {
        device_id: deviceId,
        user_id: userId,
        bind_source: bindSource,
        bound_at: new Date()
      },
      update: {}
    })
  }

  async getUserInfoList(userIds: number[]) {
    if (!userIds || userIds.length === 0) return []
    return await this.prismaPg().sr_user.findMany({ where: { id: { in: userIds } } })
  }

  async getInfo(condition: any): Promise<userInfoPO> {
    if (!condition) throw ErrorParam()
    let res = await this.prismaPg().sr_user.findFirst({ where: condition })
    if (!res) throw UserNotFoundError()
    return res as userInfoPO
  }

  public async registerUser(info: userInfoPO): Promise<userInfoPO> {
    if (!info || !info.email) throw ErrorParam()

    const { lang, deleted_at, id, uuid, subscription_info, ...restUserInfo } = info
    return this.prismaPg().$transaction(async tx => {
      if (id) {
        const users = await tx.$queryRaw<userInfoPO[]>`SELECT *, CURRENT_TIMESTAMP AS checked_at FROM sr_user WHERE id = ${id} FOR UPDATE`
        const matched = users[0]
        if (!matched || matched.deleted_at) throw UserAccountDeletedError()
        const collision = await tx.sr_user.findFirst({ where: { email: info.email, id: { not: id } }, select: { id: true } })
        if (collision) throw PlatformAccountBoundToOtherUserError()
        return (await tx.sr_user.update({ where: { id }, data: { ...restUserInfo, last_login_at: new Date() } })) as userInfoPO
      }
      const users = await tx.$queryRaw<userInfoPO[]>`SELECT *, CURRENT_TIMESTAMP AS checked_at FROM sr_user WHERE email = ${info.email} FOR UPDATE`
      const existing = users[0]
      if (existing?.deleted_at) {
        const freezeTime = addDays(existing.deleted_at, 30)
        const remainingHours = differenceInHours(freezeTime, new Date())
        if (freezeTime >= new Date()) {
          throw AccountNotAllowRegisterError(remainingHours >= 24 ? `${Math.floor(remainingHours / 24)} Days` : `${remainingHours} Hours`)
        }
        await tx.sr_user.update({ where: { id: existing.id }, data: { email: `deleted-${existing.id}-${crypto.randomUUID()}@deleted.invalid` } })
      } else if (existing) {
        return (await tx.sr_user.update({ where: { id: existing.id }, data: { ...restUserInfo, last_login_at: new Date() } })) as userInfoPO
      }
      return (await tx.sr_user.create({ data: { ...restUserInfo, lang, created_at: new Date(), last_login_at: new Date() } })) as userInfoPO
    })
  }

  public async updateUserName(userId: number, account: string): Promise<userInfoPO> {
    if (!userId || !account) throw ErrorParam()
    const res = await this.prismaPg().sr_user.update({
      data: { account },
      where: { id: userId }
    })
    if (!res) throw UserNotFoundError()
    return res as userInfoPO
  }

  public async updateUserLang(userId: number, lang: string): Promise<userInfoPO> {
    if (!userId || !lang) throw ErrorParam()
    const res = await this.prismaPg().sr_user.update({
      data: { lang },
      where: { id: userId }
    })
    if (!res) throw UserNotFoundError()
    return res as userInfoPO
  }

  public async updateUserAiLang(userId: number, lang: string): Promise<userInfoPO> {
    if (!userId || !lang) throw ErrorParam()
    const res = await this.prismaPg().sr_user.update({
      data: { ai_lang: lang },
      where: { id: userId }
    })
    if (!res) throw UserNotFoundError()
    return res as userInfoPO
  }

  public async getUserByPlatform(platform: string, platformId: string): Promise<platformBind> {
    const bindings = await this.prismaPg().$transaction(
      tx => tx.$queryRaw<platformBind[]>`
      SELECT binding.* FROM sr_platform_bind binding
      INNER JOIN sr_user u ON u.id = binding.user_id AND u.deleted_at IS NULL
      WHERE binding.platform = ${platform} AND binding.platform_id = ${platformId}
        AND CURRENT_TIMESTAMP IS NOT NULL LIMIT 1
    `
    )
    const bind = bindings[0]
    if (!bind) throw UnknownBindUserError()
    return {
      user_id: bind.user_id,
      platform: bind.platform as platformBindType,
      platform_id: bind.platform_id,
      user_name: bind.user_name,
      created_at: bind.created_at
    }
  }

  public async userBindPlatform(userId: number, platform: platformBindType, platformId: string, username: string): Promise<null> {
    if (!userId || !platform || !platformId) throw ErrorParam()
    await this.prismaPg().$transaction(async tx => {
      const users = await tx.$queryRaw<Array<{ id: number }>>`SELECT id FROM sr_user WHERE id = ${userId} AND deleted_at IS NULL FOR UPDATE`
      if (users.length !== 1) throw UserAccountDeletedError()
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${platform}:${platformId}`}, 0))`
      const existing = await tx.sr_platform_bind.findFirst({ where: { platform, platform_id: platformId, user_id: { not: userId } } })
      if (existing) throw PlatformAccountBoundToOtherUserError()
      await tx.sr_platform_bind.upsert({
        create: { user_id: userId, platform, platform_id: platformId, user_name: username, created_at: new Date() },
        update: { platform_id: platformId, user_name: username },
        where: { user_id_platform: { user_id: userId, platform } }
      })
    })
    return null
  }

  public async getUserBindPlatform(userId: number) {
    return await this.prismaPg().sr_platform_bind.findMany({ where: { user_id: userId } })
  }

  public async unbindPlatform(userId: number, platform: platformBindType) {
    return await this.prismaPg().sr_platform_bind.deleteMany({ where: { user_id: userId, platform: platform } })
  }

  public async updateInviteCode(userId: number, inviteCode: string) {
    return await this.prismaPg().sr_user.update({ data: { invite_code: inviteCode }, where: { id: userId } })
  }

  public async addUserPushDevice(userId: number, type: noticeType, data: string) {
    return await this.prisma().slax_user_notice_device.create({
      data: { user_id: userId, type: type.toString(), data }
    })
  }

  public async getUserOnlineDevice(userId: number) {
    return await this.prisma().slax_user_notice_device.findMany({ where: { user_id: userId } })
  }

  public async removeUserPushDevice(id: number) {
    return await this.prisma().slax_user_notice_device.delete({ where: { id } })
  }

  public async getUserUnreadCount(userId: number) {
    const res = await this.prismaPg().$queryRaw<
      {
        notification_count: number
      }[]
    >`SELECT (SELECT count(1) FROM sr_user_notification WHERE user_id = u.id AND (u.last_read_at IS NULL OR created_at > u.last_read_at) AND is_read = false) as notification_count FROM sr_user u WHERE id = ${userId};`
    return Number(res[0].notification_count || 0)
  }

  public async getUserNotificationList(userId: number, page: number, pageSize: number) {
    return await this.prismaPg().sr_user_notification.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  }

  public async addUserNotice(po: userNoticePO): Promise<userNoticePO> {
    return await this.prismaPg().sr_user_notification.create({
      data: po
    })
  }

  public async updateShareEnabled(userId: number, enabled: boolean) {
    return await this.prismaPg().sr_user.update({
      data: { snapshot_sharing: enabled },
      where: { id: userId }
    })
  }

  public async updateUserReadAt(userId: number) {
    return await this.prismaPg().sr_user.update({ data: { last_read_at: new Date() }, where: { id: userId } })
  }

  public async updateUserNotificationRead(userId: number, id: number) {
    return await this.prismaPg().sr_user_notification.update({ data: { is_read: true }, where: { id, user_id: userId } })
  }

  /**
   * 获取用户信息和订阅信息
   */
  public async getInfoWithSubscription(id: number): Promise<userInfoPO> {
    if (!id) throw UserNotFoundError()

    const res = await this.repoPg().sr_user.findUnique({
      where: {
        id
      },
      include: {
        subscription: true
      }
    })
    if (!res) throw UserNotFoundError()
    const { subscription, last_read_at, ...userInfo } = res
    const result: userInfoPO = userInfo
    if (subscription) {
      result.subscription_info = {
        userId: subscription.user_id,
        stripeCurrency: subscription.stripe_stripe_currency,
        stripeSubId: subscription.stripe_subscription_id,
        stripeCustomerId: subscription.stripe_customer_id,
        endTime: subscription.subscription_end_time,
        nextInvoiceAt: subscription.next_invoice_time,
        autoRenew: subscription.auto_renew,
        subscribed: subscription.subscribed,
        stripeCredit: subscription.stripe_credit,
        first_subscription_time: subscription.first_subscription_time,
        sourceType: subscription.source_type
      }
    }
    return result
  }

  async getUserInfo(userId: number): Promise<userInfoPO> {
    if (!userId) throw ErrorParam()
    let res = await this.repoPg().sr_user.findFirst({ where: { id: userId } })
    if (!res) throw UserNotFoundError()
    return res as userInfoPO
  }

  public async getUserByUuid(uuid: string): Promise<userInfoPO | null> {
    if (!uuid) return null
    const res = await this.repoPg().sr_user.findUnique({ where: { uuid } })
    if (!res) return null
    return res as userInfoPO
  }

  public async batchSaveNotificationData(data: userNoticePO[]) {
    await this.repoPg().sr_user_notification.createMany({ data })
  }

  public async requireActiveUser(userId: number): Promise<void> {
    const { requireActiveReaderUser } = await import('@/utils/activeUser')
    await requireActiveReaderUser(this.repoPg(), userId)
  }

  public async markUserAsDeleted(userId: number): Promise<void> {
    if (!Number.isSafeInteger(userId) || userId < 1) throw ErrorParam()
    await this.repoPg().$transaction(async tx => {
      const users = await tx.$queryRaw<{ id: number; deleted_at: Date | null }[]>`SELECT id, deleted_at FROM sr_user WHERE id = ${userId} FOR UPDATE`
      if (!users[0]) throw UserNotFoundError()
      if (!users[0].deleted_at) await tx.sr_user.update({ where: { id: userId }, data: { deleted_at: new Date() } })
      await tx.sr_user_api_key.deleteMany({ where: { user_id: userId } })
    })
  }

  public async hasReceivedFreeSubscription(userId: number): Promise<boolean> {
    const record = await this.repoPg().sr_user_receive_activity_record.findFirst({
      where: {
        user_id: userId
      }
    })
    return !!record
  }

  public async getInfoByEmail(email: string): Promise<userInfoPO | null> {
    if (!email) return null
    const rows = await this.repoPg().$transaction(tx => tx.$queryRaw<userInfoPO[]>`SELECT * FROM sr_user WHERE email = ${email} AND CURRENT_TIMESTAMP IS NOT NULL LIMIT 1`)
    const res = rows[0]
    if (!res) return null
    if (res.deleted_at) {
      const currentTime = new Date()
      const freezeTime = addDays(res.deleted_at, 30)
      if (freezeTime < currentTime) return null

      const remeninHours = differenceInHours(freezeTime, currentTime)
      const remeninTips = remeninHours >= 24 ? `${Math.floor(remeninHours / 24)} Days` : `${remeninHours} Hours`
      throw AccountNotAllowRegisterError(remeninTips)
    }
    return res as userInfoPO
  }

  public async getInfoByUserId(userId: number): Promise<userInfoPO> {
    if (!userId) throw UserNotFoundError()

    const res = await this.repoPg().sr_user.findFirst({ where: { id: userId } })

    if (!res) throw UserNotFoundError()
    if (res.deleted_at) throw UserAccountDeletedError()

    return res as userInfoPO
  }
}
