// BookmarksEmptyView 组件单测
import BookmarksEmptyView from '~~/app/components/BookmarkList/BookmarksEmptyView.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it } from 'vitest'

describe('BookmarksEmptyView', () => {
  it('渲染 title/desc，默认无 action 按钮/note', () => {
    const wrapper = mountWithApp(BookmarksEmptyView, {
      props: { title: '标题', desc: '描述' }
    })
    expect(wrapper.find('.empty-view-title').text()).toBe('标题')
    expect(wrapper.find('.empty-view-desc').text()).toBe('描述')
    expect(wrapper.find('.empty-view-action').exists()).toBe(false)
    expect(wrapper.find('.empty-view-action-note').exists()).toBe(false)
  })

  it('传 actionText → 渲染按钮；点击 → emit action', async () => {
    const wrapper = mountWithApp(BookmarksEmptyView, {
      props: { title: '标题', desc: '描述', actionText: '安装浏览器扩展' }
    })
    const btn = wrapper.find('.empty-view-action')
    expect(btn.exists()).toBe(true)
    expect(btn.text()).toBe('安装浏览器扩展')
    await btn.trigger('click')
    expect(wrapper.emitted('action')).toBeTruthy()
  })

  it('传 actionNote 但不传 actionText → 不渲染按钮，也不渲染 note（note 依附按钮场景）', () => {
    const wrapper = mountWithApp(BookmarksEmptyView, {
      props: { title: '标题', desc: '描述', actionNote: '约 1 分钟完成设置' }
    })
    expect(wrapper.find('.empty-view-action').exists()).toBe(false)
    expect(wrapper.find('.empty-view-action-note').exists()).toBe(true)
  })

  it('同时传 actionText + actionNote → 都渲染', () => {
    const wrapper = mountWithApp(BookmarksEmptyView, {
      props: { title: '标题', desc: '描述', actionText: '安装浏览器扩展', actionNote: '约 1 分钟完成设置' }
    })
    expect(wrapper.find('.empty-view-action').exists()).toBe(true)
    expect(wrapper.find('.empty-view-action-note').text()).toBe('约 1 分钟完成设置')
  })

  it('自定义 #icon slot 覆盖默认 svg', () => {
    const wrapper = mountWithApp(BookmarksEmptyView, {
      props: { title: '标题', desc: '描述' },
      slots: { icon: '<span class="custom-icon">X</span>' }
    })
    expect(wrapper.find('.custom-icon').exists()).toBe(true)
  })
})
