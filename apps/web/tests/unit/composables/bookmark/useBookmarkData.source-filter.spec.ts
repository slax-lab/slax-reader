import { defineComponent, nextTick, ref } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises, mount } from '@vue/test-utils'
import { baseBookmarkItem } from '~~/tests/fixtures/bookmark'
import { createPinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createI18n } from 'vue-i18n'

const { mockGet, mockRequest } = vi.hoisted(() => {
  const get = vi.fn()
  return { mockGet: get, mockRequest: vi.fn(() => ({ get, post: vi.fn() })) }
})

mockNuxtImport('request', () => mockRequest)
mockNuxtImport('addChannelMessageHandler', () => vi.fn())
mockNuxtImport('removeChannelMessageHandler', () => vi.fn())

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<typeof import('@vueuse/core')>('@vueuse/core')
  return {
    ...actual,
    useInfiniteScroll: (_target: unknown, callback: () => unknown) => {
      Promise.resolve().then(callback)
      return { reset: vi.fn() }
    },
    useEventListener: vi.fn(),
    useDebounceFn: (fn: (...args: unknown[]) => unknown) => fn
  }
})

import { useBookmarkData } from '~/composables/bookmark/useBookmarkData'
import type { useBookmarkFilter } from '~/composables/bookmark/useBookmarkFilter'

const makeFilter = (status = 'inbox') =>
  ({
    filterStatus: ref(status),
    filterTopicIds: ref<string[]>([]),
    filterTopicName: ref(''),
    filterCollectionId: ref(0),
    filterCollectionCode: ref(''),
    filterCollectionName: ref(''),
    isInTrash: ref(false),
    isCurrentInboxTab: ref(status === 'inbox'),
    applyTopics: vi.fn(),
    applyCollection: vi.fn(),
    applyTab: vi.fn()
  }) as unknown as ReturnType<typeof useBookmarkFilter>

const mountData = (status: string, sourceDomain: ReturnType<typeof ref<string | undefined>>) => {
  let api: ReturnType<typeof useBookmarkData> | undefined
  const Host = defineComponent({
    setup() {
      api = useBookmarkData(makeFilter(status), ref(''), undefined, undefined, sourceDomain)
      return () => null
    }
  })
  const i18n = createI18n({ legacy: false, locale: 'en', messages: { zh: {}, en: {} } })
  const wrapper = mount(Host, { global: { plugins: [createPinia(), i18n] } })
  return { wrapper, api: api! }
}

describe('fork useBookmarkData source filter', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockGet.mockResolvedValue([])
  })

  it('inbox 按规范化 hostname 筛选，并同步更新列表与空态', async () => {
    mockGet.mockResolvedValueOnce([
      { ...baseBookmarkItem, id: 1, host_url: 'https://Example.com/path' },
      { ...baseBookmarkItem, id: 2, host_url: 'other.example' }
    ])
    const sourceDomain = ref<string | undefined>('example.com')
    const { api } = mountData('inbox', sourceDomain)
    await flushPromises()

    expect(api.bookmarks.value.map(bookmark => bookmark.id)).toEqual([1])
    expect(api.groupedBookmarks.value.filter(item => item.type === 'bookmark')).toHaveLength(1)

    sourceDomain.value = 'missing.example'
    await nextTick()
    expect(api.isDataEmpty.value).toBe(true)
    expect(api.showList.value).toBe(false)
  })

  it('非 inbox tab 不应用 source filter', async () => {
    mockGet.mockResolvedValueOnce([{ ...baseBookmarkItem, id: 1, host_url: 'other.example' }])
    const { api } = mountData('archive', ref('example.com'))
    await flushPromises()

    expect(api.bookmarks.value).toHaveLength(1)
  })

  it('REST 回退将 source 传给后端，并按后端分页结果展示', async () => {
    mockGet
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ ...baseBookmarkItem, id: 1, host_url: 'example.com' }])
    const sourceDomain = ref<string | undefined>()
    const { api } = mountData('inbox', sourceDomain)
    await flushPromises()

    sourceDomain.value = 'example.com'
    await flushPromises()

    expect(mockGet).toHaveBeenCalledTimes(2)
    const sourceRequest = mockGet.mock.calls[1]?.[0]
    expect(sourceRequest).toEqual(expect.objectContaining({ query: expect.objectContaining({ source: 'example.com', page: 1 }) }))
    expect(api.bookmarks.value.map(bookmark => bookmark.id)).toEqual([1])
  })
})
