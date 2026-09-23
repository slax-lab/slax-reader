// SwitchToggle 组件单测
// props: modelValue / loading / disabled；emit: update:modelValue + change
// 原生 button 已支持 Enter / Space 触发 click，这里只测 click 路径
import SwitchToggle from '~~/app/components/SwitchToggle.vue'

import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

describe('SwitchToggle', () => {
  it('关态：无 on class，aria-checked=false', () => {
    const wrapper = mount(SwitchToggle, { props: { modelValue: false } })
    const button = wrapper.find('button.switch-toggle')
    expect(button.classes()).not.toContain('on')
    expect(button.attributes('role')).toBe('switch')
    expect(button.attributes('aria-checked')).toBe('false')
    expect(button.attributes('type')).toBe('button')
  })

  it('开态：on class + aria-checked=true', () => {
    const wrapper = mount(SwitchToggle, { props: { modelValue: true } })
    expect(wrapper.find('button').classes()).toContain('on')
    expect(wrapper.find('button').attributes('aria-checked')).toBe('true')
  })

  it('click → emit update:modelValue 和 change，值取反', async () => {
    const wrapper = mount(SwitchToggle, { props: { modelValue: false } })
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('update:modelValue')).toEqual([[true]])
    expect(wrapper.emitted('change')).toEqual([[true]])
  })

  it('disabled → 有 disabled 属性，click 不 emit', async () => {
    const wrapper = mount(SwitchToggle, { props: { modelValue: true, disabled: true } })
    expect(wrapper.find('button').attributes('disabled')).toBeDefined()
    expect(wrapper.find('button').classes()).toContain('disabled')
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('change')).toBeUndefined()
  })

  it('loading → knob 带 loading class，aria-busy，click 不 emit', async () => {
    const wrapper = mount(SwitchToggle, { props: { modelValue: false, loading: true } })
    expect(wrapper.find('.knob').classes()).toContain('loading')
    expect(wrapper.find('button').attributes('aria-busy')).toBe('true')
    await wrapper.find('button').trigger('click')
    expect(wrapper.emitted('change')).toBeUndefined()
  })
})
