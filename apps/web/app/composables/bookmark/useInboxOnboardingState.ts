// inbox 空态三态判断
import { computed, type ComputedRef, type Ref, ref, toValue, watch } from 'vue'

import { useOnboardingPending } from '~/composables/bookmark/useOnboardingPending'
import { useExtensionDetection } from '~/composables/useExtensionDetection'

export type InboxOnboardingState = 'A' | 'B' | 'C' | null

export const useInboxOnboardingState = (params: {
  isCurrentInboxTab: Ref<boolean> | ComputedRef<boolean>
  subscribedCount: Ref<number> | ComputedRef<number>
  subscriptionReady: Ref<boolean> | ComputedRef<boolean>
  isDataEmpty: Ref<boolean> | ComputedRef<boolean>
  isFirstLoad: Ref<boolean> | ComputedRef<boolean>
  onboardingReady?: Ref<boolean> | ComputedRef<boolean>
  confirmEmpty?: () => Promise<boolean>
  userId: Ref<number | undefined> | ComputedRef<number | undefined>
}) => {
  const detection = useExtensionDetection()
  const onboarding = useOnboardingPending(params.userId)
  // 首次加载完成前不下结论，避免误判老用户
  const dataReady = computed(
    () =>
      !!toValue(params.userId) &&
      detection.checked.value &&
      toValue(params.subscriptionReady) &&
      (params.onboardingReady ? toValue(params.onboardingReady) : !toValue(params.isFirstLoad))
  )

  const candidate = computed(
    () =>
      toValue(params.isCurrentInboxTab) &&
      dataReady.value &&
      !onboarding.isDismissed.value &&
      !detection.isInstalled.value &&
      toValue(params.subscribedCount) === 0 &&
      toValue(params.isDataEmpty)
  )
  const confirmedEmpty = ref<boolean | null>(null)
  if (params.confirmEmpty) {
    watch(
      [candidate, () => toValue(params.userId), () => getUserToken()],
      async ([eligible], _previous, onCleanup) => {
        let current = true
        onCleanup(() => {
          current = false
        })
        confirmedEmpty.value = null
        if (!eligible) return
        try {
          const empty = await params.confirmEmpty!()
          if (current) {
            confirmedEmpty.value = empty
            if (!empty) onboarding.clearPending()
          }
        } catch {
          // A failed read is unresolved, never proof of an empty library.
        }
      },
      { immediate: true, flush: 'sync' }
    )
  }

  const inboxState = computed<InboxOnboardingState>(() => {
    if (!toValue(params.isCurrentInboxTab)) return null
    // 已装插件时 pending 标记失效，避免装完插件仍卡在 A
    if (!dataReady.value) return null
    // 已跳过/完成引导不再回退到 A
    if (onboarding.isDismissed.value) return detection.isInstalled.value ? 'C' : 'B'
    if (!detection.isInstalled.value) {
      if (!candidate.value) return 'B'
      if (!params.confirmEmpty) return 'A'
      return confirmedEmpty.value === null ? null : confirmedEmpty.value ? 'A' : 'B'
    }
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
    () => onboarding.isPending.value && dataReady.value && (!toValue(params.isDataEmpty) || toValue(params.subscribedCount) > 0 || detection.isInstalled.value),
    shouldClear => {
      if (shouldClear) onboarding.clearPending()
    },
    { immediate: true }
  )

  // 清 pending 并落终态，防止被重新判回 A
  const clearOnboardingPending = () => {
    onboarding.setDismissed()
  }

  return { inboxState, clearOnboardingPending }
}
