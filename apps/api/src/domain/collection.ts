import type {
  ShareCollectionInfo as userShareCollectInfo,
  ShareCollectionItem as shareCollectionItem,
  ShareCollectionSubscription as shareCollectionSubscribeItem,
  MyShareCollectionInfo as myShareCollectInfo
} from '@slax-reader/contracts'
import {
  BookmarkNotFoundError,
  ShareCollectionAlreadySubscribedError,
  ShareCollectionClosedError,
  ShareCollectionNotFoundError,
  ShareCollectionNotSubscribedError,
  UserNotFoundError
} from '../const/err'
import { collectionIntervalType, CollectionRepo, collectionSubscribeInfoPO, subscriptionType } from '../infra/repository/dbCollection'
import { bookmarkPO, BookmarkRepo } from '../infra/repository/dbBookmark'
import { inject, injectable } from '../decorators/di'
import { UserRepo } from '../infra/repository/dbUser'
import { SubscriptionService } from './subscription'
import { ContextManager } from '@/utils/context'
import { hasActiveCollectionSubscription } from '@/utils/collectionAccess'
import { resolveBookmarkReadAccess } from '@/utils/bookmarkAccess'

export type { ShareCollectionInfo as userShareCollectInfo } from '@slax-reader/contracts'
export type { ShareCollectionItem as shareCollectionItem } from '@slax-reader/contracts'
export type { ShareCollectionSubscription as shareCollectionSubscribeItem } from '@slax-reader/contracts'
export type { UpdateShareCollectionRequest as updateUserShareCollectOption } from '@slax-reader/contracts'
export type { ShareCollectionSubscribeResponse as shareCollectionSubscribeInfo } from '@slax-reader/contracts'
export type { MyShareCollectionInfo as myShareCollectInfo } from '@slax-reader/contracts'

export interface collectionBookmarkItem extends bookmarkPO {
  mark_count: number
  first_mark: { content: string; comment: string; source: string } | null
}

@injectable()
export class CollectionService {
  constructor(
    @inject(CollectionRepo) private collectionRepo: CollectionRepo,
    @inject(UserRepo) private userRepo: UserRepo,
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo
  ) {}

  private async listReadableBookmarks(viewerId: number, ownerId: number, offset: number, limit: number) {
    const owner = await this.userRepo.getInfoByUserId(ownerId)
    if (!owner || owner.deleted_at) throw ShareCollectionNotFoundError()
    return this.bookmarkRepo.listUserStarBookmarksWithStatsByTargetUser(ownerId, offset, limit, viewerId)
  }

  // 获取分享的信息
  public async getShareCollectionInfo(ctx: ContextManager, shareCode: string, page = 1, pageSize = 10): Promise<userShareCollectInfo> {
    // 获取分享的collection
    const collection = await this.collectionRepo.getUserShareCollectByCode(shareCode)
    if (!collection) throw ShareCollectionNotFoundError()
    // 关闭态跳过列表拉取
    const isClosed = collection.status !== 1

    const offset = (page - 1) * pageSize
    const [sharerResult, statsResult] = await Promise.allSettled([this.userRepo.getInfo({ id: collection.owner_id }), this.collectionRepo.getCollectionStats(collection.id)])

    if (sharerResult.status === 'rejected') throw sharerResult.reason
    const sharer = sharerResult.value
    if (!sharer || sharer.deleted_at) throw ShareCollectionNotFoundError()
    if (statsResult.status === 'rejected') console.error(`collection stats failed: ${statsResult.reason}`)
    const stats = statsResult.status === 'fulfilled' ? statsResult.value : null

    const viewerId = ctx.getUserId()

    const resp = {
      collection_name: collection.display_name ?? '',
      publisher_name: sharer.name ?? '',
      publisher_avatar: sharer.picture ?? '',
      subscrition_end_time: '',
      description: collection.description ?? '',
      is_owner: viewerId > 0 && viewerId === collection.owner_id,
      status: collection.status
    }

    if (isClosed) {
      return {
        ...resp,
        subscrition_count: 0,
        list: [],
        bookmark_count: 0
      }
    }

    const [bookmarkList, bookmarkCount] = await Promise.all([
      this.listReadableBookmarks(viewerId, collection.owner_id, offset, pageSize),
      this.bookmarkRepo.countReadableCollectionBookmarks(collection.owner_id, viewerId)
    ])
    if (!sharer || !sharer.id) throw UserNotFoundError()

    const list: shareCollectionItem[] = bookmarkList.map(item => ({
      title: item.title ?? '',
      alias_title: item.alias_title ?? '',
      target_url: item.target_url ?? '',
      bookmark_uuid: item.bookmark_user_uuid,
      cb_id: ctx.hashIds.encodeId(item.id),
      site_name: item.site_name ?? '',
      mark_count: item.mark_count ?? 0,
      starred_at: item.starred_at ? new Date(item.starred_at).toISOString() : '',
      created_at: item.created_at ? new Date(item.created_at).toISOString() : '',
      first_mark: item.first_mark
    }))

    return {
      ...resp,
      subscrition_count: stats?.subscriber_count ?? 0,
      list,
      bookmark_count: bookmarkCount
    }
  }

  // 创建订阅信息
  public async createSubscribeInfo(
    ctx: ContextManager,
    collectionId: number,
    ownerId: number,
    type: collectionIntervalType,
    count: number,
    sourceId: string
  ): Promise<collectionSubscribeInfoPO> {
    const collectionDB = this.collectionRepo
    await collectionDB.createUserCollectionSubscribePeriod({
      source: sourceId,
      collection_id: collectionId,
      user_id: ctx.getUserId(),
      interval: type,
      type: subscriptionType.FREE_SUBSCRIBE,
      interval_count: count,
      created_at: new Date()
    })
    const periodList = await collectionDB.getUserCollectionSubscribePeriodList(ctx.getUserId(), collectionId)
    const endTime = SubscriptionService.calculationExpiredTimeByEntity(periodList)

    return await collectionDB.upsertUserSubscribeCollection({
      user_id: ctx.getUserId(),
      collection_id: collectionId,
      subscription_end_time: endTime,
      next_invoice_time: endTime,
      auto_renew: true,
      owner_id: ownerId
    })
  }

  // 删除订阅
  public async deleteUserCollectionSubscribe(ctx: ContextManager, collectCode: string): Promise<undefined> {
    const collection = await this.collectionRepo.getUserShareCollectByCode(collectCode)
    if (!collection) throw ShareCollectionNotFoundError()

    const subscribedUser = await this.collectionRepo.getUserSubscribeCollection(ctx.getUserId(), collection.id)
    if (!subscribedUser) throw ShareCollectionNotSubscribedError()

    await this.collectionRepo.updateUserCollectionSubscribeDeleted(ctx.getUserId(), collection.id, true)
  }

  // 获取用户订阅状态
  public async getUserCollectionSubscribed(ctx: ContextManager, collectCode: string): Promise<{ subscribed: boolean; end_time: string; cancelled: boolean; deleted: boolean }> {
    const collection = await this.collectionRepo.getUserShareCollectByCode(collectCode)
    if (!collection) throw ShareCollectionNotFoundError()

    const subscribedUser = await this.collectionRepo.getUserSubscribeCollection(ctx.getUserId(), collection.id)
    if (!subscribedUser) return { subscribed: false, end_time: '', cancelled: false, deleted: false }
    return {
      subscribed: !!subscribedUser && subscribedUser?.subscription_end_time.getTime() > Date.now(),
      end_time: subscribedUser?.subscription_end_time.toISOString() || '',
      cancelled: subscribedUser?.is_cancelled || false,
      deleted: subscribedUser?.is_deleted || false
    }
  }

  // 获取用户订阅了的收藏列表
  public async getUserCollectionSubscribedList(ctx: ContextManager, page: number, pageSize: number): Promise<shareCollectionSubscribeItem[]> {
    const collections = (await this.collectionRepo.getUserCollectionSubscribeList(ctx.getUserId(), page, pageSize)).map(item => ({
      id: ctx.hashIds.encodeId(item.id),
      type: item.type,
      code: item.collection_code,
      subscription_end_time: item.subscription_end_time.toISOString(),
      subscribed_at: item.subscribed_at.toISOString(),
      last_read_at: item.last_read_at?.toISOString() || '',
      display_name: item.display_name,
      description: item.description,
      status: item.status,
      updated_at: item.updated_at.toISOString(),
      owner_id: item.owner_id,
      cancelled: item.is_cancelled
    }))

    const userIds = collections.map(item => item.owner_id)
    const avatarRefs: Record<number, string> = {}
    const infos = await this.userRepo.getUserInfoList(userIds)
    infos
      .filter(info => info && !info.deleted_at)
      .forEach(info => {
        avatarRefs[info.id] = info.picture
      })

    return collections
      .filter(collection => Object.prototype.hasOwnProperty.call(avatarRefs, collection.owner_id))
      .map(collection => {
        const { owner_id, ...collectionWithoutOwnerId } = collection
        return {
          ...collectionWithoutOwnerId,
          avatar: avatarRefs[owner_id]
        }
      })
  }

  // 获取指定收藏列表
  public async getUserCollectionList(ctx: ContextManager, page: number, pageSize: number, collectionId: number): Promise<collectionBookmarkItem[]> {
    if (collectionId < 1) return []
    // 查询是否有订阅
    const subscribedUser = await this.collectionRepo.getUserSubscribeCollection(ctx.getUserId(), collectionId)
    if (!subscribedUser) return []
    const collection = await this.collectionRepo.getUserShareCollectById(collectionId)
    if (!hasActiveCollectionSubscription(subscribedUser, collection) || collection?.owner_id !== subscribedUser.owner_id) return []
    const offset = (page - 1) * pageSize
    const bookmarks = await this.listReadableBookmarks(ctx.getUserId(), subscribedUser.owner_id, offset, pageSize)
    return bookmarks.map(({ id, ...bookmark }) => ({ ...bookmark, id: ctx.hashIds.encodeId(id) }))
  }

  public async userHasCollection(ctx: ContextManager) {
    return await this.collectionRepo.getUserShareCollect(ctx.getUserId())
  }

  // 快照 footer 归属：作者开启中合集，否则 null
  public async getOwnerCollectionRef(ownerId: number): Promise<{ name: string; code: string } | null> {
    if (ownerId <= 0) return null
    const owner = await this.userRepo.getInfoByUserId(ownerId)
    if (!owner || owner.deleted_at) return null
    const c = await this.collectionRepo.getUserShareCollect(ownerId)
    if (!c || c.status !== 1) return null
    return { name: c.display_name ?? '', code: c.collection_code ?? '' }
  }

  // 快照 footer：开启中合集才归属
  public async getBookmarkCollectionRef(uuid: string): Promise<{ name: string; code: string } | null> {
    if (!uuid) return null
    const c = await this.collectionRepo.getBookmarkCollectionByUuid(uuid)
    if (!c || c.status !== 1) return null
    return { name: c.display_name ?? '', code: c.collection_code ?? '' }
  }

  // 公开端点：合集主人名+头像
  public async getCollectionOwnerInfo(code: string): Promise<{ code: string; nick_name: string; avatar: string } | null> {
    if (!code) return null
    const collection = await this.collectionRepo.getUserShareCollectByCode(code)
    if (!collection || collection.status !== 1) return null
    const info = await this.userRepo.getInfoByUserId(collection.owner_id)
    if (!info || info.deleted_at) return null
    return { code, nick_name: info.name ?? '', avatar: info.picture ?? '' }
  }

  // lastmod 只来自 last_modified_at；缺失时不输出
  public async listActiveCollectionsForSitemap(): Promise<Array<{ code: string; lastmod?: string }>> {
    const rows = await this.collectionRepo.listActiveCollectionsWithLastModified()
    return rows.map(r => (r.lastmod ? { code: r.collection_code, lastmod: r.lastmod.toISOString() } : { code: r.collection_code }))
  }

  // 未开启返回 null
  public async getMyShareCollectInfo(ctx: ContextManager): Promise<myShareCollectInfo | null> {
    const shareCollect = await this.collectionRepo.getUserShareCollect(ctx.getUserId())
    if (!shareCollect) return null
    const stats = await this.collectionRepo.getCollectionStats(shareCollect.id)
    return {
      show_name: shareCollect.display_name || '',
      avatar: shareCollect.avatar || '',
      description: shareCollect.description || '',
      starred_count: stats?.starred_count ?? 0,
      subscriber_count: stats?.subscriber_count ?? 0,
      collection_code: shareCollect.collection_code || '',
      status: shareCollect.status || 0,
      show_marks: shareCollect.show_marks || false,
      allow_marks: shareCollect.allow_marks || false,
      show_profile: shareCollect.show_profile || false
    }
  }

  public async userHasCollectionSubscribe(ctx: ContextManager) {
    return await this.collectionRepo.userHasCollectionSubscribe(ctx.getUserId())
  }

  public async getCollectionBookmarkInfo(collectionCode: string, cbId: number, viewerId = 0) {
    const collection = await this.collectionRepo.getUserShareCollectByCode(collectionCode)
    if (!collection) throw ShareCollectionNotFoundError()
    const owner = await this.userRepo.getInfoByUserId(collection.owner_id)
    if (!owner || owner.deleted_at) throw ShareCollectionNotFoundError()
    if (collection.status !== 1 && viewerId !== collection.owner_id) {
      const subscription = viewerId > 0 ? await this.collectionRepo.getUserSubscribeCollectionRecord(viewerId, collection.id) : null
      if (collection.status !== 0 || !subscription || subscription.is_deleted || subscription.subscription_end_time <= new Date()) throw ShareCollectionClosedError()
    }

    const res = await this.bookmarkRepo.getUserBookmarkByUserBmId(cbId)
    if (!res?.bookmark || res.user_id !== collection.owner_id || res.deleted_at || !res.is_starred) throw BookmarkNotFoundError()
    if (viewerId !== collection.owner_id) {
      const access = await resolveBookmarkReadAccess(this.bookmarkRepo, this.userRepo, viewerId, res.uuid)
      if (!access) throw BookmarkNotFoundError()
    }

    return {
      collectionInfo: collection,
      bookmarkInfo: res
    }
  }

  // 取消订阅
  public async unsubscribeUserCollection(ctx: ContextManager, collectCode: string) {
    const collection = await this.collectionRepo.getUserShareCollectByCode(collectCode)
    if (!collection) throw ShareCollectionNotFoundError()

    const subscribedUser = await this.collectionRepo.getUserSubscribeCollection(ctx.getUserId(), collection.id)
    if (!subscribedUser) throw ShareCollectionNotSubscribedError()

    await this.collectionRepo.deleteUserCollectionSubscribePeriod(ctx.getUserId(), collection.id)
    await this.collectionRepo.deleteUserSubscribeCollection(ctx.getUserId(), collection.id)
    return { collection }
  }

  // 订阅收藏
  public async subscribeUserCollection(ctx: ContextManager, collectCode: string) {
    const collection = await this.collectionRepo.getUserShareCollectByCode(collectCode)
    if (!collection) throw ShareCollectionNotFoundError()

    if (collection.status !== 1) throw ShareCollectionClosedError()

    // 检查是否已订阅并且未过期
    const subscribedUser = await this.collectionRepo.getUserSubscribeCollection(ctx.getUserId(), collection.id)
    if (subscribedUser && !subscribedUser.is_deleted && !subscribedUser.is_cancelled && subscribedUser.subscription_end_time > new Date()) {
      throw ShareCollectionAlreadySubscribedError()
    }

    const owner = await this.userRepo.getInfoByUserId(collection.owner_id)
    if (!owner || owner.deleted_at) throw ShareCollectionNotFoundError()
    await this.createSubscribeInfo(ctx, collection.id, collection.owner_id, collectionIntervalType.YEAR, 99, `slax_${Date.now()}`)
    return { collection }
  }

  public async recomputeSubscriberActiveStatus() {
    return await this.collectionRepo.recomputeSubscriberActive()
  }
}
