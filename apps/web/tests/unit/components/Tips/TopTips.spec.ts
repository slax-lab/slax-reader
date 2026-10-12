// Tips/TopTips 组件单测
// 静态展示组件 + 1 个 button click
// props: isShow / tipsText / buttonText / buttonTextColor / buttonEnabled / backgroundColor
// emit: clickButton（仅在 buttonEnabled=true 时）
import TopTips from '~~/app/components/Tips/TopTips.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { describe, expect, it } from 'vitest'

const baseProps = { isShow: true, tipsText: 'Hello' }

describe('Tips/TopTips', () => {
  it('isShow=true → .top-tips v-show 显示', () => {
    const wrapper = mountWithApp(TopTips, { props: baseProps })
    const el = wrapper.find('.top-tips')
    expect(el.attributes('style') || '').not.toContain('display: none')
  })

  it('isShow=false → .top-tips v-show 隐藏', () => {
    const wrapper = mountWithApp(TopTips, { props: { ...baseProps, isShow: false } })
    const el = wrapper.find('.top-tips')
    expect(el.attributes('style') || '').toContain('display: none')
  })

  it('tipsText 渲染', () => {
    const wrapper = mountWithApp(TopTips, { props: { ...baseProps, tipsText: 'Tip Content' } })
    expect(wrapper.find('span').text()).toBe('Tip Content')
  })

  it('buttonText 渲染', () => {
    const wrapper = mountWithApp(TopTips, { props: { ...baseProps, buttonText: 'Confirm' } })
    expect(wrapper.find('button').text()).toBe('Confirm')
  })

  it('buttonEnabled=true 默认 → button 含 enabled class', () => {
    const wrapper = mountWithApp(TopTips, { props: baseProps })
    expect(wrapper.find('button').classes()).toContain('enabled')
  })

  it('buttonEnabled=false → button 不含 enabled class', () => {
    const wrapper = mountWithApp(TopTips, { props: { ...baseProps, buttonEnabled: false } })
    expect(wrapper.find('button').classes()).not.toContain('enabled')
  })

  it('button click + buttonEnabled=true → emit clickButton', async () => {
    const wrapper = mountWithApp(TopTips, { props: { ...baseProps, buttonText: 'X' } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('clickButton')).toBeTruthy()
  })

  it('button click + buttonEnabled=false → 不 emit', async () => {
    const wrapper = mountWithApp(TopTips, { props: { ...baseProps, buttonText: 'X', buttonEnabled: false } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('clickButton')).toBeUndefined()
  })

  it('backgroundColor 透传到 style', () => {
    const wrapper = mountWithApp(TopTips, { props: { ...baseProps, backgroundColor: 'rgb(255, 0, 0)' } })
    const el = wrapper.find('.top-tips')
    expect(el.attributes('style')).toContain('background')
  })

  it('buttonTextColor 透传到 button style', () => {
    const wrapper = mountWithApp(TopTips, { props: { ...baseProps, buttonTextColor: 'rgb(0, 128, 0)' } })
    const btn = wrapper.find('button')
    expect(btn.attributes('style')).toContain('color')
  })

  it('default slot v-slot:left 渲染', () => {
    const wrapper = mountWithApp(TopTips, {
      props: baseProps,
      slots: { left: '<span class="custom-left">L</span>' }
    })
    expect(wrapper.find('.custom-left').exists()).toBe(true)
  })
})
