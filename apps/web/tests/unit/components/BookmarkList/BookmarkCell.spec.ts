// components/BookmarkList/BookmarkCell.vue 单测（meta 行去日期、标签并入来源右侧、去掉"打开原文"按钮、
// 文字列表模式也显示标签行后更新）
// 新结构：.article-card、.article-title、.article-star、.article-action、.article-source、.article-tags（并入 .article-meta）
import { defineComponent, reactive } from 'vue'

import BookmarkCell from '~~/app/components/BookmarkList/BookmarkCell.vue'

import { BookmarkParseStatus, type BookmarkTag } from '@commons/contracts/interface'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { baseBookmarkItem, makeBookmarkItem } from '~~/tests/fixtures/bookmark'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PropType } from 'vue'

const { mockGet, mockPost, mockRequest, mockPwaOpen, mockAnalyticsLog, mockToastShowToast, mockShowSnapshot, mockUseRoute, mockRoute } = vi.hoisted(() => {
  const get = vi.fn()
  const post = vi.fn()
  const route = { query: {}, params: {}, path: '/bookmarks', fullPath: '/bookmarks' } as Record<string, unknown>
  return {
    mockGet: get,
    mockPost: post,
    mockRequest: vi.fn(() => ({ get, post })),
    mockPwaOpen: vi.fn(),
    mockAnalyticsLog: vi.fn(),
    mockToastShowToast: vi.fn(),
    mockShowSnapshot: vi.fn(),
    mockUseRoute: vi.fn(() => route),
    mockRoute: route
  }
})

vi.mock('~/components/Toast', () => ({
  default: { showToast: mockToastShowToast },
  ToastType: { Success: 1, Error: 2, Warning: 3, Info: 4 }
}))

vi.mock('~/components/Modal', () => ({
  showSnapshotStatusModal: mockShowSnapshot
}))

// 内存版 Storage：只实现组件与用例用到的方法
const createMemoryStorage = () => {
  const store = new Map<string, string>()
  return {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => void store.set(key, String(value)),
    removeItem: (key: string) => void store.delete(key),
    clear: () => store.clear(),
    key: (index: number) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size
    }
  }
}

// BookmarkTags 轻量替身：渲染传入 tags，可发出 change / select-tag
const BookmarkTagsStub = defineComponent({
  name: 'BookmarkTags',
  props: {
    tags: { type: Array as PropType<BookmarkTag[]>, default: () => [] },
    bookmarkId: { type: [Number, String], default: undefined },
    bookmarkUid: { type: String, default: '' },
    // lfKey() 原样透传 bookmark.id：REST 下是 number/hashid，LF 下是 uuid
    bookmarkUuid: { type: [String, Number], default: '' },
    compact: { type: Boolean, default: false },
    readonly: { type: Boolean, default: false }
  },
  emits: ['change', 'select-tag'],
  template: `<div class="bookmark-tags-stub">
    <span v-for="tag in tags" :key="tag.id" class="stub-chip" @click="$emit('select-tag', tag)">{{ tag.show_name }}</span>
    <button class="stub-add" type="button" @click="$emit('change', [...tags, { id: 99, name: 'new', show_name: 'New' }])">+</button>
  </div>`
})

const mountCell = (props: Record<string, unknown>) => mountWithApp(BookmarkCell, { props, global: { stubs: { BookmarkTags: BookmarkTagsStub } } })

mockNuxtImport('request', () => mockRequest)
mockNuxtImport('pwaOpen', () => mockPwaOpen)
mockNuxtImport('analyticsLog', () => mockAnalyticsLog)
mockNuxtImport('useRoute', () => mockUseRoute)

beforeEach(() => {
  mockGet.mockReset()
  mockPost.mockReset()
  mockPwaOpen.mockClear()
  mockAnalyticsLog.mockClear()
  mockToastShowToast.mockClear()
  mockShowSnapshot.mockClear()
  mockPost.mockResolvedValue({ ok: true, bookmark_id: 1, status: 'inbox' })
  mockRoute.query = {}
  // Node >= 25 自带 globalThis.localStorage 访问器；没配 --localstorage-file 时它是个没有
  // Storage 方法的空对象，happy-dom 不会覆盖已存在的全局访问器，导致 clear/setItem 不是函数。
  // 这里换成内存版 Storage，每个用例重置，顺带清掉 reminderKey。
  vi.stubGlobal('localStorage', createMemoryStorage())
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('components/BookmarkList/BookmarkCell', () => {
  describe('渲染 + computed', () => {
    it('渲染标题 / 站点名 / 日期 + 操作按钮（普通文章 / 非 trashed / 非 subscribe）', () => {
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: false, index: 0 }
      })
      expect(wrapper.find('.article-title').text()).toBe(baseBookmarkItem.title)
      expect(wrapper.find('.article-source').text()).toBe('Example Site')
      expect(wrapper.find('.article-date').exists()).toBe(false)
      expect(wrapper.find('.article-card-link').attributes('href')).toBe('/b/1000001?_slax_entry=bookmarks')
      expect(wrapper.find('.article-title').attributes('href')).toBe('/b/1000001?_slax_entry=bookmarks')
      // 非 inbox：编辑 + 归档 + 删除 = 3 个
      expect(wrapper.findAll('.article-action').length).toBe(3)
    })

    it('alias_title 优先于 title 渲染', () => {
      const bm = makeBookmarkItem({ alias_title: '别名标题' })
      const wrapper = mountWithApp(BookmarkCell, { props: { bookmark: bm, isSubscribe: false } })
      expect(wrapper.find('.article-title').text()).toBe('别名标题')
    })

    it('isStarred=true（starred=star）：star 按钮带 active class', () => {
      const bm = makeBookmarkItem({ starred: 'star' })
      const wrapper = mountWithApp(BookmarkCell, { props: { bookmark: bm, isSubscribe: false } })
      expect(wrapper.find('.article-star').classes()).toContain('active')
    })

    it('isTrashed=true：渲染恢复按钮 + 不渲染删除按钮', () => {
      const bm = makeBookmarkItem({ trashed_at: '2026-01-02T00:00:00.000Z' })
      const wrapper = mountWithApp(BookmarkCell, { props: { bookmark: bm, isSubscribe: false } })
      expect(wrapper.findAll('.article-action').length).toBe(2)
      expect(wrapper.find('.article-action.danger').exists()).toBe(false)
    })

    it('shortcut 类型：article-source 含站点名', () => {
      const bm = makeBookmarkItem({ type: 'shortcut' })
      const wrapper = mountWithApp(BookmarkCell, { props: { bookmark: bm, isSubscribe: false } })
      expect(wrapper.find('.article-source').text()).toContain('Example Site')
    })

    it('isSubscribe=true：星标按钮不渲染，操作区只有编辑按钮', () => {
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: true, collectionCode: 'COL1' }
      })
      expect(wrapper.find('.article-star').exists()).toBe(false)
      expect(wrapper.findAll('.article-action').length).toBe(1)
    })
  })

  describe('clickTitle', () => {
    it('isSubscribe=true：pwaOpen /c/<code>/<id> + target=_blank', async () => {
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: true, collectionCode: 'COL1' }
      })
      await wrapper.find('.article-title').trigger('click')
      // fork：decorateReaderRoute 在 /bookmarks 或 / 路由下追加 _slax_entry 来源追踪参数
      expect(mockPwaOpen).toHaveBeenCalledWith({ url: '/c/COL1/1000001?_slax_entry=bookmarks', target: '_blank' })
    })

    it('shortcut 类型：clickHref（window.open 原 url）', async () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
      const bm = makeBookmarkItem({ type: 'shortcut' })
      const wrapper = mountWithApp(BookmarkCell, { props: { bookmark: bm, isSubscribe: false } })
      await wrapper.find('.article-title').trigger('click')
      expect(openSpy).toHaveBeenCalledWith('https://example.com/article-1', '_blank')
    })

    it('status≠success：clickHref 而非 clickCache', async () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
      const bm = makeBookmarkItem({ status: BookmarkParseStatus.FAILED })
      const wrapper = mountWithApp(BookmarkCell, { props: { bookmark: bm, isSubscribe: false } })
      await wrapper.find('.article-title').trigger('click')
      expect(openSpy).toHaveBeenCalled()
      expect(mockShowSnapshot).not.toHaveBeenCalled()
    })

    it('document 含 slax-reader-panel：仍走 clickCache（优先快照）', async () => {
      const panel = document.createElement('slax-reader-panel')
      document.body.appendChild(panel)
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: false }
      })
      await wrapper.find('.article-title').trigger('click')
      // fork：useSlaxRoutes 统一跳 /b/{uuid}（缺 uuid 回退用 id）+ decorateReaderRoute 追加来源追踪参数
      expect(mockPwaOpen).toHaveBeenCalledWith({ url: '/b/1000001?_slax_entry=bookmarks' })
      document.body.removeChild(panel)
    })

    it('普通文章：走 clickCache → pwaOpen /b/<id>', async () => {
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: false }
      })
      await wrapper.find('.article-title').trigger('click')
      expect(mockPwaOpen).toHaveBeenCalledWith({ url: '/b/1000001?_slax_entry=bookmarks' })
    })
  })

  describe('clickCache + showSnapshotStatusModal', () => {
    it('status=failed + reminder 未禁用：点击 article-source 触发 clickHref（不弹 modal）', async () => {
      // article-source 点击触发 clickHref，不走 clickCache
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
      const bm = makeBookmarkItem({ status: BookmarkParseStatus.FAILED })
      const wrapper = mountWithApp(BookmarkCell, { props: { bookmark: bm, isSubscribe: false } })
      await wrapper.find('.article-source').trigger('click')
      expect(openSpy).toHaveBeenCalled()
    })

    it('status=failed + reminder 已禁用：直接 clickHref 不弹', async () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
      localStorage.setItem('snapshot_reminder_disabled_failed', 'true')
      const bm = makeBookmarkItem({ status: BookmarkParseStatus.FAILED })
      const wrapper = mountWithApp(BookmarkCell, { props: { bookmark: bm, isSubscribe: false } })
      await wrapper.find('.article-source').trigger('click')
      expect(mockShowSnapshot).not.toHaveBeenCalled()
      expect(openSpy).toHaveBeenCalled()
    })
  })

  describe('来源筛选', () => {
    it('sourceFilterable=true：来源为按钮，点击发出规范化域名且不打开页面', async () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
      const bm = makeBookmarkItem({ host_url: 'https://WWW.Example.com:443/path', site_name: 'Example Site' })
      const wrapper = mountWithApp(BookmarkCell, { props: { bookmark: bm, isSubscribe: false, sourceFilterable: true } })

      expect(wrapper.find('.article-source').element.tagName).toBe('BUTTON')
      await wrapper.find('.article-source').trigger('click')

      expect(wrapper.emitted('sourceFilter')).toEqual([[{ domain: 'www.example.com', label: 'Example Site' }]])
      expect(openSpy).not.toHaveBeenCalled()
      expect(mockAnalyticsLog).toHaveBeenCalledWith(expect.objectContaining({ element: 'source_filter' }))
    })

    it('“打开原文”按钮已移除：操作区不再渲染 .open-original', () => {
      const wrapper = mountWithApp(BookmarkCell, { props: { bookmark: baseBookmarkItem, isSubscribe: false, sourceFilterable: true } })
      expect(wrapper.find('.article-action.open-original').exists()).toBe(false)
    })
  })

  describe('star / archive / trash / revert', () => {
    it('starBookmark：调 BOOKMARK_STAR + emit bookmarkUpdate + analyticsLog', async () => {
      mockPost.mockResolvedValueOnce({ bookmark_id: 1000001, status: 'star' })
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: false }
      })
      await wrapper.find('.article-star').trigger('click')
      await flushPromises()
      const call = mockPost.mock.calls[0]![0] as { url: string; body: { status: string } }
      expect(call.url).toBe('/v1/bookmark/star')
      expect(call.body.status).toBe('star')
      expect(wrapper.emitted('bookmarkUpdate')).toHaveLength(1)
      expect(mockAnalyticsLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'bookmark_star', is_starred: true }))
    })

    it('archiveBookmark inbox→archive：调 BOOKMARK_ARCHIVE + emit archiveUpdate', async () => {
      mockPost.mockResolvedValueOnce({ bookmark_id: 1000001, status: 'archive' })
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: false }
      })
      const archiveBtn = wrapper.find('.article-action:not(.open-original):not(.edit-title):not(.danger)')
      expect(archiveBtn).toBeDefined()
      await archiveBtn.trigger('click')
      await flushPromises()
      const call = mockPost.mock.calls[0]![0] as { url: string; body: { status: string } }
      expect(call.url).toBe('/v1/bookmark/archive')
      expect(call.body.status).toBe('archive')
      expect(wrapper.emitted('archiveUpdate')).toHaveLength(1)
      expect(wrapper.emitted('archiveUpdate')![0]).toEqual([1000001, true])
    })

    it('archiveBookmark archive→inbox：status=inbox', async () => {
      const bm = makeBookmarkItem({ archived: 'archive' })
      mockPost.mockResolvedValueOnce({ bookmark_id: 1000001, status: 'inbox' })
      const wrapper = mountWithApp(BookmarkCell, { props: { bookmark: bm, isSubscribe: false } })
      const unarchiveBtn = wrapper.find('.article-action:not(.open-original):not(.edit-title):not(.danger)')
      expect(unarchiveBtn).toBeDefined()
      await unarchiveBtn.trigger('click')
      await flushPromises()
      const call = mockPost.mock.calls[0]![0] as { body: { status: string } }
      expect(call.body.status).toBe('inbox')
      expect(wrapper.emitted('archiveUpdate')![0]).toEqual([1000001, false])
    })

    it('archiveBookmark 失败：showToast Error', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      mockPost.mockRejectedValueOnce(new Error('boom'))
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: false }
      })
      const archiveBtn = wrapper.find('.article-action:not(.open-original):not(.edit-title):not(.danger)')
      await archiveBtn.trigger('click')
      await flushPromises()
      expect(mockToastShowToast).toHaveBeenCalled()
      consoleSpy.mockRestore()
    })

    it('clickDelete：调 TRASH_BOOKMARK + removeCell stroke + emit delete', async () => {
      vi.useFakeTimers()
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: false }
      })
      // article-actions 内：[0]=编辑, [1]=归档, [2]=删除（danger class）
      const deleteBtn = wrapper.find('.article-action.danger')
      expect(deleteBtn.exists()).toBe(true)
      await deleteBtn.trigger('click')
      const call = mockPost.mock.calls[0]![0] as { url: string }
      expect(call.url).toBe('/v1/bookmark/trash')
      expect(wrapper.find('.article-title').classes()).toContain('stroking')
      await vi.advanceTimersByTimeAsync(500)
      expect(wrapper.emitted('delete')).toHaveLength(1)
      expect(wrapper.find('.article-card').classes()).toContain('deleting')
    })

    it('clickRevert：调 REVERT_BOOKMARK + emit delete（无 stroke）', async () => {
      const bm = makeBookmarkItem({ trashed_at: '2026-01-02T00:00:00.000Z' })
      const wrapper = mountWithApp(BookmarkCell, { props: { bookmark: bm, isSubscribe: false } })
      const revertBtn = wrapper.find('.article-action:not(.open-original):not(.edit-title)')
      expect(revertBtn).toBeDefined()
      await revertBtn.trigger('click')
      await flushPromises()
      const call = mockPost.mock.calls[0]![0] as { url: string }
      expect(call.url).toBe('/v1/bookmark/trash_revert')
      expect(wrapper.emitted('delete')).toHaveLength(1)
    })
  })

  describe('编辑标题', () => {
    it('clickEdit：切到编辑态，editingTitle 预填', async () => {
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: false }
      })
      const editBtn = wrapper.find('.article-action.edit-title')
      expect(editBtn).toBeDefined()
      await editBtn.trigger('click')
      expect(wrapper.find('input').exists()).toBe(true)
      const input = wrapper.find('input').element as HTMLInputElement
      expect(input.value).toBe(baseBookmarkItem.title)
    })

    it('updateBookmarkTitle：回车后调 BOOKMARK_ALIAS_TITLE + emit bookmarkUpdate + 退出编辑态', async () => {
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: false }
      })
      const editBtn = wrapper.find('.article-action.edit-title')
      await editBtn.trigger('click')
      const input = wrapper.find('input')
      await input.setValue('新标题')
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      const call = mockPost.mock.calls[0]![0] as { url: string; body: { alias_title: string } }
      expect(call.url).toBe('/v1/bookmark/alias_title')
      expect(call.body.alias_title).toBe('新标题')
      const events = wrapper.emitted('bookmarkUpdate')!
      expect(events).toHaveLength(1)
      expect(events[0]![1]).toMatchObject({ alias_title: '新标题' })
      expect(wrapper.find('input').exists()).toBe(false)
    })

    it('编辑后值与原 alias_title 一致：短路不调 post，仅退出编辑态', async () => {
      const bm = makeBookmarkItem({ alias_title: '已存在' })
      const wrapper = mountWithApp(BookmarkCell, { props: { bookmark: bm, isSubscribe: false } })
      const editBtn = wrapper.find('.article-action.edit-title')
      await editBtn.trigger('click')
      const input = wrapper.find('input')
      await input.setValue('已存在')
      mockPost.mockClear()
      await input.trigger('keydown', { key: 'Enter' })
      await flushPromises()
      expect(mockPost).not.toHaveBeenCalled()
      expect(wrapper.find('input').exists()).toBe(false)
    })

    it('其他键不触发提交', async () => {
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: false }
      })
      const editBtn = wrapper.find('.article-action.edit-title')
      await editBtn.trigger('click')
      mockPost.mockClear()
      await wrapper.find('input').trigger('keydown', { key: 'Esc' })
      expect(mockPost).not.toHaveBeenCalled()
    })
  })

  describe('标签行', () => {
    const tags: BookmarkTag[] = [
      { id: 1, name: 'vue', show_name: 'Vue', source: 'mine', added_by: 'user' },
      { id: 2, name: 'ai', show_name: 'AI', source: 'auto', added_by: 'ai' }
    ]

    it('textMode=false：渲染 .article-tags，标签经子组件渲染，并把 id/uid/uuid 传给子组件', () => {
      const bm = makeBookmarkItem({ tags, bookmark_user_uuid: 'uid-1' })
      const wrapper = mountCell({ bookmark: bm, isSubscribe: false })
      const row = wrapper.find('.article-meta .article-tags')
      expect(row.exists()).toBe(true)
      expect(row.findAll('.stub-chip').map(c => c.text())).toEqual(['Vue', 'AI'])
      const child = wrapper.findComponent(BookmarkTagsStub)
      // REST 下没有 local-first uuid，传空串；bookmarkId 是 hashid
      expect(child.props()).toMatchObject({ bookmarkId: 1000001, bookmarkUid: 'uid-1', bookmarkUuid: '', compact: true, readonly: false, tags })
    })

    it('无 tags：子组件仍渲染（自带 "+"）', () => {
      const wrapper = mountCell({ bookmark: makeBookmarkItem({ tags: undefined }), isSubscribe: false })
      expect(wrapper.find('.article-tags').exists()).toBe(true)
      expect(wrapper.findComponent(BookmarkTagsStub).props('tags')).toEqual([])
    })

    it('textMode=true：桌面文字列表也照常渲染标签行（移动端隐藏靠 CSS media query，非此处逻辑）', () => {
      const wrapper = mountCell({ bookmark: makeBookmarkItem({ tags }), isSubscribe: false, textMode: true })
      expect(wrapper.find('.article-tags').exists()).toBe(true)
      expect(wrapper.findComponent(BookmarkTagsStub).exists()).toBe(true)
    })

    it('trashed：不渲染标签行', () => {
      const wrapper = mountCell({ bookmark: makeBookmarkItem({ tags, trashed_at: '2026-01-02T00:00:00.000Z' }), isSubscribe: false })
      expect(wrapper.find('.article-tags').exists()).toBe(false)
    })

    it('isSubscribe=true：不渲染标签行', () => {
      const wrapper = mountCell({ bookmark: makeBookmarkItem({ tags }), isSubscribe: true, collectionCode: 'COL1' })
      expect(wrapper.find('.article-tags').exists()).toBe(false)
    })

    it('点击标签行内元素：不打开文章（pwaOpen / window.open 均未调用）', async () => {
      const openSpy = vi.spyOn(window, 'open').mockReturnValue(null)
      const wrapper = mountCell({ bookmark: makeBookmarkItem({ tags }), isSubscribe: false })
      await wrapper.find('.article-tags .stub-chip').trigger('click')
      await wrapper.find('.article-tags').trigger('click')
      expect(mockPwaOpen).not.toHaveBeenCalled()
      expect(openSpy).not.toHaveBeenCalled()
    })

    it('子组件 change → emit bookmarkUpdate，携带合并后的 tags', async () => {
      const bm = makeBookmarkItem({ tags })
      const wrapper = mountCell({ bookmark: bm, isSubscribe: false })
      await wrapper.find('.article-tags .stub-add').trigger('click')
      const events = wrapper.emitted('bookmarkUpdate')!
      expect(events).toHaveLength(1)
      expect(events[0]![0]).toBe(1000001)
      expect(events[0]![1]).toMatchObject({ ...bm, tags: [...tags, { id: 99, name: 'new', show_name: 'New' }] })
    })

    it('子组件 select-tag → emit selectTag', async () => {
      const wrapper = mountCell({ bookmark: makeBookmarkItem({ tags }), isSubscribe: false })
      await wrapper.find('.article-tags .stub-chip').trigger('click')
      expect(wrapper.emitted('selectTag')).toEqual([[tags[0]]])
    })
  })

  describe('route filter 影响 trackListItemInteract', () => {
    it('route.query.filter=archive：analyticsLog section=archive', async () => {
      mockRoute.query = reactive({ filter: 'archive' })
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: false }
      })
      await wrapper.find('.article-star').trigger('click')
      const call = mockAnalyticsLog.mock.calls.find(c => (c[0] as { event: string }).event === 'bookmark_list_item_interact')!
      expect((call[0] as { section: string }).section).toBe('archive')
    })

    it('未知 filter：fallback inbox', async () => {
      mockRoute.query = reactive({ filter: 'random-string' })
      const wrapper = mountWithApp(BookmarkCell, {
        props: { bookmark: baseBookmarkItem, isSubscribe: false }
      })
      await wrapper.find('.article-star').trigger('click')
      const call = mockAnalyticsLog.mock.calls.find(c => (c[0] as { event: string }).event === 'bookmark_list_item_interact')!
      expect((call[0] as { section: string }).section).toBe('inbox')
    })
  })
})
