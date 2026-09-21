// CursorToast/CursorToast 组件单测
// props: text / duration (default 1000)
// emit: dismiss (after-leave)
// onMounted → showToast=true → duration ms 后 showToast=false
import CursorToast from '~~/app/components/CursorToast/CursorToast.vue'

import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('CursorToast/CursorToast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mount → 渲染 .cursor-toast 容器', async () => {
    const wrapper = mount(CursorToast, { props: { text: 'Hello' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('.cursor-toast').exists()).toBe(true)
    expect(wrapper.find('.cursor-toast span').text()).toBe('Hello')
  })

  it('onMounted → showToast=true → v-show 显示', async () => {
    const wrapper = mount(CursorToast, { props: { text: 'X' } })
    await vi.advanceTimersByTimeAsync(0)
    const el = wrapper.find('.cursor-toast')
    expect(el.attributes('style') || '').not.toContain('display: none')
  })

  it('default duration=1000ms → 1100ms 后 showToast=false', async () => {
    const wrapper = mount(CursorToast, { props: { text: 'X' } })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1100)
    const el = wrapper.find('.cursor-toast')
    expect(el.attributes('style') || '').toContain('display: none')
  })

  it('自定义 duration=2000ms → 1500ms 仍显示，2100ms 隐藏', async () => {
    const wrapper = mount(CursorToast, { props: { text: 'X', duration: 2000 } })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(1500)
    expect(wrapper.find('.cursor-toast').attributes('style') || '').not.toContain('display: none')
    await vi.advanceTimersByTimeAsync(700)
    expect(wrapper.find('.cursor-toast').attributes('style') || '').toContain('display: none')
  })

  it('Transition after-leave → emit dismiss', () => {
    const wrapper = mount(CursorToast, { props: { text: 'X' } })
    const transitions = wrapper.findAllComponents({ name: 'Transition' })
    transitions[0]!.vm.$emit('after-leave')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })
})
