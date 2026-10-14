// Layouts/DetailLayout 组件单测
// props: contentXOffset / animated
// 4 named slot：panel / tips / header / detail
// expose: contentWidth() / isSmallScreen()
import DetailLayout from '~~/app/components/Layouts/DetailLayout.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it } from 'vitest'

describe('Layouts/DetailLayout', () => {
  it('mount → 渲染 .detail-layout', () => {
    const wrapper = mountWithApp(DetailLayout)
    expect(wrapper.find('.detail-layout').exists()).toBe(true)
  })

  it('animated=true → 添加 animated class', () => {
    const wrapper = mountWithApp(DetailLayout, { props: { animated: true } })
    expect(wrapper.find('.detail-layout').classes()).toContain('animated')
  })

  it('animated=false → 不含 animated class', () => {
    const wrapper = mountWithApp(DetailLayout, { props: { animated: false } })
    expect(wrapper.find('.detail-layout').classes()).not.toContain('animated')
  })

  it('contentXOffset=20 → translateX style 应用', () => {
    const wrapper = mountWithApp(DetailLayout, { props: { contentXOffset: 20 } })
    expect(wrapper.find('.shadow-content').attributes('style')).toContain('translateX(-20px)')
  })

  it('contentXOffset=0 → 不应用 transform', () => {
    const wrapper = mountWithApp(DetailLayout, { props: { contentXOffset: 0 } })
    expect(wrapper.find('.shadow-content').attributes('style') || '').not.toContain('translateX')
  })

  it('panel slot 渲染', () => {
    const wrapper = mountWithApp(DetailLayout, {
      slots: { panel: '<div class="custom-panel">P</div>' }
    })
    expect(wrapper.find('.custom-panel').exists()).toBe(true)
  })

  it('tips slot 渲染 → tips-container 显示', () => {
    const wrapper = mountWithApp(DetailLayout, {
      slots: { tips: '<div class="custom-tips">T</div>' }
    })
    expect(wrapper.find('.tips-container').exists()).toBe(true)
    expect(wrapper.find('.custom-tips').exists()).toBe(true)
  })

  it('无 tips slot → tips-container 不渲染', () => {
    const wrapper = mountWithApp(DetailLayout)
    expect(wrapper.find('.tips-container').exists()).toBe(false)
  })

  it('header / detail slot 渲染', () => {
    const wrapper = mountWithApp(DetailLayout, {
      slots: {
        header: '<div class="custom-header">H</div>',
        detail: '<div class="custom-detail">D</div>'
      }
    })
    expect(wrapper.find('.custom-header').exists()).toBe(true)
    expect(wrapper.find('.custom-detail').exists()).toBe(true)
  })

  it('暴露 contentWidth() / isSmallScreen() 方法', () => {
    const wrapper = mountWithApp(DetailLayout)
    const vm = wrapper.vm as any
    expect(typeof vm.contentWidth).toBe('function')
    expect(typeof vm.isSmallScreen).toBe('function')
    expect(typeof vm.contentWidth()).toBe('number')
    expect(vm.isSmallScreen()).toBe(false)
  })
})
