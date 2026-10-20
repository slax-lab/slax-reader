import { mountWithApp } from '../../setup/mount'
import { BookmarkTabTypes } from '~~/app/composables/useBookmarkRelative'
import { nextTick, ref } from 'vue'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockLabs = vi.hoisted(() => ({
  features: null as any,
  loaded: null as any,
  fetch: vi.fn(),
  isEnabled: vi.fn()
}))

vi.mock('~/composables/useLabFeatures', () => ({ useLabFeatures: () => mockLabs }))
vi.mock('~/composables/rss/useRssEnabled', () => ({ useRssEnabled: () => ({ value: false }) }))

// TabsSidebar 通过 auto-import 读取 BookmarkTabTypes，vi.mock 对 auto-import 无效
// 直接用 fork 的真实 BookmarkTabTypes（含 collections）验证按钮数量
const EXPECTED_TAB_COUNT = BookmarkTabTypes.length + 1 // tabs + trash button

describe('TabsSidebar', () => {
  beforeEach(() => {
    mockLabs.features = ref([])
    mockLabs.loaded = ref(false)
    mockLabs.fetch.mockReset().mockResolvedValue(undefined)
    mockLabs.isEnabled.mockReturnValue(false)
  })

  it('renders a button for each tab type + 1 trash button', async () => {
    const { default: TabsSidebar } = await import('~/components/BookmarkList/TabsSidebar.vue')
    const wrapper = mountWithApp(TabsSidebar, {
      props: { tabType: 'inbox' }
    })
    expect(wrapper.findAll('button').length).toBe(EXPECTED_TAB_COUNT)
  })

  it('applies active class to the current tab', async () => {
    const { default: TabsSidebar } = await import('~/components/BookmarkList/TabsSidebar.vue')
    const wrapper = mountWithApp(TabsSidebar, {
      props: { tabType: 'starred' }
    })
    expect(wrapper.findAll('button.active').length).toBe(1)
  })

  it('emits changeTab with correct type when a tab is clicked', async () => {
    const { default: TabsSidebar } = await import('~/components/BookmarkList/TabsSidebar.vue')
    const wrapper = mountWithApp(TabsSidebar, {
      props: { tabType: 'inbox' }
    })
    // click the last button (trash)
    const buttons = wrapper.findAll('button')
    await buttons[buttons.length - 1]!.trigger('click')
    expect(wrapper.emitted('changeTab')).toBeTruthy()
    expect(wrapper.emitted('changeTab')![0]![0]).toBe('trashed')
  })

  it('trash button has active class when tabType is trashed', async () => {
    const { default: TabsSidebar } = await import('~/components/BookmarkList/TabsSidebar.vue')
    const wrapper = mountWithApp(TabsSidebar, {
      props: { tabType: 'trashed' }
    })
    // trash is always the last button
    const buttons = wrapper.findAll('button')
    expect(buttons[buttons.length - 1]!.classes()).toContain('active')
  })

  it('emits changeTab with tab index when a main tab is clicked', async () => {
    const { default: TabsSidebar } = await import('~/components/BookmarkList/TabsSidebar.vue')
    const wrapper = mountWithApp(TabsSidebar, {
      props: { tabType: 'inbox' }
    })
    // click first tab button
    const mainTabs = wrapper.findAll('button.sidebar-item')
    await mainTabs[0]!.trigger('click')
    expect(wrapper.emitted('changeTab')).toBeTruthy()
    expect(wrapper.emitted('changeTab')![0]![1]).toBe(0)
  })

  it('clears cached Labs on logout and refetches when another account arrives', async () => {
    const { default: TabsSidebar } = await import('~/components/BookmarkList/TabsSidebar.vue')
    const { useUserStore } = await import('~/stores/user')
    const wrapper = mountWithApp(TabsSidebar, { props: { tabType: 'inbox' } })
    const user = useUserStore()
    await nextTick()

    mockLabs.features.value = [{ key: 'rss', status: 'active', enabled: true, enabled_at: null }]
    mockLabs.loaded.value = true
    user.user = { userId: 1 } as any
    await nextTick()
    expect(mockLabs.fetch).toHaveBeenCalled()

    user.user = null
    await nextTick()
    expect(mockLabs.features.value).toEqual([])
    expect(mockLabs.loaded.value).toBe(false)

    user.user = { userId: 2 } as any
    await nextTick()
    expect(mockLabs.fetch).toHaveBeenCalledTimes(3)
    wrapper.unmount()
  })
})
