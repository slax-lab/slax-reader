// bookmark fixture：按 commons/types/src/interface.ts 类型定义构造，PII 已脱敏
// 详见 .claude/test-framework/phase3/sprint1.1-bookmark-fixture.md
//
// 反推接口（已拉真实样本）：
//   GET /v1/bookmark/list?page=1&size=20&filter=inbox&topic_id=0&collection_id=0  → BookmarkItem
//   GET /v1/bookmark/detail?bookmark_id=<id>                                       → BookmarkDetail
//   GET /v1/bookmark/brief?bookmark_id=<id>                                        → BookmarkBriefDetail
// 拉不到（按 type 构造）：
//   GET /v1/share/detail / inline_detail                                            → ShareBookmarkDetail / InlineBookmarkDetail
//
// PII 标准值：bookmark_id=1000001 / user_id=1（与 baseUser 对齐）/ mark.id=2000001
// 时间戳：'2026-01-01T00:00:00.000Z' 字符串 或 new Date(...) Date（按 type 区分）

import type {
  BookmarkBriefDetail,
  BookmarkDetail,
  BookmarkItem,
  BookmarkTag,
  InlineBookmarkDetail,
  MarkDetail,
  MarkInfo,
  MarkPathApprox,
  MarkPathItem,
  MarkUserInfo,
  ShareBookmarkDetail,
  ShareInfo
} from '@commons/types/interface'
import { BookmarkParseStatus, MarkType } from '@commons/types/interface'

// 固定时间戳（避免随机时间引入 flaky）
const FIXED_ISO = '2026-01-01T00:00:00.000Z'
const FIXED_DATE = new Date(FIXED_ISO)

// === 嵌套结构 ===

export const baseMarkUserInfo: MarkUserInfo = {
  id: 2000001,
  username: 'Test User',
  avatar: 'https://example.com/avatar.png'
}
export const makeMarkUserInfo = (overrides: Partial<MarkUserInfo> = {}): MarkUserInfo => ({
  ...baseMarkUserInfo,
  ...overrides
})

export const baseMarkPathItem: MarkPathItem = {
  type: 'text',
  path: 'div > p',
  start: 0,
  end: 10
}

export const baseMarkPathApprox: MarkPathApprox = {
  exact: 'placeholder',
  prefix: 'before',
  suffix: 'after',
  position_start: 0,
  position_end: 10
}

export const baseMarkInfo: MarkInfo = {
  id: 2000001,
  uuid: '00000000-0000-0000-0000-000000002001',
  user_id: 2000001,
  type: MarkType.LINE,
  source: [baseMarkPathItem],
  approx_source: baseMarkPathApprox,
  parent_id: 0,
  parent_uid: '',
  root_id: 2000001,
  root_uid: '00000000-0000-0000-0000-000000002001',
  comment: '',
  created_at: FIXED_DATE,
  is_deleted: false,
  children: []
}
export const makeMarkInfo = (overrides: Partial<MarkInfo> = {}): MarkInfo => ({
  ...baseMarkInfo,
  ...overrides
})

export const baseMarks: MarkDetail = {
  mark_list: [],
  user_list: {}
}
// 含 comment 的成套 fixture：mark_list 非空时配套 user_list 提供用户映射
// 服务于 MarkManager.createUserMap 等真实链路
export const baseMarksWithComment: MarkDetail = {
  mark_list: [makeMarkInfo({ type: MarkType.COMMENT, comment: 'Test comment' })],
  user_list: {
    [String(2000001)]: makeMarkUserInfo({ id: 2000001, username: 'Test User' })
  }
}
export const makeMarks = (overrides: Partial<MarkDetail> = {}): MarkDetail => ({
  ...baseMarks,
  ...overrides
})

export const baseBookmarkTag: BookmarkTag = {
  name: 'test-tag',
  show_name: 'Test Tag',
  id: 1,
  system: false,
  display: true
}
export const makeBookmarkTag = (overrides: Partial<BookmarkTag> = {}): BookmarkTag => ({
  ...baseBookmarkTag,
  ...overrides
})

export const baseShareInfo: ShareInfo = {
  need_login: false,
  created_at: FIXED_ISO,
  allow_action: true,
  share_code: 'test-share-code-001'
}
export const makeShareInfo = (overrides: Partial<ShareInfo> = {}): ShareInfo => ({
  ...baseShareInfo,
  ...overrides
})

// === 主结构：BookmarkItem（list 接口主消费 type，20 字段）===

export const baseBookmarkItem: BookmarkItem = {
  id: 1000001,
  title: 'Test Bookmark Title',
  alias_title: '',
  host_url: 'example.com',
  target_url: 'https://example.com/article-1',
  content_icon: 'https://example.com/icon.png',
  content_cover: 'https://example.com/cover.png',
  content_word_count: 100,
  description: 'Test description',
  byline: 'Test Author',
  private_user: undefined,
  status: BookmarkParseStatus.SUCCESS,
  created_at: FIXED_ISO,
  updated_at: FIXED_ISO,
  published_at: FIXED_ISO,
  site_name: 'Example Site',
  archived: 'inbox',
  starred: 'unstar',
  trashed_at: null,
  type: 'article'
}
export const makeBookmarkItem = (overrides: Partial<BookmarkItem> = {}): BookmarkItem => ({
  ...baseBookmarkItem,
  ...overrides
})

// === 主结构：BookmarkDetail（detail 接口主消费 type，23 字段）===

export const baseBookmarkDetail: BookmarkDetail = {
  bookmark_id: 1000001,
  title: 'Test Bookmark Title',
  alias_title: '',
  host_url: 'example.com',
  target_url: 'https://example.com/article-1',
  content_icon: 'https://example.com/icon.png',
  content_cover: 'https://example.com/cover.png',
  content_word_count: 100,
  content: '<p>Test content body</p>',
  description: 'Test description',
  byline: 'Test Author',
  private_user: undefined,
  status: BookmarkParseStatus.SUCCESS,
  created_at: FIXED_ISO,
  updated_at: FIXED_ISO,
  published_at: FIXED_ISO,
  user_id: 1,
  archived: 'inbox',
  starred: 'unstar',
  marks: baseMarks,
  tags: [],
  trashed_at: null,
  type: 'article'
}
export const makeBookmarkDetail = (overrides: Partial<BookmarkDetail> = {}): BookmarkDetail => ({
  ...baseBookmarkDetail,
  ...overrides
})

// 含 tags 的快捷工厂：tags 后置生效，避免 overrides.tags 误覆盖
export const makeBookmarkDetailWithTags = (tags: BookmarkTag[] = [baseBookmarkTag], overrides: Partial<BookmarkDetail> = {}): BookmarkDetail =>
  makeBookmarkDetail({ ...overrides, tags })

// === 主结构：BookmarkBriefDetail（/v1/bookmark/brief 主消费 type，21 字段）===

export const baseBookmarkBrief: BookmarkBriefDetail = {
  target_url: 'https://example.com/article-1',
  created_at: FIXED_DATE,
  updated_at: FIXED_DATE,
  title: 'Test Bookmark Title',
  host_url: 'example.com',
  site_name: 'Example Site',
  content_icon: 'https://example.com/icon.png',
  content_cover: 'https://example.com/cover.png',
  content_word_count: 100,
  description: 'Test description',
  byline: 'Test Author',
  status: 'success',
  published_at: FIXED_DATE,
  marks: baseMarks,
  bookmark_id: 1000001,
  alias_title: '',
  archived: 'inbox',
  starred: 'unstar',
  overview: '',
  key_takeaways: [],
  tags: []
}
export const makeBookmarkBrief = (overrides: Partial<BookmarkBriefDetail> = {}): BookmarkBriefDetail => ({
  ...baseBookmarkBrief,
  ...overrides
})

// === 主结构：ShareBookmarkDetail（17 字段，按 type 构造）===

export const baseShareBookmark: ShareBookmarkDetail = {
  byline: 'Test Author',
  content: '<p>Test content body</p>',
  content_icon: 'https://example.com/icon.png',
  content_cover: 'https://example.com/cover.png',
  content_word_count: 100,
  created_at: FIXED_ISO,
  description: 'Test description',
  host_url: 'example.com',
  published_at: FIXED_ISO,
  site_name: 'Example Site',
  target_url: 'https://example.com/article-1',
  title: 'Test Bookmark Title',
  share_info: baseShareInfo,
  marks: baseMarks,
  tags: [],
  user_info: {
    nick_name: 'Test User',
    avatar: 'https://example.com/avatar.png',
    show_userinfo: true
  },
  user_id: 1
}
export const makeShareBookmark = (overrides: Partial<ShareBookmarkDetail> = {}): ShareBookmarkDetail => ({
  ...baseShareBookmark,
  ...overrides
})

// === 主结构：InlineBookmarkDetail（6 字段，按 type 构造）===

export const baseInlineBookmark: InlineBookmarkDetail = {
  title: 'Test Bookmark Title',
  target_url: 'https://example.com/article-1',
  share_info: baseShareInfo,
  marks: baseMarks,
  user_info: {
    nick_name: 'Test User',
    avatar: 'https://example.com/avatar.png',
    show_userinfo: true
  },
  owner_user_id: 1
}
export const makeInlineBookmark = (overrides: Partial<InlineBookmarkDetail> = {}): InlineBookmarkDetail => ({
  ...baseInlineBookmark,
  ...overrides
})
