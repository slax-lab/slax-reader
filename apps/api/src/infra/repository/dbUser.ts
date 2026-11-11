import { PrismaClient } from '@prisma/client'
import { AccountNotAllowRegisterError, UserAccountDeletedError, UserNotFoundError, ErrorParam, UnknownBindUserError, PlatformAccountBoundToOtherUserError } from '@/const/err'
import { inject, injectable } from '@/decorators/di'
import { PRISIMA_CLIENT, PRISIMA_HYPERDRIVE_CLIENT } from '@/const/symbol'
import type { LazyInstance } from '@/decorators/lazy'
import { subscriptionPO } from '@/infra/repository/dbSubscription'
import { PrismaClient as HyperdrivePrismaClient, type Prisma } from '@prisma/hyperdrive-client'
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
  MAIL = 'mail',
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

export type LoginProvider = 'google' | 'apple'
type LoginPlatform = LoginProvider | 'mail'
type UserTransaction = Prisma.TransactionClient
export type LoginEmailOwner = {
  id: number
  deleted_at: Date | null
  login_key: string | null
  delivery_email: string | null
}
type SavedUser = Pick<userInfoPO, 'email' | 'lang' | 'uuid'> & { id: number }

export interface LoginIdentityTransaction {
  lockAccount(userId: number): Promise<(Pick<SavedUser, 'id' | 'email'> & { deleted_at: Date | null }) | null>
  findEmailOwners(key: string): Promise<LoginEmailOwner[]>
  findProfileEmail(email: string): Promise<(Pick<SavedUser, 'id'> & { deleted_at: Date | null }) | null>
  findProviderOwners(provider: LoginProvider, subject: string): Promise<Pick<platformBind, 'user_id'>[]>
  findBinding(userId: number, platform: LoginPlatform): Promise<Pick<platformBind, 'platform_id' | 'user_name'> | null>
  createBinding(userId: number, platform: LoginPlatform, key: string, label: string): Promise<void>
  saveRegistration(profile: userInfoPO): Promise<SavedUser>
  recordLogin(userId: number, profile: userInfoPO): Promise<SavedUser>
}

async function lockIdentities(tx: UserTransaction, keys: string[]) {
  for (const key of [...new Set(keys)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
  }
}

async function lockAccount(tx: UserTransaction, userId: number) {
  await lockIdentities(tx, [`account:${userId}`])
  return tx.sr_user.findUnique({ where: { id: userId } })
}

async function lockActiveAccount(tx: UserTransaction, userId: number) {
  const account = await lockAccount(tx, userId)
  if (!account || account.deleted_at) throw UserAccountDeletedError()
  return account
}

async function findEmailOwners(tx: UserTransaction, key: string) {
  return tx.$queryRaw<LoginEmailOwner[]>`
    SELECT u.id, u.deleted_at, m.platform_id AS login_key, m.user_name AS delivery_email
    FROM sr_user u
    LEFT JOIN sr_platform_bind m ON m.user_id = u.id AND m.platform = 'mail'
    WHERE m.platform_id = ${key} OR lower(btrim(u.email)) = ${key}
      OR EXISTS (
        SELECT 1 FROM sr_platform_bind p
        WHERE p.user_id = u.id AND p.platform IN ('google', 'apple') AND lower(btrim(p.user_name)) = ${key}
      )
  `
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
    return this.prismaPg().$transaction(async tx => {
      await lockIdentities(tx, [`mail:${info.email.trim().toLowerCase()}`])
      if (info.id) await lockActiveAccount(tx, info.id)
      return (await this.saveRegistration(tx, info)) as userInfoPO
    })
  }

  private async saveRegistration(tx: UserTransaction, info: userInfoPO) {
    const { lang, deleted_at, id, uuid, subscription_info, ...restUserInfo } = info
    if (id) {
      const collision = await tx.sr_user.findFirst({ where: { email: info.email, id: { not: id } }, select: { id: true } })
      if (collision) throw PlatformAccountBoundToOtherUserError()
      return tx.sr_user.update({ where: { id }, data: { ...restUserInfo, last_login_at: new Date() } })
    }
    const match = await tx.sr_user.findUnique({ where: { email: info.email }, select: { id: true } })
    const locked = match ? await lockAccount(tx, match.id) : null
    const existing = locked?.email === info.email ? locked : null
    if (existing?.deleted_at) {
      const freezeTime = addDays(existing.deleted_at, 30)
      const remainingHours = differenceInHours(freezeTime, new Date())
      if (freezeTime >= new Date()) {
        throw AccountNotAllowRegisterError(remainingHours >= 24 ? `${Math.floor(remainingHours / 24)} Days` : `${remainingHours} Hours`)
      }
      await tx.sr_user.update({ where: { id: existing.id }, data: { email: `deleted-${existing.id}-${crypto.randomUUID()}@deleted.invalid` } })
    } else if (existing) {
      return tx.sr_user.update({ where: { id: existing.id }, data: { ...restUserInfo, last_login_at: new Date() } })
    }
    return tx.sr_user.create({ data: { ...restUserInfo, lang, created_at: new Date(), last_login_at: new Date() } })
  }

  public async getLoginEmailRecipient(key: string): Promise<string | undefined> {
    const matches = await this.prismaPg().$queryRaw<{ user_name: string }[]>`
      SELECT b.user_name FROM sr_platform_bind b JOIN sr_user u ON u.id = b.user_id
      WHERE b.platform = 'mail' AND b.platform_id = ${key} AND u.deleted_at IS NULL LIMIT 2
    `
    return matches.length === 1 ? matches[0].user_name : undefined
  }

  public withLoginIdentityTransaction<T>(
    { emailKey, provider }: { emailKey: string; provider?: { type: LoginProvider; subject: string } },
    run: (tx: LoginIdentityTransaction) => Promise<T>
  ): Promise<T> {
    return this.prismaPg().$transaction(async tx => {
      const keys = [`mail:${emailKey}`]
      if (provider) keys.push(`${provider.type}:${provider.subject}`)
      await lockIdentities(tx, keys)
      return run({
        lockAccount: userId => lockAccount(tx, userId),
        findEmailOwners: key => findEmailOwners(tx, key),
        findProfileEmail: email => tx.sr_user.findUnique({ where: { email }, select: { id: true, deleted_at: true } }),
        findProviderOwners: (platform, platform_id) => tx.sr_platform_bind.findMany({ where: { platform, platform_id }, select: { user_id: true }, take: 2 }),
        findBinding: (user_id, platform) => tx.sr_platform_bind.findUnique({ where: { user_id_platform: { user_id, platform } }, select: { platform_id: true, user_name: true } }),
        createBinding: async (user_id, platform, platform_id, user_name) => {
          await tx.sr_platform_bind.create({ data: { user_id, platform, platform_id, user_name } })
        },
        saveRegistration: profile => this.saveRegistration(tx, profile),
        recordLogin: (id, { last_login_ip, last_login_at, country, city, region, timezone, latitude, longitude }) =>
          tx.sr_user.update({ where: { id }, data: { last_login_ip, last_login_at, country, city, region, timezone, latitude, longitude } })
      })
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
      await lockIdentities(tx, [`${platform}:${platformId}`])
      await lockActiveAccount(tx, userId)
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
      const user = await lockAccount(tx, userId)
      if (!user) throw UserNotFoundError()
      if (!user.deleted_at) await tx.sr_user.update({ where: { id: userId }, data: { deleted_at: new Date() } })
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
