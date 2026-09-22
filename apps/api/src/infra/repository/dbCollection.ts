import { Prisma, PrismaClient } from '@prisma/client'
import { hashMD5 } from '../../utils/strings'
import { inject, injectable, singleton } from '../../decorators/di'
import { PRISIMA_CLIENT, PRISIMA_HYPERDRIVE_CLIENT } from '../../const/symbol'
import type { LazyInstance } from '../../decorators/lazy'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'

export enum collectionIntervalType {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
  MINUTE = 'minute'
}

export enum subscriptionType {
  STRIPE = 1,
  STRIPE_TRIAL = 2,
  APPLE = 3,
  INVITE = 4,
  INVITE_CONSUMPTION = 5,
  STRIPE_ROLLBACK = 6,
  FREE_SUBSCRIBE = 7
}

export interface collectionSubscribePeriodPO {
  id?: number
  source: string
  collection_id: number
  user_id: number
  type: subscriptionType
  interval: collectionIntervalType
  interval_count: number
  created_at: Date
}

export interface collectionSubscribeInfoPO {
  id?: number
  user_id: number
  collection_id: number
  owner_id: number
  subscription_end_time: Date
  next_invoice_time: Date
  auto_renew: boolean
  is_deleted?: boolean
}

export interface collectionSubscriberInfoPO extends collectionSubscribeInfoPO {
  show_marks: boolean
  allow_marks: boolean
  show_profile: boolean
}

export interface subscribedCollectionItem {
  id: number
  type: string
  subscription_end_time: Date
  subscribed_at: Date
  last_read_at: Date | null
  owner_id: number
  display_name: string
  description: string
  status: number
  updated_at: Date
  collection_code: string
  is_cancelled: boolean
}

@injectable()
export class CollectionRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<HyperdrivePrismaClient>) {}

  // sitemap：开启中且≥10 星标，lastmod 取触发器维护值
  public async listActiveCollectionsWithLastModified(): Promise<Array<{ collection_code: string; lastmod: Date | null }>> {
    // 目前是属于collection全表查询，后续若大于10w条Collection后，需要添加索引进行优化
    const query = Prisma.sql`
      SELECT c.collection_code,
             s.last_modified_at AS lastmod
      FROM sr_user_collection c
      JOIN sr_user_collection_stats s ON s.collection_id = c.id
      JOIN sr_user owner ON owner.id = c.owner_id AND owner.deleted_at IS NULL
      WHERE c.status = 1
        AND c.collection_code <> ''
        AND s.starred_count >= 10`
    const rows = await this.prismaPg().$queryRaw<Array<{ collection_code: string; lastmod: Date | null }>>(query)
    return rows.map(r => ({ collection_code: r.collection_code, lastmod: r.lastmod }))
  }

  // join 一次取归属合集
  public async getBookmarkCollectionByUuid(uuid: string): Promise<{ display_name: string | null; collection_code: string | null; status: number } | null> {
    const rows = await this.prismaPg().$queryRaw<Array<{ display_name: string | null; collection_code: string | null; status: number }>>`
      SELECT uc.display_name, uc.collection_code, uc.status
      FROM sr_user_bookmark ub
      INNER JOIN sr_user_collection uc ON uc.owner_id = ub.user_id
      INNER JOIN sr_user owner ON owner.id = uc.owner_id AND owner.deleted_at IS NULL
      INNER JOIN sr_bookmark b ON b.id = ub.bookmark_id
      LEFT JOIN sr_bookmark_share share ON share.bookmark_id = ub.bookmark_id AND share.user_id = ub.user_id
      WHERE ub.uuid = ${uuid} AND ub.deleted_at IS NULL AND ub.is_starred = true
        AND uc.status = 1 AND b.moderation_result = 0
        AND COALESCE(share.is_enable, owner.snapshot_sharing)`

    if (!rows) {
      return null
    }

    return rows[0] ?? null
  }

  public async updateUserShareCollectInfo(
    userId: number,
    updateInfo: {
      name?: string
      show_marks?: boolean
      allow_marks?: boolean
      show_profile?: boolean
      avatar?: string
      description?: string
    }
  ) {
    return await this.prismaPg().sr_user_collection.update({
      data: {
        display_name: updateInfo.name,
        show_marks: updateInfo.show_marks,
        allow_marks: updateInfo.allow_marks,
        show_profile: updateInfo.show_profile,
        avatar: updateInfo.avatar,
        description: updateInfo.description,
        type: 1
      },
      where: { owner_id: userId }
    })
  }

  public async enableUserShareCollect(userId: number, enable: boolean, nickName?: string, _type?: number) {
    return await this.prismaPg().sr_user_collection.upsert({
      where: { owner_id: userId },
      create: {
        owner_id: userId,
        display_name: `${nickName}'s Collection Share`,
        type: 1,
        collection_code: await hashMD5(`${userId}-${new Date().getTime()}`),
        status: enable ? 1 : 0,
        created_at: new Date(),
        updated_at: new Date(),
        show_marks: true,
        allow_marks: true,
        show_profile: true
      },
      update: {
        updated_at: new Date(),
        status: enable ? 1 : 0
      }
    })
  }

  public async getUserShareCollect(userId: number) {
    return await this.prismaPg().sr_user_collection.findFirst({ where: { owner_id: userId } })
  }

  public async userHasCollectionSubscribe(userId: number) {
    const res = await this.prismaPg().$queryRaw<{ user_id: number }[]>`SELECT user_id from sr_user_collection_subscriber where user_id = ${userId} limit 1;`
    return res && res.length > 0
  }

  public async getUserShareCollectByCode(code: string) {
    return await this.prismaPg().sr_user_collection.findFirst({ where: { collection_code: code } })
  }

  public async getUserShareCollectById(id: number) {
    return await this.prismaPg().sr_user_collection.findFirst({ where: { id } })
  }

  public async getCollectionSubscribedUser(collectionId: number) {
    return await this.prismaPg().sr_user_collection_subscriber.count({ where: { collection_id: collectionId } })
  }

  // 触发器维护：文章数 + 订阅数
  public async getCollectionStats(collectionId: number): Promise<{ starred_count: number; subscriber_count: number } | null> {
    return await this.prismaPg().sr_user_collection_stats.findUnique({
      where: { collection_id: collectionId },
      select: { starred_count: true, subscriber_count: true }
    })
  }

  public async getCollectionNotifyUserEntity(collectionId: number) {
    return await this.prismaPg().$queryRaw<{ user_id: number; lang: string }[]>`
      SELECT ucs.user_id, u.lang
      FROM sr_user_collection_subscriber ucs
      INNER JOIN sr_user u ON ucs.user_id = u.id
      WHERE ucs.collection_id = ${collectionId} AND ucs.subscription_end_time > ${new Date()}
    `
  }

  public async createUserCollectionSubscribePeriod(po: collectionSubscribePeriodPO) {
    return await this.prismaPg().sr_user_collection_subscriber_period.create({ data: { ...po, created_at: new Date() } })
  }

  public async getUserCollectionSubscribePeriodList(userId: number, collectionId: number): Promise<collectionSubscribePeriodPO[]> {
    const list = await this.prismaPg().sr_user_collection_subscriber_period.findMany({ where: { user_id: userId, collection_id: collectionId } })
    return list.map(item => ({ ...item, interval: item.interval as collectionIntervalType }))
  }

  public async getUserSubscribeCollection(userId: number, collectionId: number) {
    return await this.prismaPg().sr_user_collection_subscriber.findFirst({ where: { user_id: userId, collection_id: collectionId } })
  }

  public async upsertUserSubscribeCollection(po: collectionSubscribeInfoPO) {
    return await this.prismaPg().sr_user_collection_subscriber.upsert({
      where: { user_id_collection_id: { user_id: po.user_id, collection_id: po.collection_id } },
      create: { ...po, is_active: true, created_at: new Date(), updated_at: new Date() },
      update: { ...po, is_active: true, is_deleted: false, is_cancelled: false, updated_at: new Date() }
    })
  }

  public async updateSubscriberLastReadAt(userId: number, uuid: string, lastReadAt: Date) {
    return await this.prismaPg().$executeRaw`
      UPDATE sr_user_collection_subscriber
      SET last_read_at = ${lastReadAt}
      WHERE uuid = ${uuid} AND user_id = ${userId}
    `
  }

  public async recomputeSubscriberActive() {
    return await this.prismaPg().$executeRaw`
      UPDATE sr_user_collection_subscriber
      SET is_active = (subscription_end_time > now()), updated_at = now()
      WHERE is_active IS DISTINCT FROM (subscription_end_time > now())
    `
  }

  public async getUserSubscribeCollectionByCode(userId: number, code: string) {
    return await this.prismaPg().$queryRaw<collectionSubscriberInfoPO[]>`
      SELECT ucs.*, uc.show_marks, uc.allow_marks, uc.show_profile
      FROM sr_user_collection_subscriber ucs
      INNER JOIN (
        SELECT id, show_marks, allow_marks, show_profile
        FROM sr_user_collection 
        WHERE collection_code = ${code}
      ) uc ON ucs.collection_id = uc.id
      WHERE user_id = ${userId} 
      LIMIT 1;
    `
  }

  public async getUserSubscribeCollectionRecord(userId: number, collectionId: number) {
    return await this.prismaPg().sr_user_collection_subscriber.findFirst({ where: { user_id: userId, collection_id: collectionId } })
  }

  public async getUserCollectionSubscribeList(userId: number, page: number, pageSize: number): Promise<subscribedCollectionItem[]> {
    const offset = (page - 1) * pageSize
    const query = Prisma.sql`SELECT ucs.subscription_end_time, ucs.created_at AS subscribed_at, ucs.last_read_at, oc.type, oc.id, oc.owner_id, oc.display_name, oc.description, oc.status, oc.updated_at, oc.collection_code, ucs.is_cancelled FROM sr_user_collection oc
INNER JOIN (SELECT * FROM sr_user_collection_subscriber where user_id = ${userId} AND is_deleted = false limit ${pageSize} offset ${offset}) ucs on oc.id = ucs.collection_id`
    const list = await this.prismaPg().$queryRaw<subscribedCollectionItem[]>(query)
    return list.map(item => ({
      id: item.id,
      type: item.type,
      owner_id: item.owner_id,
      display_name: item.display_name,
      description: item.description,
      status: item.status,
      updated_at: item.updated_at,
      subscription_end_time: item.subscription_end_time,
      subscribed_at: item.subscribed_at,
      last_read_at: item.last_read_at,
      collection_code: item.collection_code,
      is_cancelled: item.is_cancelled
    }))
  }

  public async deleteUserSubscribeCollection(userId: number, collectionId: number) {
    return await this.prismaPg().sr_user_collection_subscriber.delete({ where: { user_id_collection_id: { user_id: userId, collection_id: collectionId } } })
  }

  public async deleteUserCollectionSubscribePeriod(userId: number, collectionId: number) {
    return await this.prismaPg().sr_user_collection_subscriber_period.deleteMany({
      where: {
        collection_id: collectionId,
        user_id: userId
      }
    })
  }

  public async updateUserCollectionSubscribeDeleted(userId: number, collectionId: number, isDeleted: boolean) {
    return await this.prismaPg().sr_user_collection_subscriber.update({
      data: { is_deleted: isDeleted, updated_at: new Date() },
      where: { user_id_collection_id: { user_id: userId, collection_id: collectionId } }
    })
  }

  public async getUserCollectionSubscriptions(userId: number) {
    return await this.prismaPg().sr_user_collection_subscriber.findMany({
      where: {
        user_id: userId
      }
    })
  }
}
