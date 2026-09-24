<template>
  <!-- 竖向导航侧边栏：替代原横向 tab 列表 -->
  <nav class="tabs-sidebar" :class="{ collapsed }" ref="sidebarEl">
    <!-- 主导航项；title 供折叠态悬停提示 -->
    <button
      v-for="(item, index) in tabList"
      :key="item.type"
      class="sidebar-item"
      :class="{ active: tabType === item.type }"
      :title="item.title"
      @click="inboxClick(item.type, index)"
      type="button"
    >
      <!-- viewBox 随 icon 自带 -->
      <svg class="item-icon" width="18" height="18" :viewBox="item.icon.viewBox" fill="none" stroke="currentColor" stroke-width="1.5" v-html="item.icon.markup" />
      <span>{{ item.title }}</span>
    </button>

    <!-- 分隔线 -->
    <div class="sidebar-divider" />

    <!-- 废纸篓 -->
    <button class="sidebar-item" :class="{ active: tabType === 'trashed' }" :title="$t('page.bookmarks_index.Trash')" @click="inboxClick('trashed')" type="button">
      <svg class="item-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <polyline points="3 6 5 6 21 6" />
        <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
      </svg>
      <span>{{ $t('page.bookmarks_index.Trash') }}</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { useSidebarCollapsed } from '~/composables/bookmark/useSidebarCollapsed'
import { useLabFeatures } from '~/composables/useLabFeatures'

// BookmarkTabTypes 和 TabIcons 由 Nuxt auto-import 注入
// 不显式 import，以便 fork 对 useBookmarkRelative 的 override 能通过 layer 优先级生效
const { t } = useI18n()
const sidebarEl = ref<HTMLElement>()
const { collapsed } = useSidebarCollapsed()
const labs = useLabFeatures()
onMounted(() => {
  void labs.fetch().catch(() => {})
})

defineProps({
  tabType: {
    type: String,
    default: 'inbox'
  }
})

const emits = defineEmits(['changeTab'])

const FALLBACK_ICON = { viewBox: '0 0 24 24', markup: '' }

const tabList = computed(() =>
  BookmarkTabTypes.flatMap(type => {
    const item = { type, title: t(`page.bookmarks_index.${type}`), icon: TabIcons[type] ?? FALLBACK_ICON }
    if (type !== 'inbox' || !labs.loaded.value || !labs.isEnabled('rss')) return [item]
    return [
      item,
      { type: 'rss', title: t('rss.title'), icon: { viewBox: '0 0 24 24', markup: '<path d="M4 11a9 9 0 0 1 9 9M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/>' } }
    ]
  })
)

const inboxClick = (type: string, index?: number) => {
  emits('changeTab', type, index)
}

// 供父组件调用，用于 scrollIntoView 定位
const getAllButtons = () => {
  return sidebarEl.value?.querySelectorAll('button') || []
}

defineExpose({
  getAllButtons
})
</script>

<style lang="scss" scoped>
.tabs-sidebar {
  --style: w-full flex flex-col;
  padding: 40px 16px 24px;
  gap: 4px;

  // ≤768：横向类型栏，居中排布
  @media (max-width: 768px) {
    flex-direction: row;
    align-items: center;
    width: max-content;
    margin: 0 auto;
    padding: 0;
    gap: 24px;
  }

  // 折叠态（仅桌面端）：只显示图标，居中排列
  @media (min-width: 921px) {
    &.collapsed {
      padding-left: 12px;
      padding-right: 12px;

      .sidebar-item {
        justify-content: center;
        padding: 10px 0;
        gap: 0;

        span {
          display: none;
        }
      }

      .sidebar-divider {
        margin: 12px 8px;
      }
    }
  }
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 14px;
  border-radius: var(--slax-radius-sm, 8px);
  border: none;
  background: transparent;
  font-size: 14px;
  color: var(--slax-text-muted);
  cursor: pointer;
  transition: all 0.15s;
  text-align: left;
  width: 100%;
  font-family: inherit;

  &:hover {
    color: var(--slax-text);
    background: var(--slax-accent-bg);
  }

  &.active {
    color: var(--slax-accent);
    font-weight: 500;
    background: var(--slax-accent-bg);
  }

  // ≤768：纯文字 tab，选中加下划线
  @media (max-width: 768px) {
    position: relative;
    flex: 0 0 auto;
    width: auto;
    min-height: 44px;
    padding: 0;
    gap: 0;
    border-radius: 0;
    background: transparent;
    color: var(--slax-text-light);
    line-height: 44px;
    white-space: nowrap;

    &:hover {
      background: transparent;
      color: var(--slax-text-muted);
    }

    &.active {
      background: transparent;
      color: var(--slax-text);

      &::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        bottom: 0;
        height: 2px;
        border-radius: 1px;
        background: var(--slax-accent);
      }
    }
  }
}

.item-icon {
  flex-shrink: 0;
  opacity: 0.8;

  .active & {
    opacity: 1;
  }

  @media (max-width: 768px) {
    display: none;
  }
}

.sidebar-divider {
  height: 1px;
  background: var(--slax-border);
  margin: 12px 14px;

  @media (max-width: 768px) {
    display: none;
  }
}
</style>
