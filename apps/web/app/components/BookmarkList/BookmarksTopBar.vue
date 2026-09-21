<template>
  <!-- fork override：在 upstream 顶栏基础上增加订阅按钮 -->
  <header class="bookmarks-topbar">
    <div class="topbar-inner">
      <!-- 左侧：品牌名 + 主题切换 -->
      <div class="topbar-left">
        <button class="topbar-logo" @click="navigateTo('/bookmarks')" type="button">
          <img src="@images/icon-logo-bookmark.png" width="24" height="24" alt="Slax Reader" />
          {{ $t('common.app.name') }}
        </button>
        <ClientOnly><ThemeSwitcher /></ClientOnly>

        <!-- fork-only：PowerSync 状态指示（仅圆点 + 文案；同步完成后不再显示） -->
        <ClientOnly>
          <span v-if="syncStatus && syncStatus.key !== 'synced'" class="sync-status" :style="{ color: syncStatus.color }" :title="`PowerSync: ${syncStatus.label}`">
            <i class="sync-status-dot" :style="{ backgroundColor: syncStatus.color }"></i>
            {{ syncStatus.label }}
          </span>
        </ClientOnly>
      </div>

      <!-- 右侧：搜索框 + 订阅按钮（fork-only）+ 用户菜单 -->
      <div class="topbar-right">
        <BookmarksSearchBar :search-text="searchText" @search="onSearch" />

        <!-- fork-only：订阅按钮，仅在订阅到期时渲染，移动端隐藏 -->
        <button v-if="isSubscriptionExpired" class="topbar-subscribe-btn" type="button" @click="subscribeClick">
          {{ $t('common.operate.subscribe') }}
        </button>

        <BookmarksUserMenu @feedback="emit('feedback')" />
      </div>
    </div>
  </header>
</template>

<script lang="ts" setup>
import BookmarksSearchBar from '~/components/BookmarkList/BookmarksSearchBar.vue'
import BookmarksUserMenu from '~/components/BookmarkList/BookmarksUserMenu.vue'

import Subscription from '~/components/SubscriptionModal'
import { useUserStore } from '~/stores/user'

// Same props as the upstream bar so BookmarksLayout / pages can drive both; the fork bar has no sidebar toggle
withDefaults(
  defineProps<{
    searchText?: string
    sidebarToggle?: boolean
  }>(),
  { searchText: undefined, sidebarToggle: true }
)

const emit = defineEmits<{
  search: [keyword: string]
  feedback: []
}>()

const onSearch = (keyword: string) => {
  emit('search', keyword)
}

// fork-only：测试环境 PowerSync 连接状态（生产环境/非 local-first 时为 null，不渲染）
const { info: syncStatus } = useLocalSyncStatus()

// fork-only：订阅逻辑
const userStore = useUserStore()
const route = useRoute()

// setup 阶段同步缓存初始 hash（bookmarks/index.vue 的 query 清洗会把 hash 一并清掉）
const initialHash = route.hash

const isSubscriptionExpired = computed(() => userStore.isSubscriptionExpired && !userStore.isJustPaid)

const subscribeClick = () => {
  Subscription.showModal()
}

onMounted(() => {
  if (initialHash === '#subscribe') {
    useRouter().replace({ hash: '' })
    subscribeClick()
  }
})
</script>

<style lang="scss" scoped>
.bookmarks-topbar {
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

.topbar-left {
  --style: flex items-center gap-12px;
}

.topbar-logo {
  --style: flex items-center gap-10px font-serif font-500 text-brand text-txt cursor-pointer bg-transparent border-none p-0;

  img {
    flex-shrink: 0;
    display: block;
  }
}

.topbar-right {
  --style: flex items-center gap-16px;
}

/* fork-only：PowerSync 状态指示（紧凑：仅圆点 + 文案，无边框无底色，置于 logo 右侧） */
.sync-status {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 400;
  white-space: nowrap;
  flex-shrink: 0;

  .sync-status-dot {
    display: block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    flex-shrink: 0;
  }

  @media (max-width: 768px) {
    display: none;
  }
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

  @media (max-width: 768px) {
    display: none;
  }
}
</style>
