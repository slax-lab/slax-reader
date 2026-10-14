import { useUserStore } from '~/stores/user'

export const useSubscribeChecking = (params: { loadingText: string }) => {
  const userStore = useUserStore()
  const loadingText = params.loadingText
  const loadingTitle = ref(loadingText)
  const loadingInterval = ref<NodeJS.Timeout>()
  const checkingInterval = ref<NodeJS.Timeout>()

  const isSubscribed = computed(() => {
    return !userStore.isSubscriptionExpired
  })
  const isProcessing = computed(() => {
    return userStore.isSubscriptionExpired && userStore.isJustPaid
  })

  const enableChecking = () => {
    loadingInterval.value = setInterval(() => {
      const ellipses = loadingTitle.value.replace(loadingText, '')
      loadingTitle.value = `${loadingText}${Array.from({ length: (ellipses.length + 1) % 4 })
        .map(() => '.')
        .join('')}`
    }, 800)

    checkingInterval.value = setInterval(() => {
      userStore.refreshUserInfo()
    }, 5000)
  }

  const disableChecking = () => {
    clearInterval(checkingInterval.value)
    checkingInterval.value = undefined

    clearInterval(loadingInterval.value)
    loadingInterval.value = undefined
  }

  watch(
    () => isProcessing.value,
    (value, oldValue) => {
      if (value === oldValue) {
        return
      }

      if (value) {
        enableChecking()
      } else {
        disableChecking()
      }
    },
    {
      immediate: true
    }
  )

  onMounted(() => {})

  onUnmounted(() => {
    disableChecking()
  })

  return {
    loadingTitle,
    isSubscribed,
    isProcessing
  }
}
