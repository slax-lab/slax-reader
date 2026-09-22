// PlanPayment 組件単元テスト
// 覆盖：基础渲染 / turnstile token 触发 loadPayment / paymentElement ready 链路 / type=once 分支
//
// 依赖 mock 策略：
//   - @stripe/stripe-js：全局 mock 已在 tests/setup/fork.ts 提供（once('ready') 同步 fire）
//   - request()：PlanPayment 内 auto-import，通过 mockNuxtImport 覆盖
//   - NuxtTurnstile：全局注册组件，通过 global.stubs stub
//   - useNuxtApp().$config：runtimeConfig mock
import { mountWithApp } from '../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockPost = vi.fn()
mockNuxtImport('request', () => () => ({ post: mockPost }))

const runtimeConfig = {
  app: { baseURL: '/' },
  public: {
    STRIPE_PUBLIC_KEY: 'pk_test',
    STRIPE_SUB_PRICE_ID: 'price_sub',
    STRIPE_ONCE_PRICE_ID: 'price_once',
    STRIPE_ONTIME_PRICE_ID: 'price_ontime',
    TURNSTILE_SITE_KEY: 'turnstile-site-key'
  }
}
mockNuxtImport('useRuntimeConfig', () => () => runtimeConfig)

// NuxtTurnstile: stub 为 div，测试中通过 wrapper.vm 直接设置 turnstileCallbackToken 触发 watcher
const NuxtTurnstileStub = {
  name: 'NuxtTurnstile',
  template: '<div class="turnstile-stub"></div>',
  props: ['modelValue', 'options'],
  emits: ['update:modelValue']
}

describe('PlanPayment', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue({ client_secret: 'cs_test_secret' })
    runtimeConfig.public.TURNSTILE_SITE_KEY = 'turnstile-site-key'
  })

  it('默认渲染：.plan-payment + .order-summary + .payment-form-wrap 区块', async () => {
    const PlanPayment = await import('~~/app/components/PlanPayment.vue')
    const wrapper = mountWithApp(PlanPayment.default, {
      props: { type: 'sub', priceId: 'price_sub' },
      global: { stubs: { NuxtTurnstile: NuxtTurnstileStub } }
    })

    expect(wrapper.find('.plan-payment').exists()).toBe(true)
    expect(wrapper.find('.order-summary').exists()).toBe(true)
    expect(wrapper.find('.payment-form-wrap').exists()).toBe(true)
  })

  it('type=once 时隐藏 .order-tip 区块', async () => {
    const PlanPayment = await import('~~/app/components/PlanPayment.vue')
    const wrapper = mountWithApp(PlanPayment.default, {
      props: { type: 'once', priceId: 'price_once' },
      global: { stubs: { NuxtTurnstile: NuxtTurnstileStub } }
    })

    expect(wrapper.find('.order-tip').exists()).toBe(false)
  })

  it('turnstile token 到来后调用 loadPayment（request.post 被调用）', async () => {
    const PlanPayment = await import('~~/app/components/PlanPayment.vue')
    const wrapper = mountWithApp(PlanPayment.default, {
      props: { type: 'sub', priceId: 'price_sub' },
      global: { stubs: { NuxtTurnstile: NuxtTurnstileStub } }
    })
    // 等 onMounted 内 loadStripe 异步完成，stripe.value 才非 null
    await flushPromises()

    // 直接设置 turnstileCallbackToken ref 触发 watcher -> loadPayment
    ;(wrapper.vm as any).turnstileCallbackToken = 'cf_token_123'
    await flushPromises()

    expect(mockPost).toHaveBeenCalled()
  })

  it('Turnstile 未配置时不渲染组件并自动加载支付表单', async () => {
    runtimeConfig.public.TURNSTILE_SITE_KEY = ''
    const PlanPayment = await import('~~/app/components/PlanPayment.vue')
    const wrapper = mountWithApp(PlanPayment.default, {
      props: { type: 'sub', priceId: 'price_sub' },
      global: { stubs: { NuxtTurnstile: NuxtTurnstileStub } }
    })
    await flushPromises()

    expect(wrapper.findComponent({ name: 'NuxtTurnstile' }).exists()).toBe(false)
    expect(mockPost).toHaveBeenCalled()
  })

  it('paymentElement ready 后 isReady 为 true', async () => {
    const PlanPayment = await import('~~/app/components/PlanPayment.vue')
    const wrapper = mountWithApp(PlanPayment.default, {
      props: { type: 'sub', priceId: 'price_sub' },
      global: { stubs: { NuxtTurnstile: NuxtTurnstileStub } }
    })
    // 等 onMounted 内 loadStripe 完成
    await flushPromises()

    // 触发 turnstile token -> loadPayment -> stripe mock once('ready', cb) 同步 fire
    ;(wrapper.vm as any).turnstileCallbackToken = 'cf_token_abc'
    await flushPromises()

    // fork.ts stripe mock 的 once 同步调用 cb，isReady 应为 true
    expect((wrapper.vm as any).isReady).toBe(true)
  })
})
