import { inject, injectable } from '../decorators/di'
import type { LazyInstance } from '../decorators/lazy'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'
import { PRISIMA_HYPERDRIVE_CLIENT } from '../const/symbol'
import { UserRepo } from '../infra/repository/dbUser'

@injectable()
export class UserDeletionService {
  constructor(
    @inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<HyperdrivePrismaClient>,
    @inject(UserRepo) private userRepo: UserRepo
  ) {}

  public async ensureUserNotDeleted(userId: number): Promise<void> {
    await this.userRepo.requireActiveUser(userId)
  }

  public async cleanupUserData(userId: number): Promise<void> {
    console.log(`Starting data cleanup for user ${userId}`)
    if (userId < 1) {
      throw new Error(`Invalid userId: ${userId}`)
    }

    try {
      await this.prismaPg().$executeRaw`DELETE FROM sr_rss_subscription WHERE user_id = ${userId}`
      await this.prismaPg().$executeRaw`DELETE FROM sr_rss_save_job WHERE user_id = ${userId}`
      await this.prismaPg().sr_user_api_key.deleteMany({ where: { user_id: userId } })

      // Overview生成任务
      await this.deleteAigcBatchTasks(userId)

      // 用户发起的评论
      await this.deleteBookmarkComments(userId)

      // 用户触发的收藏重试
      await this.deleteBookmarkFetchRetry(userId)

      // 用户导入的内容及关联表
      await this.deleteBookmarkImports(userId)

      // 分享的bookmark
      await this.deleteBookmarkShares(userId)

      // Summary
      await this.deleteBookmarkSummaries(userId)

      // 绑定的TG等平台
      await this.deletePlatformBinds(userId)

      // 用户书签列表（必须在私有书签之前删除，因为有外键）
      await this.deleteUserBookmarks(userId)

      // 用户的私有内容
      await this.deletePrivateBookmarks(userId)

      // 用户Overview缓存
      await this.deleteBookmarkOverviews(userId)

      // Tag
      await this.deleteUserBookmarkTags(userId)

      // Collection相关（owner和subscriber）
      await this.deleteCollections(userId)

      // 通知
      await this.deleteNotifications(userId)

      // 订阅及订阅记录
      await this.deleteSubscriptions(userId)

      // 用户标签
      await this.deleteUserTags(userId)

      // 其他辅助表
      await this.deleteAuxiliaryData(userId)

      console.log(`Data cleanup completed for user ${userId}`)
    } catch (error) {
      console.error(`Error during data cleanup for user ${userId}:`, error)
      throw error
    }
  }

  private async deleteAigcBatchTasks(userId: number): Promise<void> {
    const result = await this.prismaPg().sr_aigc_batch_task.deleteMany({
      where: { user_id: userId }
    })
    console.log(`Deleted ${result.count} AIGC batch tasks`)
  }

  private async deleteBookmarkComments(userId: number): Promise<void> {
    const result = await this.prismaPg().sr_bookmark_comment.deleteMany({
      where: { user_id: userId }
    })
    console.log(`Deleted ${result.count} bookmark comments`)
  }

  private async deleteBookmarkFetchRetry(userId: number): Promise<void> {
    const result = await this.prismaPg().sr_bookmark_fetch_retry.deleteMany({
      where: { user_id: userId }
    })
    console.log(`Deleted ${result.count} fetch retry records`)
  }

  private async deleteBookmarkImports(userId: number): Promise<void> {
    // 先删除关联表
    const relationResult = await this.prismaPg().sr_bookmark_import_relation.deleteMany({
      where: { user_id: userId }
    })
    console.log(`Deleted ${relationResult.count} import relations`)

    // 再删除导入记录
    const importResult = await this.prismaPg().sr_bookmark_import.deleteMany({
      where: { user_id: userId }
    })
    console.log(`Deleted ${importResult.count} import records`)
  }

  private async deleteBookmarkShares(userId: number): Promise<void> {
    const result = await this.prismaPg().sr_bookmark_share.deleteMany({
      where: { user_id: userId }
    })
    console.log(`Deleted ${result.count} bookmark shares`)
  }

  private async deleteBookmarkSummaries(userId: number): Promise<void> {
    const result = await this.prismaPg().sr_bookmark_summary.deleteMany({
      where: { user_id: userId }
    })
    console.log(`Deleted ${result.count} summaries`)
  }

  private async deletePlatformBinds(userId: number): Promise<void> {
    const result = await this.prismaPg().sr_platform_bind.deleteMany({
      where: { user_id: userId }
    })
    console.log(`Deleted ${result.count} platform bindings`)
  }

  private async deleteUserBookmarks(userId: number): Promise<void> {
    // 先删除delete_bookmark关联表
    await this.prismaPg().sr_user_delete_bookmark.deleteMany({
      where: { user_id: userId }
    })

    // 再删除用户书签
    const result = await this.prismaPg().sr_user_bookmark.deleteMany({
      where: { user_id: userId }
    })
    console.log(`Deleted ${result.count} user bookmarks`)
  }

  private async deletePrivateBookmarks(userId: number): Promise<void> {
    const result = await this.prismaPg().sr_bookmark.deleteMany({
      where: { private_user: userId }
    })
    console.log(`Deleted ${result.count} private bookmarks`)
  }

  private async deleteBookmarkOverviews(userId: number): Promise<void> {
    const result = await this.prismaPg().sr_user_bookmark_overview.deleteMany({
      where: { user_id: userId }
    })
    console.log(`Deleted ${result.count} bookmark overviews`)
  }

  private async deleteUserBookmarkTags(userId: number): Promise<void> {
    const result = await this.prismaPg().sr_user_bookmark_tag.deleteMany({
      where: { user_id: userId }
    })
    console.log(`Deleted ${result.count} bookmark tags`)
  }

  private async deleteCollections(userId: number): Promise<void> {
    // 删除订阅记录期间
    await this.prismaPg().sr_user_collection_subscriber_period.deleteMany({
      where: { user_id: userId }
    })

    // 删除用户订阅的collection
    await this.prismaPg().sr_user_collection_subscriber.deleteMany({
      where: { user_id: userId }
    })

    // 删除订阅了该用户collection的记录（作为owner）
    const userCollections = await this.prismaPg().sr_user_collection.findMany({
      where: { owner_id: userId },
      select: { id: true }
    })

    for (const collection of userCollections) {
      await this.prismaPg().sr_user_collection_subscriber_period.deleteMany({
        where: { collection_id: collection.id }
      })
      await this.prismaPg().sr_user_collection_subscriber.deleteMany({
        where: { collection_id: collection.id }
      })
    }

    // 删除用户拥有的collection
    const result = await this.prismaPg().sr_user_collection.deleteMany({
      where: { owner_id: userId }
    })
    console.log(`Deleted ${result.count} collections and related data`)
  }

  private async deleteNotifications(userId: number): Promise<void> {
    // 删除通知设备
    await this.prismaPg().sr_user_notification.deleteMany({
      where: { user_id: userId }
    })
  }

  private async deleteSubscriptions(userId: number): Promise<void> {
    // 删除订阅记录
    await this.prismaPg().sr_user_subscription_period.deleteMany({
      where: { user_id: userId }
    })

    // 删除订阅
    const result = await this.prismaPg().sr_user_subscription.deleteMany({
      where: { user_id: userId }
    })
    console.log(`Deleted ${result.count} subscriptions`)
  }

  private async deleteUserTags(userId: number): Promise<void> {
    const result = await this.prismaPg().sr_user_tag.deleteMany({
      where: { user_id: userId }
    })
    console.log(`Deleted ${result.count} user tags`)
  }

  private async deleteAuxiliaryData(userId: number): Promise<void> {
    // 删除邀请记录
    await this.prismaPg().sr_user_invite.deleteMany({
      where: { user_id: userId }
    })

    // 删除活动领取记录
    await this.prismaPg().sr_user_receive_activity_record.deleteMany({
      where: { user_id: userId }
    })

    // 删除兑换码记录
    await this.prismaPg().sr_user_redeem_code.deleteMany({
      where: { user_id: userId }
    })

    console.log(`Deleted auxiliary data`)
  }
}
