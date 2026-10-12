import { mountWithApp } from '../../setup/mount'
import { BookmarkTabTypes } from '~~/app/composables/useBookmarkRelative'
import { describe, expect, it } from 'vitest'

// TabsSidebar 通过 auto-import 读取 BookmarkTabTypes，vi.mock 对 auto-import 无效
// 直接用 fork 的真实 BookmarkTabTypes（含 collections）验证按钮数量
const EXPECTED_TAB_COUNT = BookmarkTabTypes.length + 1 // tabs + trash button

describe('TabsSidebar', () => {
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
})
