// 各 tab 空态配置
// title/desc 依赖 useI18n 的 t()，故此处只存 i18n key，由消费组件拼装文案
// 对应原 pages/bookmarks/index.vue 的 emptyViewConfig

import type { IconKey } from '~/icons/registry'

export interface BookmarkEmptyEntry {
  /** 稳定的 runtime registry key */
  iconKey: IconKey
  /** 标题 i18n key */
  titleKey: string
  /** 描述 i18n key */
  descKey: string
}

// 各 filterStatus 对应的空态配置
export const BOOKMARK_EMPTY_CONFIG: Record<string, BookmarkEmptyEntry> = {
  // 仅用于已装扩展态，其余走专属文案
  inbox: {
    iconKey: 'empty.inbox',
    titleKey: 'page.bookmarks_index.empty_inbox_title',
    descKey: 'page.bookmarks_index.empty_inbox_desc'
  },
  starred: {
    iconKey: 'empty.starred',
    titleKey: 'page.bookmarks_index.empty_starred_title',
    descKey: 'page.bookmarks_index.empty_starred_desc'
  },
  topics: {
    iconKey: 'empty.topics',
    titleKey: 'page.bookmarks_index.empty_topics_title',
    descKey: 'page.bookmarks_index.empty_topics_desc'
  },
  highlights: {
    iconKey: 'empty.highlights',
    titleKey: 'page.bookmarks_index.empty_highlights_title',
    descKey: 'page.bookmarks_index.empty_highlights_desc'
  },
  archive: {
    iconKey: 'empty.archive',
    titleKey: 'page.bookmarks_index.empty_archive_title',
    descKey: 'page.bookmarks_index.empty_archive_desc'
  },
  trashed: {
    iconKey: 'empty.trashed',
    titleKey: 'page.bookmarks_index.empty_trash_title',
    descKey: 'page.bookmarks_index.empty_trash_desc'
  },
  collections: {
    iconKey: 'empty.collections',
    titleKey: 'page.bookmarks_index.empty_collections_title',
    descKey: 'page.bookmarks_index.empty_collections_desc'
  }
}

// 未匹配 tab 的兜底空态配置
export const BOOKMARK_EMPTY_FALLBACK: BookmarkEmptyEntry = {
  iconKey: 'empty.fallback',
  titleKey: 'page.bookmarks_index.empty',
  descKey: ''
}
