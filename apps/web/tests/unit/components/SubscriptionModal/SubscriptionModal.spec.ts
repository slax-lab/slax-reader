// SubscriptionModal 组件单元测试（重构版）
// 覆盖：基础渲染 / appear 时序 / close 按钮 / overlay 点击 / onAfterLeave dismiss /
//       analyticsLog / 计费周期 Tab / onProCta type 断言
//
// Mock 策略：
//   - useScrollLock：happy-dom 下 window.style.overflow 会抛，stub 为 ref(false)
//   - PaymentModal(showPaymentModal)：stub 为 spy，校验 type 参数
//   - analyticsLog / eventLog：stub 为 spy（全局 first-party analytics 插件会调用 eventLog）
//   - useRuntimeConfig：注入含 Stripe key 的 public config（onProCta 需要）
//   - postChannelMessage / window.location.reload：成功回调测试中 stub
import { ref } from 'vue'

import { mountWithApp } from '../../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<any>('@vueuse/core')
  return { ...actual, useScrollLock: () => ref(false) }
})

const { mockShowPaymentModal } = vi.hoisted(() => ({ mockShowPaymentModal: vi.fn() }))
vi.mock('~~/app/components/PaymentModal', () => ({ showPaymentModal: mockShowPaymentModal }))

const { mockAnalyticsLog, mockEventLog } = vi.hoisted(() => ({ mockAnalyticsLog: vi.fn(), mockEventLog: vi.fn() }))
vi.mock('~~/app/utils/analytics', () => ({ analyticsLog: mockAnalyticsLog, eventLog: mockEventLog }))

const { mockPostChannelMessage } = vi.hoisted(() => ({ mockPostChannelMessage: vi.fn() }))
mockNuxtImport('postChannelMessage', () => mockPostChannelMessage)

const runtimeConfig = {
  app: { baseURL: '/' },
  public: {
    STRIPE_SUB_PRICE_ID: 'price_sub_test',
    STRIPE_ONCE_PRICE_ID: 'price_once_test',
    STRIPE_ONTIME_PRICE_ID: 'price_ontime_test'
  }
}
mockNuxtImport('useRuntimeConfig', () => () => runtimeConfig)

describe('SubscriptionModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('默认渲染：.sub-overlay + .sub-modal + close 按钮存在', async () => {
    const SubscriptionModal = await import('~~/app/components/SubscriptionModal/SubscriptionModal.vue')
    const wrapper = mountWithApp(SubscriptionModal.default)

    expect(wrapper.find('.sub-overlay').exists()).toBe(true)
    expect(wrapper.find('.sub-modal').exists()).toBe(true)
    expect(wrapper.find('button.sub-close').exists()).toBe(true)
  })

  it('onMounted → setTimeout → appear=true，两个方案卡片可见', async () => {
    const SubscriptionModal = await import('~~/app/components/SubscriptionModal/SubscriptionModal.vue')
    const wrapper = mountWithApp(SubscriptionModal.default)

    vi.runAllTimers()
    await flushPromises()
    await wrapper.vm.$nextTick()

    expect((wrapper.vm as any).appear).toBe(true)
    expect(wrapper.findAll('.sub-plan').length).toBe(2)
  })

  it('点击 close 按钮后 appear 变为 false', async () => {
    const SubscriptionModal = await import('~~/app/components/SubscriptionModal/SubscriptionModal.vue')
    const wrapper = mountWithApp(SubscriptionModal.default)

    vi.runAllTimers()
    await wrapper.vm.$nextTick()

    await wrapper.find('button.sub-close').trigger('click')

    expect((wrapper.vm as any).appear).toBe(false)
  })

  it('点击 overlay（.sub-overlay）后 appear 变为 false', async () => {
    const SubscriptionModal = await import('~~/app/components/SubscriptionModal/SubscriptionModal.vue')
    const wrapper = mountWithApp(SubscriptionModal.default)

    vi.runAllTimers()
    await wrapper.vm.$nextTick()

    await wrapper.find('.sub-overlay').trigger('click')

    expect((wrapper.vm as any).appear).toBe(false)
  })

  it('onAfterLeave 直接调用 → emit dismiss', async () => {
    const SubscriptionModal = await import('~~/app/components/SubscriptionModal/SubscriptionModal.vue')
    const wrapper = mountWithApp(SubscriptionModal.default)

    ;(wrapper.vm as any).onAfterLeave()

    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })

  it('onMounted 时 analyticsLog 以 subscription_view 事件被调用', async () => {
    const SubscriptionModal = await import('~~/app/components/SubscriptionModal/SubscriptionModal.vue')
    mountWithApp(SubscriptionModal.default)

    await flushPromises()

    expect(mockAnalyticsLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'subscription_view', presentation: 'screen' }))
  })

  it('默认计费周期为 monthly', async () => {
    const SubscriptionModal = await import('~~/app/components/SubscriptionModal/SubscriptionModal.vue')
    const wrapper = mountWithApp(SubscriptionModal.default)

    expect((wrapper.vm as any).cycle).toBe('monthly')
  })

  it('点击第二个 Tab → cycle 变为 oneoff', async () => {
    const SubscriptionModal = await import('~~/app/components/SubscriptionModal/SubscriptionModal.vue')
    const wrapper = mountWithApp(SubscriptionModal.default)

    const tabs = wrapper.findAll('.sub-cycle-tab')
    await tabs[1]!.trigger('click')

    expect((wrapper.vm as any).cycle).toBe('oneoff')
  })

  it('默认 monthly → Pro CTA 调用 showPaymentModal with type: sub', async () => {
    const SubscriptionModal = await import('~~/app/components/SubscriptionModal/SubscriptionModal.vue')
    const wrapper = mountWithApp(SubscriptionModal.default)

    vi.runAllTimers()
    await wrapper.vm.$nextTick()

    await wrapper.find('.sub-cta-primary').trigger('click')

    expect(mockShowPaymentModal).toHaveBeenCalledWith(expect.objectContaining({ type: 'sub' }), expect.any(Function))
  })

  it('切换 oneoff → Pro CTA 调用 showPaymentModal with type: once', async () => {
    const SubscriptionModal = await import('~~/app/components/SubscriptionModal/SubscriptionModal.vue')
    const wrapper = mountWithApp(SubscriptionModal.default)

    vi.runAllTimers()
    await wrapper.vm.$nextTick()

    const tabs = wrapper.findAll('.sub-cycle-tab')
    await tabs[1]!.trigger('click')
    await wrapper.find('.sub-cta-primary').trigger('click')

    expect(mockShowPaymentModal).toHaveBeenCalledWith(expect.objectContaining({ type: 'once' }), expect.any(Function))
  })

  it('showPaymentModal 成功回调 → postChannelMessage + reload 被调用', async () => {
    const reloadSpy = vi.fn()
    Object.defineProperty(window, 'location', {
      value: { ...window.location, reload: reloadSpy },
      writable: true
    })

    const SubscriptionModal = await import('~~/app/components/SubscriptionModal/SubscriptionModal.vue')
    const wrapper = mountWithApp(SubscriptionModal.default)

    vi.runAllTimers()
    await wrapper.vm.$nextTick()

    await wrapper.find('.sub-cta-primary').trigger('click')

    const successCallback = mockShowPaymentModal.mock.calls[0]![1] as (s: boolean) => void
    successCallback(true)

    expect(mockPostChannelMessage).toHaveBeenCalledWith('refresh', { type: 'page' })
    expect(reloadSpy).toHaveBeenCalled()
  })
})
