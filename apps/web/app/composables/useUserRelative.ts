import Subscription from '@/components/SubscriptionModal'
import { type UserInfo } from '@commons/contracts/interface'

export const useUserSubscribe = () => {
  const isSubscriptionExpired = ref(true)

  const checkSubscriptionExpired = () => {
    if (isSubscriptionExpired.value) {
      Subscription.showModal()
      return true
    }

    return false
  }

  const updateSubscribeStatus = (user: UserInfo) => {
    isSubscriptionExpired.value = checkUserSubscribedIsExpired(user)
  }

  return {
    isSubscriptionExpired,
    checkSubscriptionExpired,
    updateSubscribeStatus
  }
}
