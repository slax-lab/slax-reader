// PlanCard 组件渲染单元测试
// 覆盖：基础渲染 / 两个 plan 渲染 / CTA 文案 / highlighted plan / one-time 按钮 / CTA 点击触发 showPaymentModal
//
// 注意：不在顶层 mockNuxtImport('useNuxtApp')——会破坏 pinia payload-plugin 的 skipHydrate 初始化
// 和 setupNuxt 的路由初始化，导致 "Cannot set properties of undefined (setting 'skipHydrate')"。
// PlanCard 调用 useNuxtApp().$i18n.t() 由 setupNuxt（@nuxt/test-utils）实际 注入 $i18n；
// 需要 mockNuxtImport('useRuntimeConfig') 保留 app.baseURL / public.STRIPE_* 否则路由 plugin 崩。
//
// showPaymentModal 来自 './PaymentModal'（非 auto-import），用 vi.mock 拦截。
// postChannelMessage 是 auto-import，用 mockNuxtImport 拦截，不会在渲染阶段调用到。
import { mountWithApp } from '../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'

const { mockShowPaymentModal, mockPostChannelMessage } = vi.hoisted(() => ({
  mockShowPaymentModal: vi.fn(),
  mockPostChannelMessage: vi.fn()
}))

vi.mock('~~/app/components/PaymentModal', () => ({
  showPaymentModal: mockShowPaymentModal,
  showRedeemModal: vi.fn()
}))

mockNuxtImport('postChannelMessage', () => mockPostChannelMessage)

// setupNuxt 的 router plugin 读取 useRuntimeConfig().app.baseURL
// 缺失会导致 useRouter() 返回 undefined → .afterEach 报错
const runtimeConfig = {
  app: { baseURL: '/' },
  public: {
    STRIPE_SUB_PRICE_ID: 'price_sub_test',
    STRIPE_ONCE_PRICE_ID: 'price_once_test'
  }
}
mockNuxtImport('useRuntimeConfig', () => () => runtimeConfig)

describe('PlanCard', () => {
  it('渲染两个 plan（Free Reader + Pro Reader）', async () => {
    const PlanCard = await import('~~/app/components/PlanCard.vue')
    const wrapper = mountWithApp(PlanCard.default)

    const plans = wrapper.findAll('.plan')
    expect(plans.length).toBe(2)
  })

  it('highlighted plan 存在（index === selectedIndex === 1）', async () => {
    const PlanCard = await import('~~/app/components/PlanCard.vue')
    const wrapper = mountWithApp(PlanCard.default)

    const highlighted = wrapper.find('.plan.highlighted')
    expect(highlighted.exists()).toBe(true)
  })

  it('CTA 按钮渲染正确数量（每个 plan 至少一个 operate 按钮）', async () => {
    const PlanCard = await import('~~/app/components/PlanCard.vue')
    const wrapper = mountWithApp(PlanCard.default)

    const buttons = wrapper.findAll('.operate button')
    // 2 plans × 至少 1 button + one-time btn on highlighted plan
    expect(buttons.length).toBeGreaterThanOrEqual(2)
  })

  it('one-time-btn 只在非 index 0 的 plan 出现', async () => {
    const PlanCard = await import('~~/app/components/PlanCard.vue')
    const wrapper = mountWithApp(PlanCard.default)

    const oneTimeBtns = wrapper.findAll('.one-time-btn')
    // plan[1] 存在 one-time-btn（index !== 0）
    expect(oneTimeBtns.length).toBeGreaterThan(0)
    // plan[0]（Free Reader）不存在 one-time-btn
    const freePlan = wrapper.findAll('.plan')[0]
    expect(freePlan?.find('.one-time-btn').exists()).toBe(false)
  })

  it('点击 highlighted plan 的 CTA 按钮调用 showPaymentModal（type: sub）', async () => {
    const PlanCard = await import('~~/app/components/PlanCard.vue')
    const wrapper = mountWithApp(PlanCard.default)

    const highlightedPlan = wrapper.find('.plan.highlighted')
    const ctaBtn = highlightedPlan.find('.operate > button')
    await ctaBtn.trigger('click')

    expect(mockShowPaymentModal).toHaveBeenCalledWith(expect.objectContaining({ type: 'sub' }), expect.any(Function))
  })

  it('highlighted plan CTA 按钮文案包含价格', async () => {
    const PlanCard = await import('~~/app/components/PlanCard.vue')
    const wrapper = mountWithApp(PlanCard.default)

    const highlightedPlan = wrapper.find('.plan.highlighted')
    const ctaBtn = highlightedPlan.find('.operate > button')
    // highlighted plan shows price in button text: "Subscribe ($X.XX)"
    expect(ctaBtn.text()).toMatch(/\$/)
  })

  it('non-highlighted plan CTA 按钮文案不含价格', async () => {
    const PlanCard = await import('~~/app/components/PlanCard.vue')
    const wrapper = mountWithApp(PlanCard.default)

    const freePlan = wrapper.findAll('.plan')[0]!
    const ctaBtn = freePlan.find('.operate > button')
    // non-highlighted plan does NOT show price in button text
    expect(ctaBtn.text()).not.toMatch(/\(\$/)
  })

  it('点击 one-time-btn 调用 showPaymentModal（type: once）', async () => {
    mockShowPaymentModal.mockClear()
    const PlanCard = await import('~~/app/components/PlanCard.vue')
    const wrapper = mountWithApp(PlanCard.default)

    const oneTimeBtn = wrapper.find('.one-time-btn')
    await oneTimeBtn.trigger('click')

    expect(mockShowPaymentModal).toHaveBeenCalledWith(expect.objectContaining({ type: 'once' }), expect.any(Function))
  })

  it('month_rule 只在 highlighted plan 显示', async () => {
    const PlanCard = await import('~~/app/components/PlanCard.vue')
    const wrapper = mountWithApp(PlanCard.default)

    // month_rule is v-if="index === selectedIndex" (selectedIndex=1)
    expect(wrapper.find('.month_rule').exists()).toBe(true)
    // free plan (index 0) should not have month_rule
    const freePlan = wrapper.findAll('.plan')[0]!
    expect(freePlan.find('.month_rule').exists()).toBe(false)
  })
})
