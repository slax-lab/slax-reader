// bookmark fixture 导入冒烟测试：仅验证 5 类 fixture + 嵌套结构 fixture 能 import 且类型编译通过
// Sprint 1.2 / 1.3 / 1.4 / Sprint 4 才正式消费这些 fixture
import {
  baseBookmarkBrief,
  baseBookmarkDetail,
  baseBookmarkItem,
  baseBookmarkTag,
  baseInlineBookmark,
  baseMarkInfo,
  baseMarks,
  baseMarksWithComment,
  baseMarkUserInfo,
  baseShareBookmark,
  baseShareInfo,
  makeBookmarkBrief,
  makeBookmarkDetail,
  makeBookmarkDetailWithTags,
  makeBookmarkItem,
  makeInlineBookmark,
  makeShareBookmark
} from '~~/tests/fixtures/bookmark'
import { describe, expect, it } from 'vitest'

describe('bookmark fixture', () => {
  it('5 类主结构 base 字段对账（字段数与 commons/types 一致）', () => {
    expect(Object.keys(baseBookmarkItem)).toHaveLength(20)
    expect(Object.keys(baseBookmarkDetail)).toHaveLength(23)
    expect(Object.keys(baseBookmarkBrief)).toHaveLength(21)
    expect(Object.keys(baseShareBookmark)).toHaveLength(17)
    expect(Object.keys(baseInlineBookmark)).toHaveLength(6)
  })

  it('PII 标准值（user_id=1 与 baseUser 对齐 / bookmark_id=1000001 / mark.id=2000001）', () => {
    expect(baseBookmarkDetail.user_id).toBe(1)
    expect(baseBookmarkDetail.bookmark_id).toBe(1000001)
    expect(baseBookmarkItem.id).toBe(1000001)
    expect(baseBookmarkBrief.bookmark_id).toBe(1000001)
    expect(baseShareBookmark.user_id).toBe(1)
    expect(baseInlineBookmark.owner_user_id).toBe(1)
    expect(baseMarkInfo.id).toBe(2000001)
    expect(baseMarkUserInfo.id).toBe(2000001)
  })

  it('archived / starred 字面量与枚举正确', () => {
    expect(baseBookmarkItem.archived).toBe('inbox')
    expect(baseBookmarkItem.starred).toBe('unstar')
    expect(baseBookmarkDetail.archived).toBe('inbox')
    expect(baseBookmarkBrief.starred).toBe('unstar')
  })

  it('时间戳类型按 type 区分（BookmarkBriefDetail 是 Date / 其它是 string）', () => {
    expect(baseBookmarkBrief.created_at).toBeInstanceOf(Date)
    expect(baseBookmarkBrief.updated_at).toBeInstanceOf(Date)
    expect(baseBookmarkBrief.published_at).toBeInstanceOf(Date)
    expect(typeof baseBookmarkDetail.created_at).toBe('string')
    expect(typeof baseBookmarkItem.created_at).toBe('string')
    expect(typeof baseShareBookmark.created_at).toBe('string')
    expect(baseMarkInfo.created_at).toBeInstanceOf(Date)
    expect(typeof baseShareInfo.created_at).toBe('string')
  })

  it('makeXxx 工厂浅合并 overrides', () => {
    const item = makeBookmarkItem({ title: 'Custom' })
    expect(item.title).toBe('Custom')
    expect(item.id).toBe(1000001)

    const detail = makeBookmarkDetail({ user_id: 999 })
    expect(detail.user_id).toBe(999)
    expect(detail.bookmark_id).toBe(1000001)

    const brief = makeBookmarkBrief({ archived: 'archive' })
    expect(brief.archived).toBe('archive')
    expect(brief.starred).toBe('unstar')

    const share = makeShareBookmark({ title: 'Share Title' })
    expect(share.title).toBe('Share Title')

    const inline = makeInlineBookmark({ owner_user_id: 5 })
    expect(inline.owner_user_id).toBe(5)
  })

  it('makeBookmarkDetailWithTags 默认注入 baseBookmarkTag，overrides.tags 不会覆盖 helper 注入', () => {
    const detail = makeBookmarkDetailWithTags()
    expect(detail.tags).toHaveLength(1)
    expect(detail.tags[0]).toEqual(baseBookmarkTag)

    const detail2 = makeBookmarkDetailWithTags([baseBookmarkTag, { ...baseBookmarkTag, id: 2 }], { title: 'X' })
    expect(detail2.tags).toHaveLength(2)
    expect(detail2.title).toBe('X')

    // overrides.tags 即使传也不会覆盖 helper 第一参数（修订 2 P2 #3）
    const detail3 = makeBookmarkDetailWithTags([baseBookmarkTag], { tags: [] })
    expect(detail3.tags).toHaveLength(1)
  })

  it('baseMarks 默认空 / baseMarksWithComment 配套 user_list 提供用户映射', () => {
    expect(baseMarks.mark_list).toHaveLength(0)
    expect(Object.keys(baseMarks.user_list)).toHaveLength(0)

    expect(baseMarksWithComment.mark_list).toHaveLength(1)
    expect(Object.keys(baseMarksWithComment.user_list)).toContain('2000001')
    expect(baseMarksWithComment.user_list['2000001']?.username).toBe('Test User')
  })
})
