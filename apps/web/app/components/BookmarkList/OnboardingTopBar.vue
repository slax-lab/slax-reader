<template>
  <!-- fork override：加订阅按钮 -->
  <header class="onboarding-topbar">
    <div class="topbar-inner">
      <button class="topbar-logo" type="button" @click="navigateTo('/bookmarks')">
        <img src="@images/icon-logo-bookmark.png" width="24" height="24" alt="Slax Reader" />
        {{ $t('common.app.name') }}
      </button>

      <div class="topbar-actions">
        <!-- fork-only：订阅按钮 -->
        <button v-if="isSubscriptionExpired" class="topbar-subscribe-btn" type="button" @click="subscribeClick">
          {{ $t('common.operate.subscribe') }}
        </button>
        <BookmarksUserMenu @feedback="emit('feedback')" />
      </div>
    </div>
  </header>
</template>

<script lang="ts" setup>
import BookmarksUserMenu from '~/components/BookmarkList/BookmarksUserMenu.vue'

import Subscription from '~/components/SubscriptionModal'
import { useUserStore } from '~/stores/user'

const emit = defineEmits<{
  feedback: []
}>()

// fork-only：订阅逻辑
const userStore = useUserStore()
const isSubscriptionExpired = computed(() => userStore.isSubscriptionExpired && !userStore.isJustPaid)

const subscribeClick = () => {
  Subscription.showModal()
}
</script>

<style lang="scss" scoped>
.onboarding-topbar {
  --style: fixed top-0 left-0 right-0 z-50;
  height: var(--slax-header-height);
  background: var(--slax-topbar-bg);
  backdrop-filter: var(--slax-blur);
  border-bottom: 1px solid var(--slax-border);

  @media (max-width: 768px) {
    height: var(--slax-header-h-mobile);
  }
}

.topbar-inner {
  --style: h-full max-w-shell mx-auto px-28px flex items-center justify-between;
}

.topbar-logo {
  --style: flex items-center gap-10px font-serif font-500 text-brand text-txt cursor-pointer bg-transparent border-none p-0;
  letter-spacing: -0.02em;

  img {
    flex-shrink: 0;
    display: block;
  }
}

.topbar-actions {
  --style: flex items-center gap-16px;
}

/* fork-only：订阅按钮 */
.topbar-subscribe-btn {
  flex-shrink: 0;
  padding: 7px 16px;
  background: var(--slax-accent);
  color: var(--slax-btn-text);
  border: none;
  border-radius: var(--slax-radius-sm);
  font-size: 13px;
  font-weight: 500;
  font-family: inherit;
  cursor: pointer;
  white-space: nowrap;
  transition:
    opacity var(--slax-dur-normal),
    transform var(--slax-dur-normal);

  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
    opacity: 1;
  }
}
</style>
