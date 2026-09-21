<template>
  <div class="onboarding-view">
    <OnboardingTopBar @feedback="feedbackClick" />
    <main class="onboarding-main">
      <BookmarksOnboardingHero @skip="finish" @complete="finish" />
    </main>
  </div>
</template>

<script lang="ts" setup>
import BookmarksOnboardingHero from '~/components/BookmarkList/BookmarksOnboardingHero.vue'
import OnboardingTopBar from '~/components/BookmarkList/OnboardingTopBar.vue'

import { showFeedbackModal } from '~/components/Modal'
import { useOnboardingPending } from '~/composables/bookmark/useOnboardingPending'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const userStore = useUserStore()

useHead({
  titleTemplate: t('common.app.name')
})

const userId = computed(() => userStore.userInfo?.userId)
const { isPending, clearPending, setDismissed } = useOnboardingPending(userId)

// 无标记 → 退回 /bookmarks
watch(
  [() => userStore.userInfo, isPending],
  ([info, pending]) => {
    if (info && !pending) navigateTo('/bookmarks', { replace: true })
  },
  { immediate: true }
)

userStore.getUserInfo({ refresh: true })

// 清标记 + 落终态，回到 /bookmarks
const finish = () => {
  clearPending()
  setDismissed()
  navigateTo('/bookmarks', { replace: true })
}

const feedbackClick = () => {
  showFeedbackModal({
    reportType: 'parse_error',
    title: '',
    email: userStore.userInfo?.email || '',
    params: {
      entry_point: 'onboarding'
    }
  })
}
</script>

<style lang="scss" scoped>
.onboarding-view {
  min-height: 100vh;
}

.onboarding-main {
  padding-top: var(--slax-header-height);

  @media (max-width: 768px) {
    padding-top: var(--slax-header-h-mobile);
  }
}
</style>
