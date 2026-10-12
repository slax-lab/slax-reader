import { nextTick } from 'vue'

import LoginView from '~~/app/components/global/LoginView.vue'

import { mountWithApp } from '../../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const runtimeConfig = {
  app: { baseURL: '/' },
  public: {
    APPLE_OAUTH_CLIENT_ID: 'apple-client-id',
    TURNSTILE_SITE_KEY: 'turnstile-site-key'
  }
}
mockNuxtImport('useRuntimeConfig', () => () => runtimeConfig)
mockNuxtImport('useRoute', () => () => ({ query: {} }))

const NuxtTurnstileStub = {
  name: 'NuxtTurnstile',
  template: '<div class="turnstile-stub" />',
  props: ['modelValue', 'options'],
  emits: ['update:modelValue']
}

describe('global/LoginView', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeConfig.public.APPLE_OAUTH_CLIENT_ID = 'apple-client-id'
    runtimeConfig.public.TURNSTILE_SITE_KEY = 'turnstile-site-key'
  })

  it('未配置 Apple OAuth 时隐藏 AppleLoginButton', () => {
    runtimeConfig.public.APPLE_OAUTH_CLIENT_ID = ''
    const wrapper = mountWithApp(LoginView)

    expect(wrapper.findComponent({ name: 'AppleLoginButton' }).exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'GoogleLoginButton' }).exists()).toBe(true)
  })

  it('邀请码登录未配置 Turnstile 时不渲染验证组件并直接显示登录按钮', () => {
    runtimeConfig.public.TURNSTILE_SITE_KEY = ''
    const wrapper = mountWithApp(LoginView, {
      props: { affcode: 'invite-code' },
      global: { stubs: { NuxtTurnstile: NuxtTurnstileStub } }
    })

    expect(wrapper.find('.turnstile-stub').exists()).toBe(false)
    expect(wrapper.find('.auth-btns').exists()).toBe(true)
  })

  it('邀请码登录配置 Turnstile 时等待验证后显示登录按钮', async () => {
    const wrapper = mountWithApp(LoginView, {
      props: { affcode: 'invite-code' },
      global: { stubs: { NuxtTurnstile: NuxtTurnstileStub } }
    })

    expect(wrapper.find('.turnstile-stub').exists()).toBe(true)
    expect(wrapper.find('.auth-btns').exists()).toBe(false)

    ;(wrapper.vm as any).turnstileCallbackToken = 'cf-token'
    await nextTick()

    expect(wrapper.find('.auth-btns').exists()).toBe(true)
  })
})
