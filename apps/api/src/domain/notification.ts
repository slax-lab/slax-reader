import { UserRepo, noticeType } from '@/infra/repository/dbUser'
import { inject, injectable } from '@/decorators/di'
import { BookmarkRepo } from '@/infra/repository/dbBookmark'
import { CollectionRepo } from '@/infra/repository/dbCollection'
import { NotificationMessage } from '@/infra/message/notification'
import { i18n } from '@/const/i18n'
import { ContextManager } from '@/utils/context'
import { markDetailPO, markPOWithId, markType } from '@/infra/repository/dbMark'
import { markRequest } from '@/domain/mark'
import { authToken } from '@/middleware/auth'
import { randomUUID } from 'crypto'
import { selectDORegion } from '@/utils/location'
import { BookmarkNotFoundError, ServerError, ShareCodeNotFoundError, UserNotFoundError } from '@/const/err'

export interface UserNoticeListPO {
  id: number
  is_read: boolean
  title: string
  content: string
  quote_content: string
  icon: string
  username: string
  bookmark_title: string
  source: string
  object_data: {
    comment_id: number
    share_code: string
    collection_code: string
    collection_name: string
    bookmark_id: number
    cb_id: number
  }
  type: string
  created_at: Date
}

@injectable()
export class NotificationService {
  private userDataRepo: UserRepo
  private bmDataRepo: BookmarkRepo
  private pushInfra: NotificationMessage

  constructor(
    @inject(UserRepo) private userRepo: UserRepo,
    @inject(BookmarkRepo) private bookmarkRepo: BookmarkRepo,
    @inject(CollectionRepo) private collectionRepo: CollectionRepo,
    @inject(NotificationMessage) private notifyMessage: NotificationMessage
  ) {
    this.userDataRepo = userRepo
    this.bmDataRepo = bookmarkRepo
    this.pushInfra = notifyMessage
  }

  // 获取未读消息数量
  public async getUserUnreadCount(userId: number) {
    return await this.userRepo.getUserUnreadCount(userId)
  }

  // 增加在线设备
  public async addUserNoticeDevice(userId: number, type: noticeType, data: string) {
    return await this.userRepo.addUserPushDevice(userId, type, data)
  }

  // 使用websocket连接通知服务
  public async connectNotification(ctx: ContextManager, request: Request, token: string) {
    await authToken(ctx, token)
    await this.userRepo.requireActiveUser(ctx.getUserId())

    let pushToken = String(randomUUID())
    const headers = new Headers(request.headers)
    const locationHint = selectDORegion(request)
    const doId = ctx.env.WEBSOCKET_SERVER.idFromName('global')
    const stub = ctx.env.WEBSOCKET_SERVER.get(doId, { locationHint })

    const preSocket = await this.addUserNoticeDevice(ctx.getUserId(), noticeType.WEBSOCKET, JSON.stringify({ region: locationHint, uuid: pushToken }))

    headers.set('uuid', pushToken)
    headers.set('region', locationHint)
    headers.set('device_id', preSocket.id.toString())
    headers.set('user_id', ctx.getUserId().toString())
    console.log(`locationHint, user ${ctx.getUserId()} from ${request.cf?.country} match ${locationHint}, push uuid ${pushToken}`)

    return stub
      .fetch(
        new Request(request, {
          headers
        })
      )
      .catch(async e => {
        pushToken = ''
        console.log('fetch error', e)
        await this.userRepo.removeUserPushDevice(preSocket.id)
        return new Response(null, { status: 500 })
      })
      .finally(() => {
        pushToken.length > 0 && ctx.execution.waitUntil(this.notifyMessage.sendReminderWithDO(ctx.getUserId(), pushToken, stub))
      })
  }

  // 获取用户通知列表
  public async getUserNoticeList(ctx: ContextManager, page: number, pageSize: number) {
    const res = await this.userRepo.getInfoByUserId(ctx.getUserId())
    const lastReadAt = res.last_read_at || new Date(0)
    const list = await this.userRepo.getUserNotificationList(ctx.getUserId(), page, pageSize)

    const result: UserNoticeListPO[] = []
    for (const item of list) {
      if (item.created_at < lastReadAt) {
        item.is_read = true
      }
      const { quote_content, comment_id, share_code, avatar, bookmark_title, username, collection_code, collection_name, bookmark_id, cb_id } = JSON.parse(item.details)
      result.push({
        id: ctx.hashIds.encodeId(item.id),
        is_read: item.is_read,
        title: item.title,
        content: item.body,
        quote_content,
        icon: avatar,
        username,
        bookmark_title,
        source: item.source,
        object_data: {
          comment_id: ctx.hashIds.encodeId(comment_id),
          share_code,
          collection_code,
          collection_name,
          bookmark_id: ctx.hashIds.encodeId(bookmark_id),
          cb_id: ctx.hashIds.encodeId(cb_id)
        },
        type: item.type,
        created_at: item.created_at
      })
    }
    return result
  }

  // 更新用户上次时间
  public async updateUserReadAt(ctx: ContextManager) {
    await this.userRepo.updateUserReadAt(ctx.getUserId())

    ctx.execution.waitUntil(this.notifyMessage.sendUnreaderReminder(ctx))
    return
  }

  // 更新单条通知为已读
  public async updateUserNotificationRead(ctx: ContextManager, id: number) {
    await this.userRepo.updateUserNotificationRead(ctx.getUserId(), id)
    ctx.execution.waitUntil(this.notifyMessage.sendUnreaderReminder(ctx))
    return
  }

  // 创建评论、划线、回复通知
  public async createMarkNotification(env: Env, markInfo: markPOWithId, data: markRequest, userBookmark: any, replyToComment?: markDetailPO) {
    // 只有评论、回复生成通知，其他类型不生成通知
    if (![markType.COMMENT, markType.REPLY, markType.ORIGIN_COMMENT].includes(data.type)) return
    // 评论分享
    // 查询被通知的用户以及创建通知的用户
    const noticeUserId = replyToComment?.user_id || userBookmark.user_id
    const getUsersInfo = async () => {
      const [createUser, noticeUser] = await Promise.all([this.userRepo.getInfoByUserId(markInfo.user_id), this.userRepo.getInfoByUserId(noticeUserId)])
      return { createUser, noticeUser }
    }
    const { createUser, noticeUser } = await getUsersInfo()

    // do not send notification if the user is the same as the creator
    if (noticeUserId === markInfo.user_id) return

    // 根据被通知用户通知语言生成推送通知
    const noticeEntity = i18n(noticeUser.lang.substring(0, 2))
    const title = !!replyToComment
      ? noticeEntity.replyToYouTitle({
          user_name: createUser.name
        })
      : noticeEntity.commentToYouTitle({
          user_name: createUser.name
        })

    // 通知的数据
    let quoteContent = ''
    if (data.type === markType.REPLY) {
      quoteContent = replyToComment?.comment || ''
    } else if ([markType.COMMENT, markType.ORIGIN_COMMENT].includes(data.type)) {
      quoteContent = data.select_content.map(item => item.text).join('')
    }

    // 生成来源数据
    let sourceObj: any = {
      share_code: data.share_code
    }
    if (data.collection_code && data.cb_id) {
      sourceObj.collection_code = data.collection_code
      sourceObj.cb_id = userBookmark.id
    } else if (!data.share_code) {
      const shareBookmark = await this.bookmarkRepo.getBookmarkShareByBookmarkId(userBookmark.bookmark_id, userBookmark.user_id)
      if (!shareBookmark) {
        console.error(`get bookmark share failed: ${shareBookmark}`)
        return ShareCodeNotFoundError()
      }
      sourceObj.share_code = shareBookmark.share_code
    }

    // 获取书签信息
    const bookmark = await this.bookmarkRepo.getBookmarkById(userBookmark.bookmark_id)
    if (!bookmark) throw BookmarkNotFoundError()

    let notificationData = {
      type: !!replyToComment ? 'reply' : 'comment',
      source: sourceObj.cb_id ? 'collection' : 'share',
      title,
      body: data.comment || '',
      details: JSON.stringify({
        ...sourceObj,
        quote_content: quoteContent,
        comment_id: markInfo.id,
        avatar: createUser.picture,
        bookmark_title: bookmark.title,
        username: createUser.name
      }),
      created_at: new Date(),
      is_read: false,
      user_id: noticeUserId
    }

    const res = await this.userRepo.addUserNotice(notificationData)
    await this.notifyMessage.sendNotificationToUser(env, res)
  }

  public async createCollectionNotification(
    env: Env,
    type: 'subscribe' | 'unsubscribe',
    options: { ownerId: number; subscriberId: number; collectionName: string; collectionCode: string }
  ) {
    const [owner, subscriber] = await Promise.all([this.userRepo.getInfoByUserId(options.ownerId), this.userRepo.getInfoByUserId(options.subscriberId)])
    if (!owner) throw UserNotFoundError()
    if (!subscriber) throw UserNotFoundError()

    const noticeEntity = i18n(owner.lang.substring(0, 2))
    const title =
      type === 'subscribe'
        ? noticeEntity.hasNewCollectionSubscriber({
            user_name: subscriber.name,
            collection_name: options.collectionName
          })
        : noticeEntity.cancelCollectionSubscribe({
            user_name: subscriber.name,
            collection_name: options.collectionName
          })

    const notificationData = {
      type: type === 'subscribe' ? 'collection_subscriber' : 'collection_unsubscriber',
      source: 'collection',
      title,
      body: '',
      details: JSON.stringify({
        collection_code: options.collectionCode,
        collection_name: options.collectionName,
        avatar: subscriber.picture,
        username: subscriber.name
      }),
      created_at: new Date(),
      is_read: false,
      user_id: options.ownerId
    }

    const res = await this.userRepo.addUserNotice(notificationData)
    await this.notifyMessage.sendNotificationToUser(env, res)
  }

  // 被订阅 => 通知Publisher
  public async createSubscribeCollectionNotification(env: Env, options: { ownerId: number; subscriberId: number; collectionName: string; collectionCode: string }) {
    // return await this.createCollectionNotification(env, 'subscribe', options)
  }

  // 取消订阅 => 通知Publisher
  public async createUnsubscribeCollectionNotification(env: Env, options: { ownerId: number; subscriberId: number; collectionCode: string; collectionName: string }) {
    // return await this.createCollectionNotification(env, 'unsubscribe', options)
  }

  // 创建通知
  public async createMarkNotifications(env: Env, markInfo: markPOWithId, data: markRequest, userBookmark: any, replyToComment?: markDetailPO) {
    // try {
    //   // 评论的话，检查是否为自己评论自己的
    //   // 回复的话，检查是否为自己回复自己的
    //   if ([markType.COMMENT, markType.ORIGIN_COMMENT].includes(data.type) && userBookmark.user_id === markInfo.user_id) return
    //   if (data.type === markType.REPLY && replyToComment?.user_id === markInfo.user_id) return
    //   await this.createMarkNotification(env, markInfo, data, userBookmark, replyToComment)
    // } catch (e) {
    //   console.error(`create mark notification failed: ${e}`)
    //   throw ServerError()
    // }
  }

  // 订阅有更新的通知 => 通知Subscriber
  public async createSubscribeUpdateNotification(
    env: Env,
    options: { ownerId: number; subscriberId: number; collectionName: string; collectionCode: string; collectionId: number; userBookmarkId: number }
  ) {
    // 检查全部的订阅者
    const [owner, subscribers, bookmark] = await Promise.all([
      this.userDataRepo.getInfo({ id: options.ownerId }),
      this.collectionRepo.getCollectionNotifyUserEntity(options.collectionId),
      this.bmDataRepo.getUserBookmarkByUserBmId(options.userBookmarkId)
    ])
    if (!bookmark) {
      console.error(`bookmark not found: ${options.userBookmarkId}`)
      return
    }
    if (!owner) {
      console.error(`owner not found: ${options.ownerId}`)
      return
    }
    if (subscribers.length < 1) return

    const pushDatas = []
    const bookmark_title = bookmark.alias_title.length > 0 ? bookmark.alias_title : bookmark.bookmark.title
    for (const item of subscribers) {
      const title = i18n(item.lang.substring(0, 2)).collectionHasNewContent({
        collection_name: options.collectionName
      })
      const notificationData = {
        type: 'collection_update',
        source: 'collection',
        title,
        body: '',
        details: JSON.stringify({
          bookmark_id: options.userBookmarkId,
          collection_code: options.collectionCode,
          collection_name: options.collectionName,
          avatar: owner.picture,
          username: owner.name,
          bookmark_title
        }),
        created_at: new Date(),
        is_read: false,
        user_id: item.user_id
      }
      pushDatas.push(notificationData)
    }

    await this.userDataRepo.batchSaveNotificationData(pushDatas)
    await this.pushInfra.batchSendNotification(env, pushDatas)
  }
}
