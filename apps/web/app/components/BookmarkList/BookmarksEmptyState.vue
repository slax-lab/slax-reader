<template>
  <!-- B 提示 / C 空态（移动端不装扩展，B 态回退空态） -->
  <BookmarksEmptyView
    v-if="inboxState === 'B' && !isMobile"
    :title="promptTitle"
    :desc="promptDesc"
    :action-text="promptInstall"
    :action-note="promptNote"
    @action="installExtension"
  >
    <template #icon>
      <AppIcon :name="entry.iconKey" :size="32" />
    </template>
  </BookmarksEmptyView>
  <BookmarksEmptyView v-else-if="inboxState === 'C' || (inboxState === 'B' && isMobile) || !isCurrentInboxTab" :title="emptyTitle" :desc="emptyDesc">
    <template #icon>
      <AppIcon :name="entry.iconKey" :size="32" />
    </template>
  </BookmarksEmptyView>
</template>

<script setup lang="ts">
import AppIcon from '~/components/AppIcon.vue'
import BookmarksEmptyView from '~/components/BookmarkList/BookmarksEmptyView.vue'

import { isMobileBrowser } from '~/utils/environment'

import type { InboxOnboardingState } from '~/composables/bookmark/useInboxOnboardingState'
import { BOOKMARK_EMPTY_CONFIG, BOOKMARK_EMPTY_FALLBACK } from '~/constants/bookmarkEmptyConfig'

const props = defineProps<{
  filterStatus: string
  isCurrentInboxTab: boolean
  inboxState: InboxOnboardingState
}>()

const { t } = useI18n()

const isMobile = isMobileBrowser()

const pluginUrl = 'https://chromewebstore.google.com/detail/slax-reader/gdnhaajlomjkhahnmiijphnodkcfikfd?utm_source=web_empty_state'
const installExtension = () => {
  analyticsLog({ event: 'bookmark_list_download', client: 'browser_extension' })
  window.open(pluginUrl)
}

const promptTitle = computed(() => t('page.bookmarks_index.empty_inbox_prompt.title'))
const promptDesc = computed(() => t('page.bookmarks_index.empty_inbox_prompt.desc'))
const promptInstall = computed(() => t('page.bookmarks_index.empty_inbox_prompt.install'))
const promptNote = computed(() => t('page.bookmarks_index.empty_inbox_prompt.note'))

// 当前 tab 空态配置，未匹配走兜底
const entry = computed(() => BOOKMARK_EMPTY_CONFIG[props.filterStatus] ?? BOOKMARK_EMPTY_FALLBACK)
const emptyTitle = computed(() => t(entry.value.titleKey))
// inbox desc 提到浏览器工具栏，移动端没有该入口
const emptyDesc = computed(() => {
  if (isMobile && props.filterStatus === 'inbox') return ''
  return entry.value.descKey ? t(entry.value.descKey) : ''
})
</script>
