// CursorToast/CursorToast 组件单测
// props: text / duration (default 1000)
// emit: dismiss (after-leave)
// onMounted → showToast=true → duration ms 后 showToast=false
import CursorToast from '~~/app/components/CursorToast/CursorToast.vue'

import { mount } from '@vue/test-utils'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
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

  it('action：渲染动作按钮，点击执行回调并隐藏', async () => {
    const onClick = vi.fn()
    const wrapper = mount(CursorToast, { props: { text: 'X', action: { text: 'View starred', onClick } } })
    await vi.advanceTimersByTimeAsync(0)

    expect(wrapper.find('.cursor-toast').classes()).toContain('with-action')
    const button = wrapper.find('.cursor-toast-action')
    expect(button.text()).toBe('View starred')
    await button.trigger('click')

    expect(onClick).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.cursor-toast').attributes('style') || '').toContain('display: none')
  })

  it('action 是轻量单行操作：普通字重、无下划线、accent 色', () => {
    const source = readFileSync(resolve(process.cwd(), 'app/components/CursorToast/CursorToast.vue'), 'utf8')
    const actionRule = source.match(/\.cursor-toast-action\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
    const actionBubbleRule = source.match(/&\.with-action\s*\{([\s\S]*?)\n\s*\}/)?.[1] ?? ''

    expect(actionRule).toContain('color: var(--slax-accent)')
    expect(actionRule).toContain('font-weight: 400')
    expect(actionRule).not.toContain('font-weight: 600')
    expect(actionRule).not.toContain('text-decoration: underline')
    expect(actionRule).toContain('white-space: nowrap')
    expect(source).not.toContain('whitespace-normal')
    expect(actionBubbleRule).toContain('max-width: min(320px, calc(100vw - 24px))')
    // 回归：action 气泡的宽度限制不能依赖相对零宽容器的百分比。
    expect(actionBubbleRule).not.toContain('100%')
  })

  it('about four seconds：3900ms 仍显示，4100ms 隐藏', async () => {
    const wrapper = mount(CursorToast, { props: { text: 'X', duration: 4000 } })
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(3900)
    expect(wrapper.find('.cursor-toast').attributes('style') || '').not.toContain('display: none')
    await vi.advanceTimersByTimeAsync(200)
    expect(wrapper.find('.cursor-toast').attributes('style') || '').toContain('display: none')
  })
})
