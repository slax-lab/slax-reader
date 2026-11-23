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
  // The identity a finished check ended under. A check that fails invalidates the server user itself, and that
  // generation change must not start another check, or a failure would be retried without end.
  let settled: { generation: number; accountKey: string | null } | undefined

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

  // Follow-up checks started because the identity changed under a check; bounded so a flapping identity cannot
  // keep the page requesting. An explicit retry starts a new series.
  const MAX_FOLLOW_UPS = 2
  const check = (followUps: number): Promise<void> => {
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
      if (pending?.promise !== promise) return
      pending = undefined
      const current = account.context.value
      settled = { generation: current.generation, accountKey: current.accountKey }
      // The identity changed while this check ran (a rotated token, for example) and it ended without a decision,
      // so its result could not be adopted. A failure stops here and waits for an explicit retry.
      if (disposed || !store.isLogin || current.accountKey !== accountKey || current.generation === generation) return
      if (profile.value || error.value) return
      if (followUps < MAX_FOLLOW_UPS) void check(followUps + 1)
      else error.value = new Error('The account identity kept changing during the subscription check')
    })
    pending = { generation, accountKey, promise }
    return promise
  }
  const refreshSubscription = (): Promise<void> => check(0)

  watch(() => account.context.value.generation, () => { error.value = undefined }, { flush: 'sync' })
  // Wait until the account context has updated both its key and generation. A generation change for the same
  // account (token refresh, identity invalidation) also needs a check, or the decision would stay pending.
  watch([() => account.context.value.accountKey, () => account.context.value.generation], ([key, generation], [previousKey]) => {
    if (!key || !store.isLogin) return
    // A confirmed profile for the same account still decides.
    if (key === previousKey && profile.value) return
    // A running check for this account settles the decision itself.
    if (pending?.accountKey === key) return
    if (settled?.accountKey === key && settled.generation === generation) return
    void refreshSubscription()
  })
  onScopeDispose(() => { disposed = true })

  return { isSubscriptionExpired, subscriptionStatus, checkSubscriptionExpired, refreshSubscription }
}
