// inbox 空态三态判断
import { computed, type ComputedRef, type Ref, toValue, watch } from 'vue'

import { useOnboardingPending } from '~/composables/bookmark/useOnboardingPending'
import { useExtensionDetection } from '~/composables/useExtensionDetection'

export type InboxOnboardingState = 'A' | 'B' | 'C' | null

export const useInboxOnboardingState = (params: {
  isCurrentInboxTab: Ref<boolean> | ComputedRef<boolean>
  subscribedCount: Ref<number> | ComputedRef<number>
  subscriptionReady: Ref<boolean> | ComputedRef<boolean>
  isDataEmpty: Ref<boolean> | ComputedRef<boolean>
  isFirstLoad: Ref<boolean> | ComputedRef<boolean>
  userId: Ref<number | undefined> | ComputedRef<number | undefined>
}) => {
  const detection = useExtensionDetection()
  const onboarding = useOnboardingPending(params.userId)
  // 首次加载完成前不下结论，避免误判老用户
  const dataReady = computed(() => detection.checked.value && toValue(params.subscriptionReady) && !toValue(params.isFirstLoad))

  const inboxState = computed<InboxOnboardingState>(() => {
    if (!toValue(params.isCurrentInboxTab)) return null
    // 已装插件时 pending 标记失效，避免装完插件仍卡在 A
    if (onboarding.isPending.value && !detection.isInstalled.value) return 'A'
    if (!dataReady.value) return null
    // 已跳过/完成引导不再回退到 A
    if (onboarding.isDismissed.value) return detection.isInstalled.value ? 'C' : 'B'
    if (!detection.isInstalled.value) return toValue(params.subscribedCount) === 0 && toValue(params.isDataEmpty) ? 'A' : 'B'
    return 'C'
  })

  // immediate 取初始值
  watch(
    inboxState,
    state => {
      if (state === 'A' && !onboarding.isPending.value) onboarding.setPending()
    },
    { immediate: true }
  )

  // 非空或已装插件后自动清标记
  watch(
    () => onboarding.isPending.value && (!toValue(params.isDataEmpty) || (detection.checked.value && detection.isInstalled.value)),
    shouldClear => {
      if (shouldClear) onboarding.clearPending()
    },
    { immediate: true }
  )

  // 清 pending 并落终态，防止被重新判回 A
  const clearOnboardingPending = () => {
    onboarding.clearPending()
    onboarding.setDismissed()
  }

  return { inboxState, clearOnboardingPending }
}
