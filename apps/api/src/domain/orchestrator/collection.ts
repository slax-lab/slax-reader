import { injectable } from '../../decorators/di'
import { ContextManager } from '@/utils/context'
import { CollectionService, updateUserShareCollectOption } from '../collection'
import { inject } from '../../decorators/di'
import { NotificationService } from '../notification'
import { BookmarkService, markDetail } from '../bookmark'
import { MarkService } from '../mark'
import { BookmarkTag, TagService } from '../tag'
import { UserService } from '../user'
import { shareCollectionSubscribeInfo } from '../collection'
import { CollectionRepo } from '../../infra/repository/dbCollection'
import { ShareCollectionNotFoundError } from '../../const/err'
import { UserRepo } from '../../infra/repository/dbUser'
import { LogsService } from '../logs'
import { resolveCollectionPolicy } from '@/utils/collectionPolicy'

export interface CBookmarkDetail {
  bookmark_id?: number
  bookmark_uuid?: string
  title: string
  alias_title?: string
  host_url: string
  target_url: string
  content_icon: string
  content_cover: string
  content?: string
  content_word_count?: number
  description?: string
  byline?: string
  status: string
  created_at?: Date
  updated_at?: Date
  marks: markDetail
  tags: BookmarkTag[]
  type: 'shortcut' | 'article'
  collection_info: {
    allow_action: boolean
    allow_line: boolean
    allow_comment: boolean
    owner_id: number
    collection_code: string
    cb_id: number
  }
  user_info?: {
    nick_name: string
    avatar: string
    show_userinfo: boolean
  }
}

// 注册 2 分钟内算新用户
const NEW_USER_WINDOW_SEC = 120

@injectable()
export class CollectionOrchestrator {
  constructor(
    @inject(CollectionService) private collectionService: CollectionService,
    @inject(BookmarkService) private bookmarkService: BookmarkService,
    @inject(MarkService) private markService: MarkService,
    @inject(TagService) private tagService: TagService,
    @inject(UserService) private userService: UserService,
    @inject(NotificationService) private notificationService: NotificationService,
    @inject(CollectionRepo) private collectionRepo: CollectionRepo,
    @inject(UserRepo) private userRepo: UserRepo,
    @inject(LogsService) private logsService: LogsService
  ) {}

  // 存秒数而非布尔，调阈值不必重新埋
  private async resolveSignupAge(userId: number): Promise<number | undefined> {
    try {
      const user = await this.userRepo.getInfo({ id: userId })
      if (!user?.created_at) return undefined
      return Math.floor((Date.now() - new Date(user.created_at).getTime()) / 1000)
    } catch {
      return undefined
    }
  }

  // 更新分享信息
  public async updateUserShareCollect(ctx: ContextManager, options: updateUserShareCollectOption) {
    const collection = await this.collectionRepo.getUserShareCollect(ctx.getUserId())
    if (!collection) throw ShareCollectionNotFoundError()

    await this.collectionRepo.updateUserShareCollectInfo(ctx.getUserId(), {
      name: options.name,
      show_marks: options.show_marks,
      allow_marks: options.allow_marks,
      show_profile: options.show_profile,
      avatar: options.avatar,
      description: options.description
    })
  }

  // 获取Collection详情
  public async getCollectionBookmarkDetail(ctx: ContextManager, collectionCode: string, cbId: number): Promise<CBookmarkDetail> {
    const res = await this.collectionService.getCollectionBookmarkInfo(collectionCode, cbId, ctx.getUserId())
    const { collectionInfo, bookmarkInfo } = res
    const share = await this.bookmarkService.getBookmarkShareByBookmarkId(bookmarkInfo.bookmark_id, bookmarkInfo.user_id)
    const bookmarkPolicy = resolveCollectionPolicy(share)

    // 批量加载数据
    const [contentResult, marksResult, tagsResult, userInfo] = await Promise.allSettled([
      this.bookmarkService.getBookmarkContent(bookmarkInfo.bookmark.content_key),
      this.markService.getBookmarkMarkList(ctx, { id: bookmarkInfo.id, isShowMarks: bookmarkPolicy.showMarks }),
      bookmarkPolicy.showProfile ? this.tagService.getBookmarkTags(ctx, collectionInfo.owner_id, bookmarkInfo.bookmark.id) : Promise.resolve([]),
      this.userService.getUserBriefInfo(bookmarkPolicy.showProfile, collectionInfo.owner_id)
    ])

    // concat return data
    const bookmarkWithoutId = { ...bookmarkInfo.bookmark }
    delete (bookmarkWithoutId as Partial<typeof bookmarkInfo.bookmark>).id
    delete (bookmarkWithoutId as Partial<typeof bookmarkInfo.bookmark>).content_key
    delete (bookmarkWithoutId as Partial<typeof bookmarkInfo.bookmark>).content_md_key
    delete (bookmarkWithoutId as Partial<typeof bookmarkInfo.bookmark>).private_user
    return {
      ...bookmarkWithoutId,
      bookmark_id: ctx.hashIds.encodeId(bookmarkInfo.bookmark.id),
      bookmark_uuid: bookmarkInfo.uuid,
      content: contentResult.status === 'fulfilled' ? contentResult.value : undefined,
      marks:
        marksResult.status === 'fulfilled' ? { ...marksResult.value, user_list: bookmarkPolicy.showProfile ? marksResult.value.user_list : {} } : { mark_list: [], user_list: {} },
      alias_title: bookmarkInfo.alias_title,
      tags: tagsResult.status === 'fulfilled' ? tagsResult.value : [],
      type: bookmarkInfo.type === 1 ? 'shortcut' : 'article',
      collection_info: {
        allow_action: bookmarkPolicy.allowLine || bookmarkPolicy.allowComment,
        allow_line: bookmarkPolicy.allowLine,
        allow_comment: bookmarkPolicy.allowComment,
        owner_id: ctx.hashIds.encodeId(collectionInfo.owner_id),
        collection_code: collectionCode,
        cb_id: ctx.hashIds.encodeId(cbId)
      },
      user_info:
        userInfo.status === 'fulfilled'
          ? {
              ...userInfo.value,
              show_userinfo: bookmarkPolicy.showProfile
            }
          : undefined
    }
  }

  // 取消订阅
  public async unsubscribeUserCollection(ctx: ContextManager, collectCode: string) {
    const res = await this.collectionService.unsubscribeUserCollection(ctx, collectCode)
    // 下发通知
    ctx.execution.waitUntil(
      this.notificationService.createUnsubscribeCollectionNotification(ctx.env, {
        ownerId: res.collection.owner_id,
        subscriberId: ctx.getUserId(),
        collectionCode: res.collection.collection_code,
        collectionName: res.collection.display_name
      })
    )
    ctx.execution.waitUntil(
      this.logsService.track(ctx.getUserId(), 'collection_unsubscribe', {
        platform: ctx.getPlatform(),
        collect_code: res.collection.collection_code
      })
    )
  }

  // Collection 订阅收藏
  public async subscribeUserCollection(ctx: ContextManager, collectCode: string, referrer?: string): Promise<shareCollectionSubscribeInfo> {
    const result = await this.collectionService.subscribeUserCollection(ctx, collectCode)
    ctx.execution.waitUntil(
      this.notificationService.createSubscribeCollectionNotification(ctx.env, {
        ownerId: result.collection.owner_id,
        subscriberId: ctx.getUserId(),
        collectionName: result.collection.display_name,
        collectionCode: result.collection.collection_code
      })
    )
    const collectionCode = result.collection.collection_code
    ctx.execution.waitUntil(
      this.resolveSignupAge(ctx.getUserId()).then(signupAgeSec =>
        this.logsService.track(ctx.getUserId(), 'collection_subscribe', {
          platform: ctx.getPlatform(),
          collect_code: collectionCode,
          signup_age_sec: signupAgeSec,
          is_new_user: signupAgeSec !== undefined ? signupAgeSec <= NEW_USER_WINDOW_SEC : undefined,
          referrer
        })
      )
    )
    return {
      subscribe: true
    }
  }
}
