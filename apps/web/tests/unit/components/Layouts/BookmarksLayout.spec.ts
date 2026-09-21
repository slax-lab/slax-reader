// Layouts/BookmarksLayout 组件单测
// 新结构：BookmarksTopBar + sticky sidebar + main 三栏布局
// 保留 slot：sidebar-left、content-header、content-list
// expose: isSmallScreen() 基于 smallScreenTrigger.opacity
import BookmarksLayout from '~~/app/components/Layouts/BookmarksLayout.vue'

import { useSidebarCollapsed } from '~~/app/composables/bookmark/useSidebarCollapsed'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, describe, expect, it } from 'vitest'

describe('Layouts/BookmarksLayout', () => {
  it('mount → 渲染 .bookmarks-layout + .layout + .sidebar + .main', () => {
    const wrapper = mountWithApp(BookmarksLayout)
    expect(wrapper.find('.bookmarks-layout').exists()).toBe(true)
    expect(wrapper.find('.layout').exists()).toBe(true)
    expect(wrapper.find('.sidebar').exists()).toBe(true)
    expect(wrapper.find('.main').exists()).toBe(true)
  })

  it('具名 slot sidebar-left 渲染', () => {
    const wrapper = mountWithApp(BookmarksLayout, {
      slots: { 'sidebar-left': '<div class="custom-left">L</div>' }
    })
    expect(wrapper.find('.custom-left').exists()).toBe(true)
  })

  it('具名 slot content-header / content-list 渲染', () => {
    const wrapper = mountWithApp(BookmarksLayout, {
      slots: {
        'content-header': '<div class="custom-header">H</div>',
        'content-list': '<div class="custom-list">List</div>'
      }
    })
    expect(wrapper.find('.custom-header').exists()).toBe(true)
    expect(wrapper.find('.custom-list').exists()).toBe(true)
  })

  it('暴露 isSmallScreen() 基于 trigger opacity（happy-dom 默认 opacity 不为 1）', () => {
    const wrapper = mountWithApp(BookmarksLayout)
    expect((wrapper.vm as any).isSmallScreen()).toBe(false)
  })

  it('collapsed=true → .sidebar 带 collapsed class；恢复后移除', async () => {
    const wrapper = mountWithApp(BookmarksLayout)
    const { collapsed } = useSidebarCollapsed()
    expect(wrapper.find('.sidebar').classes()).not.toContain('collapsed')
    collapsed.value = true
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sidebar').classes()).toContain('collapsed')
    collapsed.value = false
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.sidebar').classes()).not.toContain('collapsed')
  })

  afterEach(() => {
    useSidebarCollapsed().collapsed.value = false
  })
})
