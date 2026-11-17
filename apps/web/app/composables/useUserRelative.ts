import { computed, onScopeDispose, shallowRef, watch } from 'vue'

import { checkUserSubscribedIsExpired } from '~/utils/userRelative'

import Subscription from '@/components/SubscriptionModal'
import { useAccountContext } from '~/composables/useAccountContext'
import { useUserStore } from '~/stores/user'

export type SubscriptionStatus = 'pending' | 'active' | 'inactive' | 'error'

export const useUserSubscribe = () => {
  const store = useUserStore()
  const account = useAccountContext()
  const error = shallowRef<unknown>()
  let disposed = false
  let pending: { generation: number; accountKey: string | null; promise: Promise<void> } | undefined

  const profile = computed(() => {
    const context = account.context.value
    return context.status === 'ready' && store.userInfo?.userId === context.serverUserId ? store.userInfo : null
  })
  const subscriptionStatus = computed<SubscriptionStatus>(() => {
    if (profile.value) return checkUserSubscribedIsExpired(profile.value) ? 'inactive' : 'active'
    return error.value ? 'error' : 'pending'
  })
  // Unknown data cannot mount a protected panel, but only confirmed inactivity prompts an upgrade.
  const isSubscriptionExpired = computed(() => subscriptionStatus.value !== 'active')
  const checkSubscriptionExpired = () => {
    if (subscriptionStatus.value === 'inactive') Subscription.showModal()
    return subscriptionStatus.value !== 'active'
  }

  const refreshSubscription = (): Promise<void> => {
    const { generation, accountKey } = account.context.value
    if (pending?.generation === generation && pending.accountKey === accountKey) return pending.promise
    error.value = undefined
    const promise: Promise<void> = (async () => {
      try {
        await store.refreshServerUserInfo()
      } catch (reason) {
        if (!disposed && account.context.value.accountKey === accountKey && store.isLogin) error.value = reason
      }
    })().finally(() => {
      if (pending?.promise === promise) pending = undefined
    })
    pending = { generation, accountKey, promise }
    return promise
  }

  watch(() => account.context.value.generation, () => { error.value = undefined }, { flush: 'sync' })
  // Wait until the account context has updated both its key and generation.
  watch(() => account.context.value.accountKey, key => {
    if (key && store.isLogin) void refreshSubscription()
  })
  onScopeDispose(() => { disposed = true })

  return { isSubscriptionExpired, subscriptionStatus, checkSubscriptionExpired, refreshSubscription }
}
