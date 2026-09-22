import { SubscriptionType, type UserInfo } from '@commons/contracts/interface'

export const examineSideBarAction = async (type: string, userInfo: UserInfo | null) => {
  if (type === 'chat' || type === 'ai') {
    let res = true
    if (!userInfo) {
      res = false
    } else {
      res = !checkUserSubscribedIsExpired(userInfo)
    }

    if (!res) {
      window.open(`${process.env.PUBLIC_BASE_URL}/bookmarks#subscribe`, '_blank')
    }

    return res
  }

  return true
}

export const checkUserSubscribedIsExpired = (user: UserInfo) => {
  if (!user || !user.subscription_end_at) {
    return true
  }

  const endTime = new Date(user.subscription_end_at).getTime()
  return endTime < Date.now() || user.subscription_type === SubscriptionType.NO_SUBSCRIPTION
}
