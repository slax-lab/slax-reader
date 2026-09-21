import { SubscriptionType, type UserInfo } from '@commons/types/interface'

export const checkUserSubscribedIsExpired = (user: UserInfo) => {
  if (!user || !user.subscription_end_at) {
    return true
  }

  const endTime = new Date(user.subscription_end_at).getTime()
  return endTime < Date.now() || user.subscription_type === SubscriptionType.NO_SUBSCRIPTION
}
