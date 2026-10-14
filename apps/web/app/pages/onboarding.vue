<template>
  <div class="onboarding-view">
    <OnboardingTopBar @feedback="feedbackClick" />
    <main class="onboarding-main">
      <BookmarksOnboardingHero v-if="!kocFlow.blocksOnboarding.value" @skip="finish" @complete="finish" />
    </main>
  </div>
</template>

<script lang="ts" setup>
import BookmarksOnboardingHero from '~/components/BookmarkList/BookmarksOnboardingHero.vue'
import OnboardingTopBar from '~/components/BookmarkList/OnboardingTopBar.vue'

import { showFeedbackModal } from '~/components/Modal'
import { useOnboardingPending } from '~/composables/bookmark/useOnboardingPending'
import { useKocPromotionFlow } from '~/composables/promotion/useKocPromotionFlow'
import { useUserStore } from '~/stores/user'

const { t } = useI18n()
const userStore = useUserStore()

useHead({
  titleTemplate: t('common.app.name')
})

const kocFlow = useKocPromotionFlow()
const route = useRoute()
const userId = kocFlow.userId
const { isPending, setDismissed } = useOnboardingPending(userId)

// Return to the root Inbox when no onboarding session is pending.
watch(
  [userId, isPending, kocFlow.blocksOnboarding],
  ([info, pending, blocked]) => {
    if (route.path === '/onboarding' && info && !pending && !blocked) navigateTo(kocFlow.returnTarget('/'), { replace: true })
  },
  { immediate: true }
)

userStore.getUserInfo({ refresh: true }).catch(() => {})

// Publish completion before returning to the cached Inbox.
const finish = () => {
  if (kocFlow.blocksOnboarding.value) return
  setDismissed()
  navigateTo(kocFlow.returnTarget('/'), { replace: true })
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
