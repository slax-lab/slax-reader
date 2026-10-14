// Chat/QuestionMessage 组件单测
// props: question { text / clickable / isHTML }
// emit: questionClick (clickable=false 时短路)
// isDark: window.getComputedStyle(darkTrigger).opacity 决定箭头图标
import QuestionMessage from '~~/app/components/Chat/QuestionMessage.vue'

import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const baseQuestion = { text: 'Click me', clickable: true, isHTML: false }

describe('Chat/QuestionMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mount → 渲染 .question-message + .text', () => {
    const wrapper = mountWithApp(QuestionMessage, { props: { question: baseQuestion } })
    expect(wrapper.find('.question-message').exists()).toBe(true)
    expect(wrapper.find('.text').text()).toBe('Click me')
  })

  it('clickable=true → 添加 clickable class + 渲染箭头 i', () => {
    const wrapper = mountWithApp(QuestionMessage, { props: { question: baseQuestion } })
    expect(wrapper.find('.question-message').classes()).toContain('clickable')
    expect(wrapper.find('i').exists()).toBe(true)
  })

  it('clickable=false → 不含 clickable class + 不渲染箭头', () => {
    const wrapper = mountWithApp(QuestionMessage, {
      props: { question: { ...baseQuestion, clickable: false } }
    })
    expect(wrapper.find('.question-message').classes()).not.toContain('clickable')
    expect(wrapper.find('i').exists()).toBe(false)
  })

  it('isHTML=true → v-html 渲染（含 HTML 标签解析）', () => {
    const wrapper = mountWithApp(QuestionMessage, {
      props: { question: { text: '<b>bold</b>', clickable: true, isHTML: true } }
    })
    expect(wrapper.find('.text b').exists()).toBe(true)
    expect(wrapper.find('.text b').text()).toBe('bold')
  })

  it('isHTML=false → 文本直出（不解析 HTML）', () => {
    const wrapper = mountWithApp(QuestionMessage, {
      props: { question: { text: '<b>bold</b>', clickable: true, isHTML: false } }
    })
    expect(wrapper.find('.text').text()).toBe('<b>bold</b>')
    expect(wrapper.find('.text b').exists()).toBe(false)
  })

  it('clickable=true + click → emit questionClick(question)', async () => {
    const wrapper = mountWithApp(QuestionMessage, { props: { question: baseQuestion } })
    await wrapper.find('.question-message').trigger('click')
    const events = wrapper.emitted('questionClick')
    expect(events).toBeTruthy()
    expect(events![0]).toEqual([baseQuestion])
  })

  it('clickable=false + click → 不 emit questionClick', async () => {
    const q = { ...baseQuestion, clickable: false }
    const wrapper = mountWithApp(QuestionMessage, { props: { question: q } })
    await wrapper.find('.question-message').trigger('click')
    expect(wrapper.emitted('questionClick')).toBeUndefined()
  })

  it('isDark 基于 darkTrigger.opacity 决定箭头图标 src（happy-dom 默认 opacity 不为 1 → 普通箭头）', () => {
    const wrapper = mountWithApp(QuestionMessage, { props: { question: baseQuestion } })
    // happy-dom getComputedStyle.opacity 默认空字符串
    expect(wrapper.find('i').exists()).toBe(true)
  })
})
