import { platformBindType, UserRepo } from '@/infra/repository/dbUser'
import { subscriptionPO, SubscriptionRepo } from '@/infra/repository/dbSubscription'
import { CollectionRepo } from '@/infra/repository/dbCollection'
import { inject, injectable } from '@/decorators/di'
import { ContextManager } from '@/utils/context'

export interface userBindPlatformItem {
  platform: string
  user_name: string
  created_at: Date
}

export interface UserSubscription {
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
  subscription: UserSubscription
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

export enum SubscriptionType {
  NO_SUBSCRIPTION = 0,
  FREE_SUBSCRIPTION = 1,
  PAID_SUBSCRIPTION = 2
}

export function userSubscriptionInfo(env: Env, subscription?: subscriptionPO): UserSubscription {
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

// Profile and subscription reads without login, Passkey or OAuth dependencies. UserService delegates here.
@injectable()
export class UserProfileService {
  constructor(
    @inject(UserRepo) private userRepo: UserRepo,
    @inject(SubscriptionRepo) private subscriptionRepo: SubscriptionRepo,
    @inject(CollectionRepo) private collectionRepo: CollectionRepo
  ) {}

  public async getUserInfo(ctx: ContextManager): Promise<userInfo> {
    const [user, bindList, shareCollect, subInfoPO] = await Promise.all([
      this.userRepo.getInfoWithSubscription(ctx.getUserId()),
      this.userRepo.getUserBindPlatform(ctx.getUserId()),
      this.collectionRepo.getUserShareCollect(ctx.getUserId()),
      this.subscriptionRepo.getUserSubscriptionInfoPO(ctx.getUserId())
    ])

    const subInfo = userSubscriptionInfo(ctx.env, subInfoPO)
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
      platform: bindList
        .filter(item => item.platform !== platformBindType.NEWSLETTER)
        .map(item => {
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

  public async getUserSubscriptionInfo(ctx: ContextManager): Promise<UserSubscription> {
    const subscription = await this.subscriptionRepo.getUserSubscriptionInfoPO(ctx.getUserId())
    return userSubscriptionInfo(ctx.env, subscription)
  }
}
