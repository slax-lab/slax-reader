// apps/slax-reader-dweb/tests/setup/fork.ts
// 业务层测试依赖的全局 mock
import { config } from '@vue/test-utils'
import { vi } from 'vitest'

// NuxtLink / RouterLink：happy-dom 环境下 @nuxt/test-utils 的 mount（非 mountSuspended）
// 不会自动注册 NuxtLink，导致 "[Vue warn]: Failed to resolve component: RouterLink" 噪音。
// 全局 stub 成透传 <a> 消除警告，不影响任何业务断言。
config.global.stubs = {
  ...config.global.stubs,
  NuxtLink: { template: '<a><slot /></a>' }
}

// canvas-confetti：PaymentModal / InviteCodeModal / GetSubscribeModal 使用，本地无 canvas，纯桩
vi.mock('canvas-confetti', () => ({
  default: vi.fn()
}))

// @stripe/stripe-js：PlanPayment.vue 使用 paymentElement.{mount,on,once,unmount}
// 实测引用：app/components/PlanPayment.vue:124-126
vi.mock('@stripe/stripe-js', () => ({
  loadStripe: vi.fn(async () => ({
    elements: vi.fn(() => ({
      create: vi.fn(() => ({
        mount: vi.fn(),
        on: vi.fn(),
        once: vi.fn((event: string, cb: () => void) => {
          if (event === 'ready') cb()
        }),
        unmount: vi.fn()
      }))
    })),
    confirmPayment: vi.fn(async () => ({ error: undefined, paymentIntent: { status: 'succeeded' } }))
  }))
}))
