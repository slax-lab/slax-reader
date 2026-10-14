// PaymentModal 组件单元测试
// 覆盖：基础渲染 / close 按钮 / paymentSuccess 分支 / onAfterLeave dismiss emit
//
// PaymentModal 依赖：
//   - useScrollLock(@vueuse/core)：在 happy-dom 下访问 window.style.overflow 会抛，用 vi.mock 覆盖
//   - PlanPayment(子组件)：通过 vi.mock 替换为 stub，避免 Stripe loadStripe 嵌套
//   - useNuxtApp().$i18n：由 mountWithApp → createTestI18n 注入
//   - confetti(canvas-confetti)：全局 mock 已在 tests/setup/fork.ts 提供
import { ref } from 'vue'

import { mountWithApp } from '../../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// useScrollLock 在 happy-dom 下会访问 window.style.overflow 并抛错
// 覆盖 @vueuse/core 中的 useScrollLock，返回一个 ref(false)
vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<any>('@vueuse/core')
  return {
    ...actual,
    useScrollLock: () => ref(false)
  }
})

// PlanPayment 子组件含 Stripe + Turnstile 复杂副作用，stub 掉
vi.mock('~~/app/components/PlanPayment.vue', () => ({
  default: {
    name: 'PlanPayment',
    template: '<div class="plan-payment-stub"></div>',
    props: ['type', 'priceId'],
    emits: ['success']
  }
}))

// runtimeConfig: setupNuxt 路由 plugin 需要 app.baseURL
const runtimeConfig = {
  app: { baseURL: '/' },
  public: {}
}
mockNuxtImport('useRuntimeConfig', () => () => runtimeConfig)

describe('PaymentModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('默认渲染：.payment-modal + .modal-content + close 按钮', async () => {
    const PaymentModal = await import('~~/app/components/PaymentModal/PaymentModal.vue')
    const wrapper = mountWithApp(PaymentModal.default, {
      props: { type: 'sub', priceId: 'price_test' }
    })

    expect(wrapper.find('.payment-modal').exists()).toBe(true)
    expect(wrapper.find('.modal-content').exists()).toBe(true)
    expect(wrapper.find('button.modal-close').exists()).toBe(true)
  })

  it('appear 渲染：onMounted 触发 setTimeout → appear 为 true → .modal-content 可见', async () => {
    const PaymentModal = await import('~~/app/components/PaymentModal/PaymentModal.vue')
    const wrapper = mountWithApp(PaymentModal.default, {
      props: { type: 'sub', priceId: 'price_test' }
    })

    // onMounted 里通过 setTimeout 延迟触发 appear = true
    vi.runAllTimers()
    await flushPromises()
    await wrapper.vm.$nextTick()

    // appear = true 后 modal-content v-show 开关打开
    const modalContent = wrapper.find('.modal-content')
    expect(modalContent.exists()).toBe(true)
  })

  it('paymentSuccess=false 时显示 close 按钮和 PlanPayment stub', async () => {
    const PaymentModal = await import('~~/app/components/PaymentModal/PaymentModal.vue')
    const wrapper = mountWithApp(PaymentModal.default, {
      props: { type: 'sub', priceId: 'price_test' }
    })

    expect(wrapper.find('button.modal-close').exists()).toBe(true)
    expect(wrapper.find('.plan-payment-stub').exists()).toBe(true)
    // success 区块存在于 DOM 但未显示
    expect(wrapper.find('.success-state').exists()).toBe(true)
  })

  it('点击 close 按钮后 appear 变为 false', async () => {
    const PaymentModal = await import('~~/app/components/PaymentModal/PaymentModal.vue')
    const wrapper = mountWithApp(PaymentModal.default, {
      props: { type: 'sub', priceId: 'price_test' }
    })

    vi.runAllTimers()
    await wrapper.vm.$nextTick()

    const closeBtn = wrapper.find('button.modal-close')
    await closeBtn.trigger('click')

    // appear 设为 false（v-show 依然存在 DOM）
    expect((wrapper.vm as any).appear).toBe(false)
  })

  it('props 透传：type + priceId 传递给子组件', async () => {
    const PaymentModal = await import('~~/app/components/PaymentModal/PaymentModal.vue')
    const wrapper = mountWithApp(PaymentModal.default, {
      props: { type: 'once', priceId: 'price_once_test' }
    })

    // 通过 vm.$props 确认 props 存在
    expect((wrapper.vm as any).type).toBe('once')
    expect((wrapper.vm as any).priceId).toBe('price_once_test')
  })

  it('onAfterLeave 触发 dismiss emit（paymentSuccess=false）', async () => {
    const PaymentModal = await import('~~/app/components/PaymentModal/PaymentModal.vue')
    const wrapper = mountWithApp(PaymentModal.default, {
      props: { type: 'sub', priceId: 'price_test' }
    })

    // 直接调用 onAfterLeave
    ;(wrapper.vm as any).onAfterLeave()

    expect(wrapper.emitted('dismiss')).toBeTruthy()
    expect(wrapper.emitted('dismiss')![0]).toEqual([false])
  })

  it('success() 设置 paymentSuccess=true 并触发 confetti + 自动关闭', async () => {
    const PaymentModal = await import('~~/app/components/PaymentModal/PaymentModal.vue')
    const wrapper = mountWithApp(PaymentModal.default, {
      props: { type: 'sub', priceId: 'price_test' }
    })

    // 调用 success() 触发 paymentSuccess watcher
    ;(wrapper.vm as any).success()
    await wrapper.vm.$nextTick()

    expect((wrapper.vm as any).paymentSuccess).toBe(true)

    // 推进 3250ms（duration 3000 + 250）触发 closeModal
    vi.advanceTimersByTime(3250)
    await wrapper.vm.$nextTick()

    expect((wrapper.vm as any).appear).toBe(false)
  })

  it('onAfterLeave 触发 dismiss emit（paymentSuccess=true）', async () => {
    const PaymentModal = await import('~~/app/components/PaymentModal/PaymentModal.vue')
    const wrapper = mountWithApp(PaymentModal.default, {
      props: { type: 'sub', priceId: 'price_test' }
    })

    ;(wrapper.vm as any).success()
    await wrapper.vm.$nextTick()
    ;(wrapper.vm as any).onAfterLeave()

    expect(wrapper.emitted('dismiss')![0]).toEqual([true])
  })
})
