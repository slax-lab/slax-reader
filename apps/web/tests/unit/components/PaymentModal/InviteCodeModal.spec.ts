// InviteCodeModal 组件单元测试
// 覆盖：基础渲染 / redeem 表单 / 提交分支 / 空 code 禁用按钮 / 成功态
//
// InviteCodeModal 依赖：
//   - useScrollLock(@vueuse/core)：happy-dom 下覆盖
//   - request()：auto-import，用 mockNuxtImport + vi.hoisted 拦截
//   - Toast：来自 ~/components/Toast，vi.mock 拦截
//   - confetti：全局 mock 已在 tests/setup/fork.ts 提供
//   - vOnKeyStroke(@vueuse/components)：无需 mock，仅绑定 key 事件
import { ref } from 'vue'

import { mountWithApp } from '../../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<any>('@vueuse/core')
  return {
    ...actual,
    useScrollLock: () => ref(false)
  }
})

vi.mock('~/components/Toast', () => ({
  default: { showToast: vi.fn() },
  ToastType: { Error: 'error', Success: 'success' }
}))

const { mockRequest, mockPost } = vi.hoisted(() => {
  const mockPost = vi.fn(() => Promise.resolve({}))
  return {
    mockPost,
    mockRequest: vi.fn(() => ({ post: mockPost }))
  }
})

mockNuxtImport('request', () => mockRequest)

const runtimeConfig = {
  app: { baseURL: '/' },
  public: {}
}
mockNuxtImport('useRuntimeConfig', () => () => runtimeConfig)

describe('InviteCodeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers()
    mockPost.mockResolvedValue({})
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('默认渲染：.invitecode-modal + .modal-content + close 按钮 + redeem 区块', async () => {
    const InviteCodeModal = await import('~~/app/components/PaymentModal/InviteCodeModal.vue')
    const wrapper = mountWithApp(InviteCodeModal.default)

    expect(wrapper.find('.invitecode-modal').exists()).toBe(true)
    expect(wrapper.find('.modal-content').exists()).toBe(true)
    expect(wrapper.find('button.modal-close').exists()).toBe(true)
    expect(wrapper.find('.redeem-state').exists()).toBe(true)
  })

  it('input 为空时 save 按钮有 disabled 属性', async () => {
    const InviteCodeModal = await import('~~/app/components/PaymentModal/InviteCodeModal.vue')
    const wrapper = mountWithApp(InviteCodeModal.default)

    const saveBtn = wrapper.find('.redeem-submit')
    expect(saveBtn.attributes('disabled')).toBeDefined()
  })

  it('输入 code 后 save 按钮无 disabled 属性', async () => {
    const InviteCodeModal = await import('~~/app/components/PaymentModal/InviteCodeModal.vue')
    const wrapper = mountWithApp(InviteCodeModal.default)

    const input = wrapper.find('input')
    await input.setValue('TEST-CODE-123')

    const saveBtn = wrapper.find('.redeem-submit')
    expect(saveBtn.attributes('disabled')).toBeUndefined()
  })

  it('点击 save 按钮（有 code）→ 调用 request().post', async () => {
    const InviteCodeModal = await import('~~/app/components/PaymentModal/InviteCodeModal.vue')
    const wrapper = mountWithApp(InviteCodeModal.default)

    const input = wrapper.find('input')
    await input.setValue('VALID-CODE')

    const saveBtn = wrapper.find('.redeem-submit')
    await saveBtn.trigger('click')

    await flushPromises()

    expect(mockRequest).toHaveBeenCalled()
    expect(mockPost).toHaveBeenCalled()
  })

  it('点击 save 按钮（空 code）→ 不调用 request().post', async () => {
    const InviteCodeModal = await import('~~/app/components/PaymentModal/InviteCodeModal.vue')
    const wrapper = mountWithApp(InviteCodeModal.default)

    // redeemCode 为空，submitClick 应短路
    const saveBtn = wrapper.find('.redeem-submit')
    await saveBtn.trigger('click')

    expect(mockPost).not.toHaveBeenCalled()
  })

  it('request.post 成功 → invitecodeSuccess=true → success 区块渲染', async () => {
    const InviteCodeModal = await import('~~/app/components/PaymentModal/InviteCodeModal.vue')
    const wrapper = mountWithApp(InviteCodeModal.default)

    const input = wrapper.find('input')
    await input.setValue('VALID-CODE')

    const saveBtn = wrapper.find('.redeem-submit')
    await saveBtn.trigger('click')
    await flushPromises()

    expect((wrapper.vm as any).invitecodeSuccess).toBe(true)
    expect(wrapper.find('.success-state').exists()).toBe(true)
  })

  it('onAfterLeave 触发 dismiss emit（invitecodeSuccess=false）', async () => {
    const InviteCodeModal = await import('~~/app/components/PaymentModal/InviteCodeModal.vue')
    const wrapper = mountWithApp(InviteCodeModal.default)

    ;(wrapper.vm as any).onAfterLeave()

    expect(wrapper.emitted('dismiss')).toBeTruthy()
    expect(wrapper.emitted('dismiss')![0]).toEqual([false])
  })

  it('request 失败时 invitecodeSuccess 保持 false', async () => {
    // Suppress console.error from catch block (expected error path)
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockPost.mockRejectedValueOnce(new Error('network error'))

    const InviteCodeModal = await import('~~/app/components/PaymentModal/InviteCodeModal.vue')
    const wrapper = mountWithApp(InviteCodeModal.default)

    const input = wrapper.find('input')
    await input.setValue('BAD-CODE')
    await wrapper.find('.redeem-submit').trigger('click')
    await flushPromises()

    // error path: catch block runs, invitecodeSuccess stays false
    expect((wrapper.vm as any).invitecodeSuccess).toBe(false)
    consoleSpy.mockRestore()
  })

  it('onAfterLeave 触发 dismiss emit（invitecodeSuccess=true）', async () => {
    mockPost.mockResolvedValueOnce({ code: 'VALID', type: 'sub' })
    const InviteCodeModal = await import('~~/app/components/PaymentModal/InviteCodeModal.vue')
    const wrapper = mountWithApp(InviteCodeModal.default)

    const input = wrapper.find('input')
    await input.setValue('VALID-CODE')
    await wrapper.find('.redeem-submit').trigger('click')
    await flushPromises()
    ;(wrapper.vm as any).onAfterLeave()
    expect(wrapper.emitted('dismiss')![0]).toEqual([true])
  })
})
