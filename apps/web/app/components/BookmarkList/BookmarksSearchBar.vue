<template>
  <!-- 顶栏内嵌搜索框：支持历史记录下拉、回车搜索、Esc 收起 -->
  <!-- click-outside 绑在容器上，避免 input focus 时被误判为外部点击导致历史闪烁 -->
  <button ref="opener" class="compact-search-open" type="button" :aria-label="$t('common.operate.search')" :aria-expanded="compactOpen" @click="openCompact">
    <AppIcon name="empty.search" :size="22" />
  </button>
  <form class="topbar-search" :class="{ focused: isFocused, 'compact-open': compactOpen }" role="search" v-on-click-outside="onClickOutside" @submit.prevent="doSearch" @keydown.esc="dismissSearch">
    <button class="compact-search-cancel" type="button" :aria-label="$t('common.operate.cancel')" @click="dismissSearch">
      <AppIcon name="tags.back" :size="22" />
    </button>

    <div class="search-field">
      <svg class="search-icon" aria-hidden="true" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="11" cy="11" r="8" />
        <path d="M21 21l-4.35-4.35" />
      </svg>
      <input
        v-ime-guard
        ref="input"
        class="search-input"
        enterkeyhint="search"
        :aria-label="$t('page.bookmarks_index.search_placeholder')"
        :placeholder="$t('page.bookmarks_index.search_placeholder')"
        v-model="keyword"
        @focus="onFocus"
        @keydown.enter.prevent="doSearch"
      />
      <button class="search-clear" v-show="keyword" :aria-label="$t('page.bookmarks_index.search_history_clear')" @mousedown.prevent @click="clearKeyword(); input?.focus()" type="button">
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>
    <button class="compact-search-submit" type="submit">{{ $t('common.operate.search') }}</button>

    <!-- 历史记录下拉 -->
    <Transition :key="historyKey" name="search-dropdown">
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
  </form>
</template>

<script lang="ts" setup>
import AppIcon from '~/components/AppIcon.vue'

import { vOnClickOutside } from '@vueuse/components'

// The page's current search text; when it changes (a ?q= handoff, or "back" out of a search) the box follows
const props = defineProps<{
  searchText?: string
}>()

const emit = defineEmits<{
  search: [keyword: string]
}>()

const compactOpen = ref(false)
const opener = ref<HTMLButtonElement>()
const input = ref<HTMLInputElement>()
const isCompact = useMediaQuery('(max-width: 860px)')
watch(isCompact, compact => { if (!compact) compactOpen.value = false })

const openCompact = async () => {
  compactOpen.value = true
  await nextTick()
  input.value?.focus()
}

const dismissSearch = async () => {
  closeSearch()
  if (!compactOpen.value) return
  compactOpen.value = false
  clearKeyword()
  await nextTick()
  opener.value?.focus()
}

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

const account = useAccountContext()
const historyKey = computed(() => {
  const { status, accountKey } = account.context.value
  return status === 'ready' && accountKey ? `${HISTORY_KEY}:${accountKey}` : undefined
})

const loadHistory = () => {
  historyList.value = []
  if (!import.meta.client || !historyKey.value) return
  try {
    const raw = localStorage.getItem(historyKey.value)
    const terms: unknown = raw && JSON.parse(raw)
    if (Array.isArray(terms)) historyList.value = terms.filter((term): term is string => typeof term === 'string').slice(0, MAX_HISTORY)
  } catch {
    // Malformed or unavailable storage leaves the current history empty.
  }
}

watch(historyKey, () => {
  showHistory.value = false
  loadHistory()
}, { flush: 'sync' })

const persistHistory = (key: string, terms: string[] = []) => {
  try {
    if (terms.length) localStorage.setItem(key, JSON.stringify(terms))
    else localStorage.removeItem(key)
  } catch {
    // Browsing with storage disabled still allows submitting a search.
  }
}

const saveHistory = (text: string) => {
  account.sync()
  if (!historyKey.value) return
  const list = historyList.value.filter(item => item !== text)
  historyList.value = [text, ...list].slice(0, MAX_HISTORY)
  persistHistory(historyKey.value, historyList.value)
}

const clearHistory = () => {
  account.sync()
  historyList.value = []
  if (historyKey.value) persistHistory(historyKey.value)
  showHistory.value = false
}

// 聚焦时：若无输入且有历史则展开下拉
const onFocus = () => {
  isFocused.value = true
  account.sync()
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
  persistHistory(HISTORY_KEY)
  loadHistory()
})
</script>

<style lang="scss" scoped>
.compact-search-open,
.compact-search-cancel,
.compact-search-submit {
  display: none;
}

.search-field {
  display: contents;
}

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
  -webkit-backdrop-filter: blur(12px);
  backdrop-filter: blur(12px);
  cursor: text;
  transition: all 0.2s;

  &:hover {
    border-color: color-mix(in srgb, var(--slax-accent) 30%, var(--slax-border));
  }

  &.focused {
    border-color: var(--slax-accent);
    box-shadow: 0 0 0 3px var(--slax-accent-bg);
  }

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

@media (max-width: 860px) {
  .compact-search-open,
  .compact-search-cancel,
  .compact-search-submit {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex: none;
    min-width: 44px;
    height: 44px;
    padding: 0;
    border: 0;
    border-radius: var(--slax-radius-sm);
    background: transparent;
    color: var(--slax-text-muted);
    cursor: pointer;

    &:hover,
    &:active {
      background: var(--slax-accent-bg);
      color: var(--slax-text);
    }
  }

  .compact-search-open[aria-expanded='true'] {
    display: none;
  }

  .compact-search-submit {
    padding-inline: 6px;
    font: 500 var(--slax-fs-meta) var(--slax-font-sans);
    color: var(--slax-accent);
  }

  .compact-search-open:focus-visible,
  .topbar-search button:focus-visible {
    outline: 2px solid var(--slax-accent);
    outline-offset: -2px;
  }

  .topbar-search.compact-open {
    display: flex;
    width: 100%;
    gap: 4px;
    padding: 0;
    border: 0;
    background: transparent;
    backdrop-filter: none;
    box-shadow: none;
    cursor: auto;
  }

  .search-field {
    display: flex;
    align-items: center;
    flex: 1;
    min-width: 0;
    height: 36px;
    box-sizing: border-box;
    gap: 8px;
    padding-inline: 10px 4px;
    border: 1px solid var(--slax-border-strong);
    border-radius: var(--slax-radius-sm);
    background: var(--slax-surface-solid);

    &:focus-within {
      border-color: var(--slax-accent);
    }
  }

  .search-input {
    height: 100%;
    font-size: var(--slax-fs-body);
    caret-color: var(--slax-accent);
  }

  .search-input::placeholder,
  .search-icon,
  .search-clear {
    color: var(--slax-text-muted);
  }

  .search-clear {
    width: 32px;
    height: 32px;
  }

  .search-history {
    box-shadow: var(--slax-shadow-sm);
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
