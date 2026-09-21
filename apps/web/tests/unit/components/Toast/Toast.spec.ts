// Toast/Toast 组件单测
// props: type / text
// emit: dismiss (after-leave)
// nextTick → showToast=true → 2500ms 后 showToast=false
import Toast from '~~/app/components/Toast/Toast.vue'

import { mount } from '@vue/test-utils'
import { ToastType } from '~~/app/components/Toast/type'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('Toast/Toast', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mount → 渲染 .text-toast + 包含 text', async () => {
    const wrapper = mount(Toast, { props: { type: ToastType.Success, text: 'Hello' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('.text-toast').exists()).toBe(true)
    expect(wrapper.find('.text-toast span').text()).toBe('Hello')
  })

  it('type=Success → 添加 success class', async () => {
    const wrapper = mount(Toast, { props: { type: ToastType.Success, text: 'X' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('.text-toast').classes()).toContain('success')
  })

  it('type=Error → 添加 error class', async () => {
    const wrapper = mount(Toast, { props: { type: ToastType.Error, text: 'X' } })
    await vi.advanceTimersByTimeAsync(0)
    expect(wrapper.find('.text-toast').classes()).toContain('error')
  })

  it('nextTick → showToast=true 后 v-show 显示', async () => {
    const wrapper = mount(Toast, { props: { type: ToastType.Success, text: 'X' } })
    await vi.advanceTimersByTimeAsync(0)
    const el = wrapper.find('.text-toast')
    expect(el.attributes('style') || '').not.toContain('display: none')
  })

  it('2500ms 后 showToast=false → v-show 隐藏', async () => {
    const wrapper = mount(Toast, { props: { type: ToastType.Success, text: 'X' } })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(2600)
    const el = wrapper.find('.text-toast')
    expect(el.attributes('style') || '').toContain('display: none')
  })

  it('Transition after-leave → emit dismiss', () => {
    const wrapper = mount(Toast, { props: { type: ToastType.Success, text: 'X' } })
    const transitions = wrapper.findAllComponents({ name: 'Transition' })
    transitions[0]!.vm.$emit('after-leave')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })

  it('unmount → onUnmounted 触发（console.log "component dismiss."）', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const wrapper = mount(Toast, { props: { type: ToastType.Success, text: 'X' } })
    wrapper.unmount()
    expect(consoleSpy).toHaveBeenCalledWith('component dismiss.')
    consoleSpy.mockRestore()
  })
})
