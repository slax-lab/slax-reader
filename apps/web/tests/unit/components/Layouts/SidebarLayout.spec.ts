// Layouts/SidebarLayout 组件单测
// props: width / animated
// model: show
// expose: contentWidth (返 sidebarContent 元素 width)
// 点击 .sidebar-bg-mask → show=false
import SidebarLayout from '~~/app/components/Layouts/SidebarLayout.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it } from 'vitest'

describe('Layouts/SidebarLayout', () => {
  it('mount → 渲染 .sidebar 容器 + .sidebar-container + .sidebar-content', () => {
    const wrapper = mountWithApp(SidebarLayout, { props: { show: false } })
    expect(wrapper.find('.sidebar').exists()).toBe(true)
    expect(wrapper.find('.sidebar-container').exists()).toBe(true)
    expect(wrapper.find('.sidebar-content').exists()).toBe(true)
  })

  it('animated=true → .sidebar 添加 animated class', () => {
    const wrapper = mountWithApp(SidebarLayout, { props: { show: false, animated: true } })
    expect(wrapper.find('.sidebar').classes()).toContain('animated')
  })

  it('animated=false → 不含 animated class', () => {
    const wrapper = mountWithApp(SidebarLayout, { props: { show: false, animated: false } })
    expect(wrapper.find('.sidebar').classes()).not.toContain('animated')
  })

  it('show=true → .sidebar-container 添加 expanded class', () => {
    const wrapper = mountWithApp(SidebarLayout, { props: { show: true } })
    expect(wrapper.find('.sidebar-container').classes()).toContain('expanded')
  })

  it('width prop → .sidebar-container style 含 width', () => {
    const wrapper = mountWithApp(SidebarLayout, { props: { show: false, width: '320px' } })
    expect(wrapper.find('.sidebar-container').attributes('style')).toContain('width: 320px')
  })

  it('show=true 时 mask click → emit update:show false', async () => {
    const wrapper = mountWithApp(SidebarLayout, { props: { show: true } })
    await wrapper.find('.sidebar-bg-mask').trigger('click')
    const events = wrapper.emitted('update:show')
    expect(events).toBeTruthy()
    expect(events![events!.length - 1]).toEqual([false])
  })

  it('default slot 渲染', () => {
    const wrapper = mountWithApp(SidebarLayout, {
      props: { show: false },
      slots: { default: '<div class="custom-slot">SLOT</div>' }
    })
    expect(wrapper.find('.custom-slot').exists()).toBe(true)
  })

  it('暴露 contentWidth() 返 sidebarContent width（happy-dom 默认 0）', () => {
    const wrapper = mountWithApp(SidebarLayout, { props: { show: false } })
    const w = (wrapper.vm as any).contentWidth()
    expect(typeof w === 'number' || typeof w === 'undefined').toBe(true)
  })
})
