import { ref } from 'vue'

import GetSubscribeModal from '~~/app/components/GetSubscribeModal.vue'

import { mountWithApp } from '../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

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

const { mockPost } = vi.hoisted(() => ({ mockPost: vi.fn(() => Promise.resolve({ title: 'Done', message: 'Received' })) }))
mockNuxtImport('request', () => () => ({ post: mockPost }))

const runtimeConfig = {
  app: { baseURL: '/' },
  public: { TURNSTILE_SITE_KEY: 'turnstile-site-key' }
}
mockNuxtImport('useRuntimeConfig', () => () => runtimeConfig)

const NuxtTurnstileStub = {
  name: 'NuxtTurnstile',
  template: '<div class="turnstile-stub" />',
  props: ['modelValue', 'options'],
  emits: ['update:modelValue']
}

const props = {
  subTitle: 'Receive your reward',
  confirmText: 'Confirm',
  cancelText: 'Cancel',
  activity_id: 'activity-id',
  activity_type: 'promotion'
}

describe('GetSubscribeModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeConfig.public.TURNSTILE_SITE_KEY = 'turnstile-site-key'
    mockPost.mockResolvedValue({ title: 'Done', message: 'Received' })
  })

  it('Turnstile 未配置时不渲染组件且确认按钮可以直接提交', async () => {
    runtimeConfig.public.TURNSTILE_SITE_KEY = ''
    const wrapper = mountWithApp(GetSubscribeModal, {
      props,
      global: { stubs: { NuxtTurnstile: NuxtTurnstileStub } }
    })

    expect(wrapper.find('.turnstile-stub').exists()).toBe(false)
    expect(wrapper.find('.btn-confirm').attributes('disabled')).toBeUndefined()

    await wrapper.find('.btn-confirm').trigger('click')
    await flushPromises()

    expect(mockPost).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ turnstile_token: '' }) }))
  })

  it('Turnstile 已配置时确认按钮等待 Token', async () => {
    const wrapper = mountWithApp(GetSubscribeModal, {
      props,
      global: { stubs: { NuxtTurnstile: NuxtTurnstileStub } }
    })

    expect(wrapper.find('.turnstile-stub').exists()).toBe(true)
    expect(wrapper.find('.btn-confirm').attributes('disabled')).toBeDefined()

    ;(wrapper.vm as any).turnstileToken = 'cf-token'
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.btn-confirm').attributes('disabled')).toBeUndefined()
  })
})
