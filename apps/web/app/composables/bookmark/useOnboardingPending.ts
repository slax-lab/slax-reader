// onboarding 标记，按用户 id 存储
import { computed, type ComputedRef, type Ref, ref, toValue, watch } from 'vue'

const STORAGE_PREFIX = 'slax_onboarding_pending_'
const DISMISSED_PREFIX = 'slax_onboarding_dismissed_'

export const useOnboardingPending = (userId: Ref<number | undefined> | ComputedRef<number | undefined>) => {
  const storageKey = computed(() => {
    const id = toValue(userId)
    return id ? `${STORAGE_PREFIX}${id}` : null
  })
  const dismissedKey = computed(() => {
    const id = toValue(userId)
    return id ? `${DISMISSED_PREFIX}${id}` : null
  })

  // localStorage 非响应式
  const isPending = ref(false)
  const isDismissed = ref(false)
  watch(
    storageKey,
    key => {
      isPending.value = !!key && localStorage.getItem(key) === 'true'
    },
    { immediate: true }
  )
  watch(
    dismissedKey,
    key => {
      isDismissed.value = !!key && localStorage.getItem(key) === 'true'
    },
    { immediate: true }
  )

  const setPending = () => {
    if (!storageKey.value) return
    localStorage.setItem(storageKey.value, 'true')
    isPending.value = true
  }

  const clearPending = () => {
    if (!storageKey.value) return
    localStorage.removeItem(storageKey.value)
    isPending.value = false
  }

  // 跳过/完成引导的终态，避免死循环
  const setDismissed = () => {
    if (!dismissedKey.value) return
    localStorage.setItem(dismissedKey.value, 'true')
    isDismissed.value = true
  }

  return { isPending, isDismissed, setPending, clearPending, setDismissed }
}
