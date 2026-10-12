<template>
  <!-- 顶栏内嵌搜索框：支持历史记录下拉、回车搜索、Esc 收起 -->
  <!-- click-outside 绑在容器上，避免 input focus 时被误判为外部点击导致历史闪烁 -->
  <div class="topbar-search" :class="{ focused: isFocused }" ref="searchWrap" v-on-click-outside="onClickOutside">
    <!-- 搜索图标 -->
    <svg class="search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="11" cy="11" r="8" />
      <path d="M21 21l-4.35-4.35" />
    </svg>

    <!-- 搜索输入框 -->
    <input
      v-ime-guard
      class="search-input"
      :placeholder="$t('page.bookmarks_index.search_placeholder')"
      v-model="keyword"
      @focus="onFocus"
      @keydown.enter="doSearch"
      @keydown.esc="closeSearch"
    />

    <!-- 清除按钮 -->
    <button class="search-clear" v-show="keyword" @mousedown.prevent="clearKeyword" type="button">
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M18 6L6 18M6 6l12 12" />
      </svg>
    </button>

    <!-- 历史记录下拉 -->
    <Transition name="search-dropdown">
      <div class="search-history" v-if="showHistory">
        <div class="search-history-header">
          <span>{{ $t('page.bookmarks_index.search_history_title') }}</span>
          <button class="history-clear-btn" @click="clearHistory" type="button">
            {{ $t('page.bookmarks_index.search_history_clear') }}
          </button>
        </div>
        <div class="search-history-list">
          <button v-for="item in historyList" :key="item" class="history-item" @mousedown.prevent="selectHistory(item)" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10" />
              <polyline points="12 6 12 12 16 14" />
            </svg>
            <span>{{ item }}</span>
          </button>
        </div>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { vOnClickOutside } from '@vueuse/components'

// The page's current search text; when it changes (a ?q= handoff, or "back" out of a search) the box follows
const props = defineProps<{
  searchText?: string
}>()

const emit = defineEmits<{
  search: [keyword: string]
}>()

// 搜索关键词
const keyword = ref('')
// 输入框聚焦状态（控制边框高亮）
const isFocused = ref(false)
// 历史下拉显示状态
const showHistory = ref(false)
// 历史记录列表（最多 5 条）
const historyList = ref<string[]>([])

const HISTORY_KEY = 'slax-reader.search-history'
const MAX_HISTORY = 5

// 从 localStorage 读取历史记录
const loadHistory = () => {
  if (!import.meta.client) return
  try {
    const raw = localStorage.getItem(HISTORY_KEY)
    historyList.value = raw ? JSON.parse(raw) : []
  } catch {
    historyList.value = []
  }
}

// 写入历史记录（去重 + 最多 5 条）
const saveHistory = (text: string) => {
  if (!import.meta.client || !text.trim()) return
  const list = historyList.value.filter(item => item !== text)
  list.unshift(text)
  historyList.value = list.slice(0, MAX_HISTORY)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(historyList.value))
}

// 清空历史记录
const clearHistory = () => {
  historyList.value = []
  if (import.meta.client) {
    localStorage.removeItem(HISTORY_KEY)
  }
  showHistory.value = false
}

// 聚焦时：若无输入且有历史则展开下拉
const onFocus = () => {
  isFocused.value = true
  loadHistory()
  if (!keyword.value && historyList.value.length > 0) {
    showHistory.value = true
  }
}

// 收起搜索（Esc 或点击外部）
const closeSearch = () => {
  isFocused.value = false
  showHistory.value = false
}

// 点击容器外部时收起
const onClickOutside = () => {
  closeSearch()
}

// 执行搜索：写入历史 + emit + 收起下拉
const doSearch = () => {
  const text = keyword.value.trim()
  if (!text) return
  saveHistory(text)
  showHistory.value = false
  emit('search', text)
}

// 点击历史条目：填入并搜索
const selectHistory = (item: string) => {
  keyword.value = item
  showHistory.value = false
  saveHistory(item)
  emit('search', item)
}

// 清除输入
const clearKeyword = () => {
  keyword.value = ''
  emit('search', '')
}

watch(
  () => props.searchText,
  value => {
    if (value !== undefined) keyword.value = value
  }
)

onMounted(() => {
  loadHistory()
})
</script>

<style lang="scss" scoped>
.topbar-search {
  position: relative;
  display: flex;
  align-items: center;
  gap: 8px;
  width: 280px;
  padding: 7px 14px;
  border: 1px solid var(--slax-border);
  border-radius: 10px;
  background: var(--slax-surface);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  cursor: text;
  transition: all 0.2s;

  &:hover {
    border-color: color-mix(in srgb, var(--slax-accent) 30%, var(--slax-border));
  }

  &.focused {
    border-color: var(--slax-accent);
    box-shadow: 0 0 0 3px var(--slax-accent-bg);
  }

  // ≤860px 隐藏搜索框
  @media (max-width: 860px) {
    display: none;
  }
}

.search-icon {
  color: var(--slax-text-light);
  flex-shrink: 0;
}

.search-input {
  flex: 1;
  min-width: 0;
  background: transparent;
  border: none;
  outline: none;
  font-size: 14px;
  color: var(--slax-text);
  font-family: inherit;
  padding: 0;

  &::placeholder {
    color: var(--slax-text-light);
    font-weight: 400;
  }
}

.search-clear {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  padding: 0;
  border: none;
  background: transparent;
  color: var(--slax-text-light);
  cursor: pointer;
  border-radius: 50%;
  flex-shrink: 0;
  transition:
    color 0.15s,
    background 0.15s;

  svg {
    display: block;
  }

  &:hover {
    background: var(--slax-accent-bg);
    color: var(--slax-text);
  }
}

.search-history {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  right: 0;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow:
    var(--slax-shadow-warm),
    0 12px 36px color-mix(in srgb, var(--slax-accent) 12%, transparent);
  padding: 6px;
  z-index: 200;
}

.search-history-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 4px 10px 6px;

  span {
    font-size: 12px;
    color: var(--slax-text-light);
    letter-spacing: 0.02em;
  }
}

.history-clear-btn {
  font-size: 12px;
  color: var(--slax-text-light);
  background: transparent;
  border: none;
  cursor: pointer;
  padding: 2px 6px;
  border-radius: 6px;
  transition:
    color 0.15s,
    background 0.15s;

  &:hover {
    color: var(--slax-danger);
    background: var(--slax-danger-bg);
  }
}

.search-history-list {
  padding: 0;
}

.history-item {
  display: flex;
  align-items: center;
  gap: 10px;
  width: 100%;
  padding: 8px 10px;
  background: transparent;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  color: var(--slax-text-muted);
  font-size: 14px;
  font-family: inherit;
  text-align: left;
  transition: all 0.12s;

  svg {
    flex-shrink: 0;
    color: var(--slax-text-light);
    opacity: 0.6;
  }

  span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  &:hover {
    background: var(--slax-accent-bg);
    color: var(--slax-text);
  }
}

// 下拉动画
.search-dropdown-enter-from,
.search-dropdown-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.search-dropdown-enter-active,
.search-dropdown-leave-active {
  transition:
    opacity 0.18s ease,
    transform 0.18s ease;
}
</style>
