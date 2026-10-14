import { ContextManager } from '@/utils/context'
import { UserRepo, userNoticePO, noticeType } from '@/infra/repository/dbUser'
import { inject, injectable } from '@/decorators/di'
import { SlaxWebSocketServer } from '@/infra/message/websocket'
import { bookmarkActionChangePO } from '@/infra/repository/dbBookmark'

@injectable()
export class NotificationMessage {
  constructor(@inject(UserRepo) private userRepo: UserRepo) {}

  /**
   * 推送红点数量提醒，不包含具体内容
   * @param ctx
   * @param env
   * @param userId
   */
  public async sendReminders(env: Env, payload: { id: number; data: string; unreadCount: number }) {
    const { region, uuid } = JSON.parse(payload.data)
    const doId = env.WEBSOCKET_SERVER.idFromName('global')
    const dObj = env.WEBSOCKET_SERVER.get(doId, { locationHint: region })
    const res = await dObj.sendReminder(uuid, payload.unreadCount)
    if (!res) {
      await this.removeUserNoticeDevice(env, payload.id)
    }
  }

  // 使用DO对象发送红点数量提醒
  public async sendReminderWithDO(userId: number, token: string, dObj: DurableObjectStub<SlaxWebSocketServer>) {
    const unreadCount = await this.userRepo.getUserUnreadCount(userId)
    return await dObj.sendReminder(token, unreadCount)
  }

  // 删除用户通知设备
  public async removeUserNoticeDevice(env: Env, id: number) {
    return await this.userRepo.removeUserPushDevice(id)
  }

  public async batchSendNotification(env: Env, payloads: userNoticePO[]) {
    try {
      console.log(`than send ${payloads.length} notifications`)
      for (const item of payloads) await this.sendNotificationToUser(env, item)
    } catch (e) {
      console.error(`batchSendNotification failed (count=${payloads.length}): ${e instanceof Error ? (e.stack ?? e.message) : e}`)
      return undefined
    }
  }

  public async sendNotificationToUser(env: Env, payload: userNoticePO) {
    try {
      await this.userRepo.requireActiveUser(payload.user_id)
      const devices = await this.userRepo.getUserOnlineDevice(payload.user_id)
      console.log('device.length', devices.length)
      const unreadCount = await this.userRepo.getUserUnreadCount(payload.user_id)
      const pushPromise = []
      for (const item of devices) {
        try {
          switch (item.type) {
            case noticeType.BROWSER:
              break
            case noticeType.APPLE:
              break
            case noticeType.TELEGRAM:
              break
            case noticeType.WEBSOCKET:
              pushPromise.push(this.sendReminders(env, { id: item.id, data: item.data, unreadCount }))
              break
          }
        } catch (e) {
          console.error(`send notification to user ${payload.user_id} failed: ${e}`)
        }
      }
      await Promise.all(pushPromise)
    } catch (e) {
      console.error(`sendNotificationToUser failed (userId=${payload.user_id}, type=${payload.type}): ${e instanceof Error ? (e.stack ?? e.message) : e}`)
      return undefined
    }
  }

  // 下发新的红点数据
  public async sendUnreaderReminder(ctx: ContextManager) {
    const pushPromise = []
    const [devices, unreadCount] = await Promise.all([this.userRepo.getUserOnlineDevice(ctx.getUserId()), this.userRepo.getUserUnreadCount(ctx.getUserId())])
    for (const item of devices) {
      if (item.type === noticeType.WEBSOCKET) {
        pushPromise.push(this.sendReminders(ctx.env, { id: item.id, data: item.data, unreadCount: unreadCount }))
      }
    }
    await Promise.all(pushPromise)
  }

  // 下发新的书签收藏记录更新数据
  public async sendBookmarkChange(env: Env, payload: bookmarkActionChangePO) {
    try {
      const doId = env.WEBSOCKET_SERVER.idFromName('global')
      const dObj = env.WEBSOCKET_SERVER.get(doId)
      await dObj.sendBookmarkChange(payload)
    } catch (e) {
      console.log(`send bookmark change failed: ${e}`)
    }
  }
}
