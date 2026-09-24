// @vitest-environment happy-dom
import * as Vue from 'vue'

import TabsSidebar from '../../../app/components/BookmarkList/TabsSidebar.vue'
import RssPanel from '../../../app/components/RssPanel.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// useI18n / useLocalePath 是 Nuxt auto-import，只能用 mockNuxtImport 拦截；vi.stubGlobal 对改写后的代码无效
const { translate, mockUseI18n, mockUseLocalePath } = vi.hoisted(() => {
  const translate = (key: string) => key
  return {
    translate,
    mockUseI18n: () => ({ t: translate, locale: { value: 'en' }, te: () => true }),
    mockUseLocalePath: () => (path: string) => path
  }
})
mockNuxtImport('useI18n', () => mockUseI18n)
mockNuxtImport('useLocalePath', () => mockUseLocalePath)

let rss: any
vi.mock('~/composables/useRss', async importOriginal => ({
  ...(await importOriginal<typeof import('../../../app/composables/useRss')>()),
  useRss: () => rss
}))
vi.mock('~/stores/user', () => ({ useUserStore: () => ({ userInfo: { userId: 1 } }) }))
vi.mock('~/composables/useLabFeatures', () => ({
  useLabFeatures: () => ({ loaded: Vue.ref(true), isEnabled: () => true, fetch: vi.fn().mockResolvedValue(undefined) })
}))
vi.mock('~/composables/bookmark/useSidebarCollapsed', () => ({ useSidebarCollapsed: () => ({ collapsed: Vue.ref(false) }) }))
const mounted: ReturnType<typeof mount>[] = []
const source = {
  id: 'a',
  title: 'Publisher',
  remark: 'My feed',
  feed_url: 'https://example.com/feed',
  site_url: null,
  next_allowed_at: '2020-01-01',
  last_success_at: null,
  refreshing: false
}
const entry = {
  id: '1',
  subscription_id: 'a',
  title: 'Cached article',
  summary: 'Summary',
  source_title: 'My feed',
  article_url: 'https://example.com/article',
  published_at: null,
  first_seen_at: '2026-09-23',
  image_url: null
}
beforeEach(() => {
  vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  })
  vi.spyOn(HTMLDialogElement.prototype, 'close').mockImplementation(function (this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  })
  rss = {
    enabled: Vue.ref(true),
    entries: Vue.ref([entry]),
    subscriptions: Vue.ref([source]),
    selected: Vue.ref('a'),
    cursor: Vue.ref(null),
    hasMore: Vue.ref(false),
    historyStatus: Vue.ref('exhausted'),
    retryAt: Vue.ref(null),
    detail: Vue.ref(null),
    loading: Vue.ref(false),
    initializing: Vue.ref(false),
    detailLoading: Vue.ref(false),
    pending: Vue.ref(false),
    error: Vue.ref(''),
    initialize: vi.fn(),
    select: vi.fn(),
    reload: vi.fn(),
    refresh: vi.fn(),
    add: vi.fn().mockResolvedValue(undefined),
    update: vi.fn().mockResolvedValue(undefined),
    remove: vi.fn(),
    save: vi.fn(),
    open: vi.fn(),
    closePreview: vi.fn()
  }
})
afterEach(() => {
  mounted.splice(0).forEach(wrapper => wrapper.unmount())
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function panel() {
  const wrapper = mount(RssPanel, {
    props: { active: true, search: '', listMode: 'card' },
    global: { mocks: { $t: translate }, stubs: { NuxtLink: { template: '<a><slot /></a>' } } }
  })
  mounted.push(wrapper)
  return wrapper
}
describe('RSS inside Inbox', () => {
  it('places RSS immediately below Inbox in the shared sidebar', async () => {
    const wrapper = mount(TabsSidebar, { global: { mocks: { $t: translate } } })
    mounted.push(wrapper)
    const buttons = wrapper.findAll('button')
    expect(buttons.slice(0, 3).map(button => button.text())).toEqual(['page.bookmarks_index.inbox', 'rss.title', 'page.bookmarks_index.starred'])
    await buttons[1].trigger('click')
    expect(wrapper.emitted('changeTab')?.[0]).toEqual(['rss', 1])
  })
  it('reuses Inbox layout controls and keeps article nodes while refreshing or switching tabs', async () => {
    const wrapper = panel(),
      original = wrapper.get('article').element
    expect(wrapper.find('.layout-switcher').exists()).toBe(true)
    rss.loading.value = true
    await Vue.nextTick()
    expect(wrapper.get('article').element).toBe(original)
    expect(wrapper.find('.skeletons').exists()).toBe(false)
    await wrapper.setProps({ active: false })
    await wrapper.setProps({ active: true })
    expect(wrapper.get('article').element).toBe(original)
    expect(wrapper.find('.bookmarks-topbar').exists()).toBe(false)
  })
  it('adds a feed with its custom display name', async () => {
    const wrapper = panel()
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'rss.add')!
      .trigger('click')
    await wrapper.get('#rss-feed-url').setValue('https://example.com/new.xml')
    await wrapper.get('#rss-remark').setValue('Daily reading')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(rss.add).toHaveBeenCalledWith('https://example.com/new.xml', 'Daily reading')
  })
  it('edits or clears the display name without replacing the subscription URL', async () => {
    const wrapper = panel()
    await wrapper.get('button[aria-label="rss.edit"]').trigger('click')
    expect((wrapper.get('#rss-feed-url').element as HTMLInputElement).readOnly).toBe(true)
    expect((wrapper.get('#rss-remark').element as HTMLInputElement).value).toBe('My feed')
    await wrapper.get('#rss-remark').setValue('')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(rss.update).toHaveBeenCalledWith('a', '')
    expect(rss.add).not.toHaveBeenCalled()
  })
})
