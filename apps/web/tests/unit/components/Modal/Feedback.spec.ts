// Modal/Feedback 组件单测
// props: reportType / title / href / email / params
// emit: close / dismiss
// onMounted setTimeout → appear=true
// submitFeedback: feedback 空短路；否则调 reportFeedbackContent
// reportFeedbackContent: isLoading 短路；否则 analyticsLog + request.post + finally isLoading=false
// onAfterLeave → emit dismiss
import { ref } from 'vue'

import Feedback from '~~/app/components/Modal/Feedback.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequest, mockPost, mockAnalyticsLog } = vi.hoisted(() => {
  const mockPost = vi.fn(() => Promise.resolve({}))
  return {
    mockPost,
    mockRequest: vi.fn(() => ({ post: mockPost })),
    mockAnalyticsLog: vi.fn()
  }
})

mockNuxtImport('request', () => mockRequest)
mockNuxtImport('analyticsLog', () => mockAnalyticsLog)

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<any>('@vueuse/core')
  return {
    ...actual,
    useScrollLock: () => ref(false)
  }
})

describe('Modal/Feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mount → 渲染 .feedback-modal + textarea + submit button', () => {
    const wrapper = mountWithApp(Feedback, { props: { reportType: 'parse_error' } })
    expect(wrapper.find('.feedback-modal').exists()).toBe(true)
    expect(wrapper.find('textarea').exists()).toBe(true)
    expect(wrapper.find('button.submit').exists()).toBe(true)
  })

  it('title 非空 → .title 渲染', () => {
    const wrapper = mountWithApp(Feedback, { props: { reportType: 'x', title: 'Hello' } })
    expect(wrapper.find('.title').text()).toBe('Hello')
  })

  it('href 非空 → .link 渲染 + 包含 href 文案', () => {
    const wrapper = mountWithApp(Feedback, { props: { reportType: 'x', href: 'https://foo' } })
    expect(wrapper.find('.link').exists()).toBe(true)
    expect(wrapper.find('.link span').text()).toBe('https://foo')
  })

  it('email 非空 → .follow-up 显示（v-show）', () => {
    const wrapper = mountWithApp(Feedback, { props: { reportType: 'x', email: 'foo@bar.com' } })
    const followUp = wrapper.find('.follow-up')
    expect(followUp.attributes('style') || '').not.toContain('display: none')
  })

  it('email 空 → .follow-up v-show 隐藏', () => {
    const wrapper = mountWithApp(Feedback, { props: { reportType: 'x' } })
    const followUp = wrapper.find('.follow-up')
    expect(followUp.attributes('style') || '').toContain('display: none')
  })

  it('feedback 空 → submit class disabled + 不调 request', async () => {
    const wrapper = mountWithApp(Feedback, { props: { reportType: 'x' } })
    expect(wrapper.find('button.submit').classes()).toContain('disabled')
    await wrapper.find('button.submit').trigger('click')
    await flushPromises()
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('feedback 非空 → submit click → analyticsLog + request.post', async () => {
    const wrapper = mountWithApp(Feedback, {
      props: {
        reportType: 'parse_error',
        params: { entry_point: 'inbox' }
      }
    })
    await wrapper.find('textarea').setValue('this is feedback')
    await wrapper.find('button.submit').trigger('click')
    await flushPromises()
    expect(mockAnalyticsLog).toHaveBeenCalledWith({
      event: 'feedback_submit_start',
      scope: 'bookmark'
    })
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({
        url: '/v1/user/report',
        body: expect.objectContaining({
          type: 'parse_error',
          content: 'this is feedback',
          platform: 'web',
          // allowFollowUp 默认 true（ref(true)），非手动切换时保持默认值
          allow_follow_up: true,
          entry_point: 'inbox'
        })
      })
    )
  })

  it('follow-up click → allowFollowUp 切换 → 提交 body 含 allow_follow_up=false', async () => {
    const wrapper = mountWithApp(Feedback, { props: { reportType: 'x', email: 'foo@bar.com' } })
    // 默认 true，点击一次切到 false
    await wrapper.find('.follow-up').trigger('click')
    await wrapper.find('textarea').setValue('feedback')
    await wrapper.find('button.submit').trigger('click')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ allow_follow_up: false })
      })
    )
  })

  it('close button click → appear=false', async () => {
    const wrapper = mountWithApp(Feedback, { props: { reportType: 'x' } })
    await wrapper.find('button.close').trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('外层 .feedback-modal click → 触发 closeModal（isLoading=false）', async () => {
    const wrapper = mountWithApp(Feedback, { props: { reportType: 'x' } })
    await wrapper.find('.feedback-modal').trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('Transition after-leave → emit dismiss', async () => {
    const wrapper = mountWithApp(Feedback, { props: { reportType: 'x' } })
    const transitions = wrapper.findAllComponents({ name: 'Transition' })
    transitions[0]!.vm.$emit('after-leave')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })
})
