import { ref } from 'vue'

import { isClient } from '@commons/frontend-utils/is'

import type { CommonBookmarkOptions } from './type'
import { useResize } from './useCommon'
import type { UserInfo } from '@slax-reader/contracts/interface'
import type { QuoteData } from '~/components/Chat/type'
import { showLoginModal } from '~/components/Modal'
import { useUserStore } from '~/stores/user'

// duck-typing 接口：SnapshotChatPanel 与旧 ChatBot 都满足，避免绑死具体组件类型
interface ChatBotLike {
  addQuoteData: (data: QuoteData) => void
  focusTextarea: () => void
}

interface BookmarkOptions extends CommonBookmarkOptions {
  chatbot: Ref<ChatBotLike | undefined>
  typeOptions: () => BookmarkTypeOptions
  initialRequestTask?: () => Promise<void>
  initialTasksCompleted?: () => void
}

export const useBookmark = (options: BookmarkOptions) => {
  const y = (() => {
    return isClient ? useScroll(window, { behavior: 'smooth', throttle: 10 }).y : ref(0)
  })()

  const userStore = useUserStore()
  const user = ref<UserInfo | null>(userStore.userInfo)
  const redirectHref = useRequestURL().href
  const { isSubscriptionExpired, checkSubscriptionExpired, updateSubscribeStatus } = useUserSubscribe()

  const { chatbot, typeOptions } = options
  const { resizeAnimated, summariesExpanded, botExpanded, onResizeObserver, contentXOffset, isLocked, isNeedResized } = useResize(options)

  const feedbackType = ref('parse_error')
  const showFeedback = () => {
    const options = typeOptions()

    showFeedbackView(options, feedbackType.value)
  }

  // 返回 boolean：true = 成功打开/切换；false = 被登录或订阅校验拦截
  // 调用方可据此判断是否回退 activePanel（防止侧栏高亮但内容被拦截）
  const showAnalyzed = (): boolean => {
    if (!loginVerify() || checkSubscriptionExpired()) {
      return false
    }

    botExpanded.value = false
    summariesExpanded.value = !summariesExpanded.value

    if (summariesExpanded.value) {
      const options = typeOptions()
      logAnalyzed(options, userStore.user?.userId || 0)
    }
    return true
  }

  const showChatbot = (): boolean => {
    if (!loginVerify() || checkSubscriptionExpired()) {
      return false
    }

    summariesExpanded.value = false
    botExpanded.value = !botExpanded.value

    if (botExpanded.value) {
      const options = typeOptions()
      logChat(options, userStore.user?.userId || 0)
    }
    return true
  }

  const chatBotQuote = (data: QuoteData) => {
    if (!loginVerify() || checkSubscriptionExpired()) {
      return
    }

    const handleQuote = () => {
      if (!botExpanded.value) {
        botExpanded.value = true
      }
      // 如果没打开chatbot侧边栏，不生成问题，直接push到对话框
      // 如果已经打开了且在对话中，push到对话框但是不能发送
      // 如果已经打开了且没在对话中，push到对话框
      chatbot.value?.addQuoteData(data)
    }

    nextTick(() => handleQuote())
  }

  const navigateToBookmarks = () => {
    navigateTo('/bookmarks', {
      replace: true
    })
  }

  const navigateToText = () => {
    if (options.detailLayout?.value?.isSmallScreen()) {
      summariesExpanded.value = false
    }
  }

  const navigateToNotification = () => {
    navigateTo('/bookmarks?filter=notifications', {})
  }

  const screenLockUpdate = (lock: boolean) => {
    isLocked.value = lock
  }

  const backToTop = () => {
    y.value = 0
  }

  const loginVerify = () => {
    if (user.value) {
      return true
    }

    showLoginModal({
      redirect: redirectHref
    })

    return false
  }

  const tasks: Promise<void>[] = []
  if (isClient) {
    tasks.push(
      (async () => {
        if (!userStore.isLogin) {
          return
        }

        const res = await userStore.getUserInfo()
        if (!res) return

        user.value = res
        const refreshedUserInfo = await userStore.getUserInfo({ refresh: true })
        updateSubscribeStatus(refreshedUserInfo)
      })()
    )

    try {
      const options = typeOptions()
      useLogBookmark(options)
    } catch (error) {
      console.error('Error in initial bookmark tasks:', error)
    }
  }

  if (options.initialRequestTask) {
    tasks.push(options.initialRequestTask())
  }

  Promise.allSettled(tasks).then(() => {
    setTimeout(() => {
      options?.initialTasksCompleted && options.initialTasksCompleted()
    }, 0)
  })

  return {
    user,
    isSubscriptionExpired,
    redirectHref,
    resizeAnimated,
    summariesExpanded,
    botExpanded,
    contentXOffset,
    isNeedResized,
    onResizeObserver,
    showAnalyzed,
    showChatbot,
    chatBotQuote,
    showFeedback,
    backToTop,
    loginVerify,
    screenLockUpdate,
    navigateToNotification,
    navigateToBookmarks,
    navigateToText
  }
}
