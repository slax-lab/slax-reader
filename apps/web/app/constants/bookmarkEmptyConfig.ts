// 各 tab 空态配置
// title/desc 依赖 useI18n 的 t()，故此处只存 i18n key，由消费组件拼装文案
// 对应原 pages/bookmarks/index.vue 的 emptyViewConfig

import { DESIGN_ICONS } from '~/constants/designIcons'

export interface BookmarkEmptyEntry {
  /** svg 内部 markup */
  iconPath: string
  /** 缺省按 24×24 渲染 */
  iconViewBox?: string
  /** 标题 i18n key */
  titleKey: string
  /** 描述 i18n key */
  descKey: string
}

// 各 filterStatus 对应的空态配置
export const BOOKMARK_EMPTY_CONFIG: Record<string, BookmarkEmptyEntry> = {
  // 仅用于已装扩展态，其余走专属文案
  inbox: {
    iconPath: DESIGN_ICONS.emptyInbox.markup,
    iconViewBox: DESIGN_ICONS.emptyInbox.viewBox,
    titleKey: 'page.bookmarks_index.empty_inbox_title',
    descKey: 'page.bookmarks_index.empty_inbox_desc'
  },
  starred: {
    iconPath: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
    titleKey: 'page.bookmarks_index.empty_starred_title',
    descKey: 'page.bookmarks_index.empty_starred_desc'
  },
  topics: {
    iconPath: DESIGN_ICONS.emptyTopics.markup,
    iconViewBox: DESIGN_ICONS.emptyTopics.viewBox,
    titleKey: 'page.bookmarks_index.empty_topics_title',
    descKey: 'page.bookmarks_index.empty_topics_desc'
  },
  highlights: {
    iconPath: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>',
    titleKey: 'page.bookmarks_index.empty_highlights_title',
    descKey: 'page.bookmarks_index.empty_highlights_desc'
  },
  archive: {
    iconPath: DESIGN_ICONS.emptyArchive.markup,
    iconViewBox: DESIGN_ICONS.emptyArchive.viewBox,
    titleKey: 'page.bookmarks_index.empty_archive_title',
    descKey: 'page.bookmarks_index.empty_archive_desc'
  },
  trashed: {
    iconPath: DESIGN_ICONS.emptyTrash.markup,
    iconViewBox: DESIGN_ICONS.emptyTrash.viewBox,
    titleKey: 'page.bookmarks_index.empty_trash_title',
    descKey: 'page.bookmarks_index.empty_trash_desc'
  },
  collections: {
    iconPath: '<path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/>',
    titleKey: 'page.bookmarks_index.empty_collections_title',
    descKey: 'page.bookmarks_index.empty_collections_desc'
  }
}

// 未匹配 tab 的兜底空态配置
export const BOOKMARK_EMPTY_FALLBACK: BookmarkEmptyEntry = {
  iconPath: '<circle cx="12" cy="12" r="10"/>',
  titleKey: 'page.bookmarks_index.empty',
  descKey: ''
}
