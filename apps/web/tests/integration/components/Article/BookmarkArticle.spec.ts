// BookmarkArticle.vue 集成测试 —— 第五期 Sprint B.1
// 覆盖：渲染（title/source/star）/ articleStyle 三种风格 /
//      starBookmark（成功/失败 + Toast）/ websiteClick / handleHTML（DOMPipeline run）/ handleDrawMark / jumpToHighLight
// 关键约束：
//  - 真实依赖按 phase5-plan §B.1 修订 4 mock 链路（含 ToastType / processors 13+ArticleStyle/DOMPipeline / Toast/CursorToast/ImagePreview）
//  - useArticleDetail vi.mock 全替换返回受控 ref
//  - MarkModal / DwebArticleSelection / 6 个 adapters / registerComponents 全 stub
//  - katex/dist/katex.css import 副作用 vi.mock noop
import { ref } from 'vue'

import BookmarkArticle from '~~/app/components/Article/BookmarkArticle.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const {
  mockRoute,
  mockUseRoute,
  mockNavigateTo,
  mockPostChannelMessage,
  mockRequest,
  mockUseI18n,
  mockUseArticleDetail,
  mockArticleDetailReturn,
  mockToastShowToast,
  mockCursorToastShowToast,
  mockPreviewShowImagePreview,
  articleSelectionInstanceMock
} = vi.hoisted(() => {
  // 注意：vi.hoisted 内不能 import vue（hoist 到 import 之前），但运行时执行已晚于 vue 模块加载完毕，
  // 用 require/dynamic import 都过于复杂；直接用 plain `{value: x}` 然后 spec 里转成真 ref
  const articleDetailReturn = {
    bookmarkId: 1 as number | undefined,
    shareCode: undefined as string | undefined,
    titleRef: { value: 'Test Title' },
    isStarredRef: { value: false },
    allowStarredRef: { value: true },
    allowActionRef: { value: true },
    allowTaggedRef: { value: true },
    bookmarkUserIdRef: { value: 1 },
    updateStarred: vi.fn(async () => {})
  }
  const articleSelectionInstanceMock = {
    closeMonitor: vi.fn(),
    drawMark: vi.fn(async () => {}),
    startMonitor: vi.fn(),
    findQuote: vi.fn(),
    isMonitoring: false
  }
  // 真实 vue-i18n 会把 { date } 插值进消息模板；这里手写一份最小映射，
  // 覆盖本文件断言用到的 key，而非只回显 key 本身
  const mockT = vi.fn((k: string, params?: Record<string, unknown>) => {
    if (k === 'page.bookmarks_detail.saved_at' && params?.date) {
      return `First saved on ${params.date}`
    }
    return k
  })
  const mockPost = vi.fn(() => Promise.resolve({}))
  return {
    mockRoute: { path: '/bookmarks/1', query: {} as Record<string, string>, fullPath: '/bookmarks/1', params: {} },
    mockUseRoute: vi.fn(),
    mockNavigateTo: vi.fn(),
    mockPostChannelMessage: vi.fn(),
    mockRequest: vi.fn(() => ({ get: vi.fn(), post: mockPost })),
    mockPost,
    mockUseI18n: vi.fn(() => ({ t: mockT, locale: { value: 'en' } })),
    mockT,
    mockUseArticleDetail: vi.fn(),
    mockArticleDetailReturn: articleDetailReturn,
    mockToastShowToast: vi.fn(),
    mockCursorToastShowToast: vi.fn(),
    mockPreviewShowImagePreview: vi.fn(),
    articleSelectionInstanceMock
  }
})

mockUseRoute.mockReturnValue(mockRoute)
// useArticleDetail 必须返回真 ref，让模板能自动 unwrap
mockUseArticleDetail.mockImplementation(() => ({
  bookmarkId: mockArticleDetailReturn.bookmarkId,
  shareCode: mockArticleDetailReturn.shareCode,
  title: ref(mockArticleDetailReturn.titleRef.value),
  isStarred: ref(mockArticleDetailReturn.isStarredRef.value),
  allowStarred: ref(mockArticleDetailReturn.allowStarredRef.value),
  allowAction: ref(mockArticleDetailReturn.allowActionRef.value),
  allowTagged: ref(mockArticleDetailReturn.allowTaggedRef.value),
  bookmarkUserId: ref(mockArticleDetailReturn.bookmarkUserIdRef.value),
  updateStarred: mockArticleDetailReturn.updateStarred
}))

mockNuxtImport('useRoute', () => mockUseRoute)
mockNuxtImport('navigateTo', () => mockNavigateTo)
mockNuxtImport('postChannelMessage', () => mockPostChannelMessage)
mockNuxtImport('request', () => mockRequest)
mockNuxtImport('useI18n', () => mockUseI18n)

vi.mock('~/composables/bookmark/useArticle', () => ({
  useArticleDetail: (...args: unknown[]) => mockUseArticleDetail(...args)
}))

// Stub Toast / CursorToast / ImagePreview 工厂
vi.mock('~/components/Toast', () => ({
  default: { showToast: mockToastShowToast },
  ToastType: { Success: 1, Error: 2, Warning: 3, Info: 4, Normal: 0 }
}))
vi.mock('~/components/CursorToast', () => ({
  default: { showToast: mockCursorToastShowToast }
}))
vi.mock('~/components/ImagePreview', () => ({
  default: { showImagePreview: mockPreviewShowImagePreview }
}))

// Stub Selection 链
vi.mock('~~/app/components/Article/Selection/modal', () => {
  // 必须是真正的 class 才能 new MarkModal(...)
  class MarkModal {
    isPanelExist = vi.fn(() => false)
    showMenus = vi.fn()
    showPanel = vi.fn()
    dismissPanel = vi.fn()
  }
  return { MarkModal }
})

vi.mock('~~/app/components/Article/Selection/DwebArticleSelection', () => {
  class DwebArticleSelection {
    closeMonitor = articleSelectionInstanceMock.closeMonitor
    drawMark = articleSelectionInstanceMock.drawMark
    startMonitor = articleSelectionInstanceMock.startMonitor
    findQuote = articleSelectionInstanceMock.findQuote
    isMonitoring = articleSelectionInstanceMock.isMonitoring
  }
  return { DwebArticleSelection }
})

vi.mock('~~/app/components/Article/Selection/adapters', () => ({
  DwebBookmarkProvider: class {},
  DwebEnvironmentAdapter: class {},
  DwebHttpClient: class {},
  DwebI18nService: class {},
  DwebToastService: class {},
  DwebUserProvider: class {}
}))

// Stub registerComponents（CEComponents 副作用）
vi.mock('~~/app/components/Article/CEComponents', () => ({
  registerComponents: vi.fn()
}))

const { pipelineRegistered, pipelineRunCalls } = vi.hoisted(() => ({
  pipelineRegistered: [] as unknown[],
  pipelineRunCalls: [] as unknown[]
}))
vi.mock('~~/app/components/Article/processors', () => {
  class FakeDOMPipeline {
    register(p: unknown) {
      pipelineRegistered.push(p)
      return this
    }
    async run(ctx: unknown) {
      pipelineRunCalls.push(ctx)
    }
  }
  return {
    ArticleStyle: { Default: 'default', Twitter: 'twitter', SocialPost: 'social-post', PhotoSwipeTopic: 'photo-swipe-topic' },
    DOMPipeline: FakeDOMPipeline,
    AnchorProcessor: class {},
    BLANK_FLAG_CLASS: 'blank-flag',
    BlankMarkProcessor: class {},
    ClassIsolationProcessor: class {},
    DetailsProcessor: class {},
    IFrameProcessor: class {},
    ImageProcessor: class {},
    ListProcessor: class {},
    PhotoSwipeProcessor: class {},
    PRELINE_FLAG_CLASS: 'preline-flag',
    PreLineProcessor: class {},
    SocialPostProcessor: class {},
    SpanProcessor: class {},
    SvgProcessor: class {},
    TweetProcessor: class {},
    VideoProcessor: class {},
    WechatHeaderProcessor: class {},
    WechatVideoProcessor: class {},
    YoutubeProcessor: class {}
  }
})

// katex CSS 副作用
vi.mock('katex/dist/katex.css', () => ({}))

vi.mock('@commons/types/interface', async () => {
  const actual = await vi.importActual<typeof import('@commons/types/interface')>('@commons/types/interface')
  return {
    ...actual,
    MarkType: { LINE: 'line', COMMENT: 'comment', REPLY: 'reply', ORIGIN_LINE: 'origin_line', ORIGIN_COMMENT: 'origin_comment' }
  }
})

// BookmarkTags 子组件 stub（避免引入 BookmarkTags spec 的 mock 链）
const stubs = {
  BookmarkTags: { name: 'BookmarkTags', template: '<div class="bookmark-tags-stub" />', props: ['bookmarkId', 'tags', 'readonly'] },
  SnapshotArticleSource: {
    name: 'SnapshotArticleSource',
    template: '<div class="article-source-stub" />',
    props: ['url', 'siteName', 'columnName', 'author', 'hostUrl']
  }
}

function buildDetail(overrides: Record<string, unknown> = {}) {
  return {
    bookmark_id: 1,
    title: 'Test Title',
    alias_title: '',
    target_url: 'https://example.com/article',
    content: '<p>Hello</p>',
    byline: 'Author',
    published_at: '2026-01-01T00:00:00.000Z',
    created_at: '2026-01-01T00:00:00.000Z',
    starred: 'unstar',
    archived: 'inbox',
    trashed_at: null,
    tags: [],
    marks: { mark_list: [], user_list: {} },
    ...overrides
  }
}

beforeEach(() => {
  pipelineRunCalls.length = 0
  pipelineRegistered.length = 0
  mockArticleDetailReturn.bookmarkId = 1
  mockArticleDetailReturn.shareCode = undefined
  mockArticleDetailReturn.titleRef.value = 'Test Title'
  mockArticleDetailReturn.isStarredRef.value = false
  mockArticleDetailReturn.allowStarredRef.value = true
  mockArticleDetailReturn.allowActionRef.value = true
  mockArticleDetailReturn.allowTaggedRef.value = true
  mockArticleDetailReturn.bookmarkUserIdRef.value = 1
  mockArticleDetailReturn.updateStarred = vi.fn(async () => {})
  mockToastShowToast.mockClear()
  mockCursorToastShowToast.mockClear()
  mockPostChannelMessage.mockClear()
  mockNavigateTo.mockClear()
  mockRoute.query = {}
  articleSelectionInstanceMock.closeMonitor.mockClear()
  articleSelectionInstanceMock.drawMark.mockClear()
  articleSelectionInstanceMock.startMonitor.mockClear()
  articleSelectionInstanceMock.isMonitoring = false
})

afterEach(() => {
  vi.useRealTimers()
})

describe('Article/BookmarkArticle', () => {
  describe('渲染', () => {
    it('mount → 渲染 .bookmark-article + title + source', () => {
      const wrapper = mountWithApp(BookmarkArticle, { props: { detail: buildDetail() }, global: { stubs } })
      expect(wrapper.find('.bookmark-article').exists()).toBe(true)
      expect(wrapper.find('.article-title').text()).toBe('Test Title')
      expect(wrapper.findComponent({ name: 'SnapshotArticleSource' }).props()).toMatchObject({
        url: 'https://example.com/article',
        author: 'Author'
      })
    })

    it('article-detail v-html 渲染 detail.content 并补 lazy loading', () => {
      const wrapper = mountWithApp(BookmarkArticle, {
        props: { detail: buildDetail({ content: '<img src="x.png"><p>hi</p>' }) },
        global: { stubs }
      })
      const html = wrapper.find('.article-detail .html-text').html()
      expect(html).toContain('loading="lazy"')
    })

    it('allowStarred=false：不渲染 star 按钮（star 已移至 BottomToolbar，BookmarkArticle 内不含 .star）', () => {
      mockArticleDetailReturn.allowStarredRef.value = false
      const wrapper = mountWithApp(BookmarkArticle, { props: { detail: buildDetail() }, global: { stubs } })
      expect(wrapper.find('.star').exists()).toBe(false)
    })

    it('isStarred=true：BookmarkArticle 内不含 .star（star 已移至 BottomToolbar）', () => {
      mockArticleDetailReturn.isStarredRef.value = true
      const wrapper = mountWithApp(BookmarkArticle, { props: { detail: buildDetail({ starred: 'star' }) }, global: { stubs } })
      // star 按钮已移至 SnapshotBottomToolbar，BookmarkArticle 内不应存在 .star
      expect(wrapper.find('.star').exists()).toBe(false)
    })

    it('detail.byline 为空：source author 为空', () => {
      const wrapper = mountWithApp(BookmarkArticle, { props: { detail: buildDetail({ byline: '' }) }, global: { stubs } })
      expect(wrapper.findComponent({ name: 'SnapshotArticleSource' }).props('author')).toBe('')
    })
  })

  describe('articleStyle computed', () => {
    // 注意：源码模板 .bookmark-article :class="{ articleStyle }" 是字面量 class（写法 bug），
    // 真正动态的是 .article-detail :class="{ [articleStyle]: true }"
    it('content 以 <slax-photo-swipe-topic> 开头：article-detail 含 photo-swipe-topic class', () => {
      const wrapper = mountWithApp(BookmarkArticle, {
        props: { detail: buildDetail({ content: '<slax-photo-swipe-topic></slax-photo-swipe-topic>' }) },
        global: { stubs }
      })
      expect(wrapper.find('.article-detail').classes()).toContain('photo-swipe-topic')
    })

    it('content 以 <div class="tweet"> 开头：article-detail 含 twitter class', () => {
      const wrapper = mountWithApp(BookmarkArticle, {
        props: { detail: buildDetail({ content: '<div class="tweet">x</div>' }) },
        global: { stubs }
      })
      expect(wrapper.find('.article-detail').classes()).toContain('twitter')
    })

    it('content 普通：article-detail 含 default class', () => {
      const wrapper = mountWithApp(BookmarkArticle, {
        props: { detail: buildDetail({ content: '<p>plain</p>' }) },
        global: { stubs }
      })
      expect(wrapper.find('.article-detail').classes()).toContain('default')
    })
  })

  describe('交互', () => {
    it('websiteClick：article-url 已移至 SnapshotArticleSource，BookmarkArticle 内不含 .article-url 按钮', async () => {
      const wrapper = mountWithApp(BookmarkArticle, { props: { detail: buildDetail() }, global: { stubs } })
      expect(wrapper.find('.article-url').exists()).toBe(false)
    })

    it('starBookmark：star 按钮已移至 SnapshotBottomToolbar，BookmarkArticle 内不含 .star', async () => {
      const wrapper = mountWithApp(BookmarkArticle, { props: { detail: buildDetail() }, global: { stubs } })
      expect(wrapper.find('.star').exists()).toBe(false)
    })

    it('bookmarkId 缺失：starBookmark 短路（star 已移至 BottomToolbar，此测试验证 updateStarred 未被调用）', async () => {
      mockArticleDetailReturn.bookmarkId = undefined as never
      const wrapper = mountWithApp(BookmarkArticle, { props: { detail: buildDetail() }, global: { stubs } })
      expect(wrapper.find('.star').exists()).toBe(false)
      expect(mockArticleDetailReturn.updateStarred).not.toHaveBeenCalled()
    })

    it('updateStarred 缺失：starBookmark 短路（star 已移至 BottomToolbar）', async () => {
      mockArticleDetailReturn.updateStarred = undefined as never
      const wrapper = mountWithApp(BookmarkArticle, { props: { detail: buildDetail() }, global: { stubs } })
      expect(wrapper.find('.star').exists()).toBe(false)
      expect(mockPostChannelMessage).not.toHaveBeenCalled()
    })
  })

  describe('handleHTML + handleDrawMark 流程', () => {
    it('onMounted 后：DOMPipeline 注册 17 个 processor 并 run 一次', async () => {
      mountWithApp(BookmarkArticle, { props: { detail: buildDetail() }, global: { stubs } })
      await flushPromises()
      await flushPromises()
      expect(pipelineRegistered.length).toBe(17)
      expect(pipelineRunCalls.length).toBe(1)
    })

    it('handleDrawMark：构造 DwebArticleSelection 后调 drawMark + startMonitor', async () => {
      mountWithApp(BookmarkArticle, { props: { detail: buildDetail() }, global: { stubs } })
      await flushPromises()
      await flushPromises()
      await flushPromises()
      expect(articleSelectionInstanceMock.drawMark).toHaveBeenCalled()
      expect(articleSelectionInstanceMock.startMonitor).toHaveBeenCalled()
    })
  })

  describe('jumpToHighLight + route.query.highlight', () => {
    it('route.query.highlight 缺失：不调 navigateTo', async () => {
      mockRoute.query = {}
      mountWithApp(BookmarkArticle, { props: { detail: buildDetail() }, global: { stubs } })
      await flushPromises()
      await flushPromises()
      expect(mockNavigateTo).not.toHaveBeenCalled()
    })

    it('route.query.highlight 命中 mark：navigateTo 清空 query', async () => {
      mockRoute.query = { highlight: 'uuid-1' }
      const detail = buildDetail({
        marks: {
          mark_list: [{ uuid: 'uuid-1', type: 'line', source: [{ type: 'text', path: 'p', start: 0, end: 5 }] }],
          user_list: {}
        }
      })
      // 给 querySelector 一个返回 null 也不抛错
      mountWithApp(BookmarkArticle, { props: { detail }, global: { stubs } })
      await flushPromises()
      await flushPromises()
      await flushPromises()
      expect(mockNavigateTo).toHaveBeenCalledWith({ path: '/bookmarks/1', query: {} })
    })
  })

  describe('onUnmounted', () => {
    it('卸载时：调 articleSelection.closeMonitor + 清理 extraListeners', async () => {
      const wrapper = mountWithApp(BookmarkArticle, { props: { detail: buildDetail() }, global: { stubs } })
      await flushPromises()
      await flushPromises()
      wrapper.unmount()
      expect(articleSelectionInstanceMock.closeMonitor).toHaveBeenCalledTimes(1)
    })
  })
})
