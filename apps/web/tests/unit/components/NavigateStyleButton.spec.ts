// NavigateStyleButton 组件单测
// props: title (required) + loading (optional)
// emit: action
// computed clickable = !loading
// buttonClick: loading 时短路；否则 emit action
import NavigateStyleButton from '~~/app/components/NavigateStyleButton.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it } from 'vitest'

describe('NavigateStyleButton', () => {
  it('渲染 .navigate-style-button + title 文案 + 右箭头 SVG（无旧 img）', () => {
    const wrapper = mountWithApp(NavigateStyleButton, { props: { title: 'Edit' } })
    expect(wrapper.find('.navigate-style-button').exists()).toBe(true)
    expect(wrapper.find('.nav-title').text()).toContain('Edit')
    expect(wrapper.find('.nav-arrow').exists()).toBe(true)
    expect(wrapper.find('img').exists()).toBe(false)
  })

  it('loading=false → clickable class 添加', () => {
    const wrapper = mountWithApp(NavigateStyleButton, { props: { title: 'X', loading: false } })
    expect(wrapper.find('.navigate-style-button').classes()).toContain('clickable')
  })

  it('loading=true → clickable class 不添加', () => {
    const wrapper = mountWithApp(NavigateStyleButton, { props: { title: 'X', loading: true } })
    expect(wrapper.find('.navigate-style-button').classes()).not.toContain('clickable')
  })

  it('loading=true → .loading 通过 v-show 显示', () => {
    const wrapper = mountWithApp(NavigateStyleButton, { props: { title: 'X', loading: true } })
    const loading = wrapper.find('.loading')
    expect(loading.attributes('style') || '').not.toContain('display: none')
  })

  it('loading=false → .loading 通过 v-show 隐藏', () => {
    const wrapper = mountWithApp(NavigateStyleButton, { props: { title: 'X', loading: false } })
    const loading = wrapper.find('.loading')
    expect(loading.attributes('style') || '').toContain('display: none')
  })

  it('click + loading=false → emit action', async () => {
    const wrapper = mountWithApp(NavigateStyleButton, { props: { title: 'X' } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('action')).toBeTruthy()
  })

  it('click + loading=true → 不 emit action（短路）', async () => {
    const wrapper = mountWithApp(NavigateStyleButton, { props: { title: 'X', loading: true } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('action')).toBeUndefined()
  })
})
