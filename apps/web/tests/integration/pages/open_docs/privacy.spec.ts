// pages/(open_docs)/privacy.vue 集成测试 —— 第四期 Sprint A.3.1
// 静态文档页：渲染 <ContentRenderer> 包裹的 useAsyncData 内容；非英文 locale 命中空时回退 open_docs_en
// 关键约束：privacy/terms 是 async setup（await useAsyncData），@vue/test-utils mount 必须用 Suspense 包裹否则
//          组件不会渲染，wrapper.find 找不到任何元素
import { defineComponent, h, ref, Suspense } from 'vue'

import Privacy from '~~/app/pages/(open_docs)/privacy.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockQueryCollection, mockUseHead, mockUseAsyncData, mockUseI18n, locale, route } = vi.hoisted(() => {
  const localeRef = { value: 'en' }
  return {
    mockQueryCollection: vi.fn(),
    mockUseHead: vi.fn(),
    // 必须返回 Vue ref（{ data: ref(...) }），否则模板里 page 不会被自动 unwrap
    // v-if="page" 会因 wrapper 对象 truthy 而失效；:value="page" 也会传错
    mockUseAsyncData: vi.fn(),
    mockUseI18n: vi.fn(() => ({ locale: localeRef, t: (key: string, _values: object, options: { locale: string }) => key + '/' + options.locale, loadLocaleMessages: vi.fn() })),
    route: { params: {} as { agreementLocale?: string } },
    locale: localeRef
  }
})

mockUseAsyncData.mockImplementation((_key: unknown, fn: () => Promise<unknown>) => {
    const data = ref<unknown>()
    return Object.assign(fn().then(value => { data.value = value }), { data })
  })

mockNuxtImport('useRoute', () => () => route)
mockNuxtImport('useHead', () => mockUseHead)
mockNuxtImport('useAsyncData', () => mockUseAsyncData)
mockNuxtImport('useI18n', () => mockUseI18n)
mockNuxtImport('queryCollection', () => mockQueryCollection)

const SuspenseWrapper = defineComponent({
  components: { Privacy },
  setup() {
    return () => h(Suspense, null, { default: () => h(Privacy) })
  }
})

beforeEach(() => {
  locale.value = 'en'
  route.params = {}
  mockUseHead.mockClear()
  mockUseAsyncData.mockClear()
  mockUseAsyncData.mockImplementation((_key: unknown, fn: () => Promise<unknown>) => {
    const data = ref<unknown>()
    return Object.assign(fn().then(value => { data.value = value }), { data })
  })
  mockQueryCollection.mockReset()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pages/(open_docs)/privacy.vue', () => {
  it.each([['en', 'zh'], ['zh', 'en']])('renders the %s link independently of the %s Web preference', async (hint, preference) => {
    route.params = { agreementLocale: hint }
    locale.value = preference
    mockQueryCollection.mockReturnValue({ path: () => ({ first: vi.fn().mockResolvedValue({ body: hint }) }) })
    mountWithApp(SuspenseWrapper, { global: { stubs: { ContentRenderer: true } } })
    await flushPromises()
    expect(mockQueryCollection).toHaveBeenCalledWith('open_docs_' + hint)
    expect(mockUseHead.mock.calls[0]![0].title()).toBe('docs.title.privacy/' + hint)
    expect(locale.value).toBe(preference)
  })

  it('locale=en：从 open_docs_en 读取 /privacy 内容并 useHead 设标题', async () => {
    const fakePage = { path: '/privacy', body: 'Privacy content' }
    mockQueryCollection.mockReturnValueOnce({
      path: () => ({ first: vi.fn().mockResolvedValue(fakePage) })
    })

    const wrapper = mountWithApp(SuspenseWrapper, {
      global: {
        stubs: {
          ContentRenderer: { name: 'ContentRenderer', props: ['value'], template: '<div class="content-stub">{{ value?.body }}</div>' }
        }
      }
    })
    await flushPromises()

    expect(mockUseHead.mock.calls[0]![0].title()).toBe('docs.title.privacy/en')
    expect(mockQueryCollection).toHaveBeenCalledWith('open_docs_en')
    expect(wrapper.find('.content-stub').text()).toBe('Privacy content')
  })

  it('locale=zh 命中：返回中文集合，不回退 en', async () => {
    locale.value = 'zh'
    const zhPage = { body: '隐私正文' }
    mockQueryCollection.mockReturnValueOnce({
      path: () => ({ first: vi.fn().mockResolvedValue(zhPage) })
    })

    mountWithApp(SuspenseWrapper, {
      global: { stubs: { ContentRenderer: { template: '<div />' } } }
    })
    await flushPromises()

    expect(mockQueryCollection).toHaveBeenCalledTimes(1)
    expect(mockQueryCollection).toHaveBeenCalledWith('open_docs_zh')
  })

  it('locale=zh 命中空：回退到 open_docs_en', async () => {
    locale.value = 'zh'
    const enPage = { body: 'fallback' }
    mockQueryCollection
      .mockReturnValueOnce({ path: () => ({ first: vi.fn().mockResolvedValue(null) }) })
      .mockReturnValueOnce({ path: () => ({ first: vi.fn().mockResolvedValue(enPage) }) })

    mountWithApp(SuspenseWrapper, {
      global: { stubs: { ContentRenderer: { template: '<div />' } } }
    })
    await flushPromises()

    expect(mockQueryCollection).toHaveBeenCalledTimes(2)
    expect(mockQueryCollection).toHaveBeenNthCalledWith(2, 'open_docs_en')
  })

  it('locale=en 命中空：不重复回退（避免无限循环）', async () => {
    mockQueryCollection.mockReturnValueOnce({ path: () => ({ first: vi.fn().mockResolvedValue(null) }) })

    mountWithApp(SuspenseWrapper, {
      global: { stubs: { ContentRenderer: { template: '<div />' } } }
    })
    await flushPromises()

    expect(mockQueryCollection).toHaveBeenCalledTimes(1)
  })

  it('page 为空：不渲染 ContentRenderer', async () => {
    mockQueryCollection.mockReturnValueOnce({ path: () => ({ first: vi.fn().mockResolvedValue(null) }) })

    const wrapper = mountWithApp(SuspenseWrapper, {
      global: {
        stubs: { ContentRenderer: { name: 'ContentRenderer', template: '<div class="cr" />' } }
      }
    })
    await flushPromises()

    expect(wrapper.find('.cr').exists()).toBe(false)
  })
})
