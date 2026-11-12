import { nextTick } from 'vue'

import LoginView from '~~/app/components/global/LoginView.vue'

import { mountWithApp } from '../../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { get, post, verifyEmailAuth, navigate, analytics } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  verifyEmailAuth: vi.fn(),
  navigate: vi.fn(),
  analytics: vi.fn()
}))
mockNuxtImport('request', () => () => ({ get, post }))
mockNuxtImport('useAuth', () => () => ({ verifyEmailAuth }))
mockNuxtImport('navigateTo', () => navigate)
mockNuxtImport('analyticsLog', () => analytics)

const runtimeConfig = {
  app: { baseURL: '/' },
  public: {
    slaxEnv: 'development',
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
    localStorage.clear()
    runtimeConfig.public.slaxEnv = 'development'
    get.mockResolvedValue({ enabled: false })
    post.mockResolvedValue({ request_id: 'attempt', expires_in: 300, resend_after: 60 })
    verifyEmailAuth.mockReset().mockResolvedValue('session')
    navigate.mockReset().mockResolvedValue(undefined)
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

    wrapper.getComponent(NuxtTurnstileStub).vm.$emit('update:modelValue', 'cf-token')
    await nextTick()

    expect(wrapper.find('.auth-btns').exists()).toBe(true)
  })

  it('passes the same acquisition context to both enabled providers', () => {
    const authAttribution = { source: 'hackerlinks', medium: 'header', campaign: 'mvp' } as const
    const wrapper = mountWithApp(LoginView, { props: { authAttribution } })
    expect(wrapper.findComponent({ name: 'GoogleLoginButton' }).props('authAttribution')).toEqual(authAttribution)
    expect(wrapper.findComponent({ name: 'AppleLoginButton' }).props('authAttribution')).toEqual(authAttribution)
  })

  it('offers email and OAuth without a separate status request', async () => {
    const wrapper = mountWithApp(LoginView)
    await flushPromises()
    expect(wrapper.find('.email-login-toggle').exists()).toBe(true)
    expect(get).not.toHaveBeenCalled()
    expect(wrapper.findComponent({ name: 'GoogleLoginButton' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AppleLoginButton' }).exists()).toBe(true)
    wrapper.unmount()
  })

  it.each(['production'])('hides email login in %s', async environment => {
    runtimeConfig.public.slaxEnv = environment
    const wrapper = mountWithApp(LoginView)
    await flushPromises()

    expect(wrapper.find('.email-login-toggle').exists()).toBe(false)
    expect(wrapper.find('input[type=email]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'GoogleLoginButton' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AppleLoginButton' }).exists()).toBe(true)
    expect(post).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it.each(['development', 'preview', 'beta'])('sends and verifies email with referral and acquisition context in %s', async environment => {
    runtimeConfig.public.slaxEnv = environment
    get.mockResolvedValue({ enabled: true })
    runtimeConfig.public.TURNSTILE_SITE_KEY = ''
    const authAttribution = { source: 'hackerlinks', medium: 'header', campaign: 'mvp' } as const
    const redirect = `${location.origin}/bookmarks?filter=unread#saved`
    const wrapper = mountWithApp(LoginView, { props: { authAttribution, affcode: 'invite', redirect } })
    await flushPromises()
    await wrapper.get('.email-login-toggle').trigger('click')
    expect(analytics).toHaveBeenCalledWith({ event: 'user_login_start', method: 'email' })
    await wrapper.get('input[type=email]').setValue('Reader@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({
      url: '/v1/user/email/send',
      body: { email: 'Reader@example.com', locale: 'en', purpose: 'login' }
    }))
    expect(wrapper.get('button:disabled').text()).toMatch(/Resend in 60s/)
    await wrapper.get('[autocomplete="one-time-code"]').setValue('012345')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(verifyEmailAuth).toHaveBeenCalledWith({
      email: 'Reader@example.com', request_id: 'attempt', code: '012345', aff_code: 'invite', auth_attribution: authAttribution
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(navigate).toHaveBeenCalledWith(redirect, { external: true })
    expect(wrapper.get('.email-code-button').attributes('disabled')).toBeDefined()
    expect(localStorage.getItem('slax:last-login-email')).toBe('Reader@example.com')
    wrapper.unmount()
  })

  it('aborts verification when email sign-in is canceled', async () => {
    get.mockResolvedValue({ enabled: true })
    let finish!: (token: string) => void
    verifyEmailAuth.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountWithApp(LoginView)
    await flushPromises()
    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('[autocomplete="one-time-code"]').setValue('012345')
    await wrapper.get('form').trigger('submit')
    const signal = verifyEmailAuth.mock.calls[0]![1].signal
    await wrapper.get('.email-login-toggle').trigger('click')
    expect(signal.aborted).toBe(true)
    finish('late-session')
    await flushPromises()
    expect(navigate).not.toHaveBeenCalled()
    expect(localStorage.getItem('slax:last-login-email')).toBeNull()
    wrapper.unmount()
  })

  it('places Google and configured Apple before the email entry', () => {
    const wrapper = mountWithApp(LoginView)
    expect(wrapper.get('.auth-btns').element.children[0]).toBe(wrapper.getComponent({ name: 'GoogleLoginButton' }).element)
    expect(wrapper.get('.auth-btns').element.children[1]).toBe(wrapper.getComponent({ name: 'AppleLoginButton' }).element)
    expect(wrapper.get('.auth-btns').element.lastElementChild).toBe(wrapper.get('.email-login').element)
    wrapper.unmount()
  })

  it.each([
    ['previous@example.com', 'previous@example.com'],
    ['not-an-email', ''],
    ['a'.repeat(250) + '@example.com', '']
  ])('prefills only a usable remembered address: %s', async (stored, expected) => {
    localStorage.setItem('slax:last-login-email', stored)
    const wrapper = mountWithApp(LoginView)
    expect(wrapper.find('form').exists()).toBe(false)
    await wrapper.get('.email-login-toggle').trigger('click')
    expect((wrapper.get('input[type=email]').element as HTMLInputElement).value).toBe(expected)
    expect(post).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('retains the successful verification lock until the old page leaves', async () => {
    const wrapper = mountWithApp(LoginView)
    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('[autocomplete="one-time-code"]').setValue('012345')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(navigate).toHaveBeenCalledOnce()
    expect(wrapper.get('.email-code-button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('[autocomplete="one-time-code"]').attributes('disabled')).toBeDefined()
    expect(wrapper.findAll('.email-code-actions button').every(button => button.attributes('disabled') !== undefined)).toBe(true)
    expect(wrapper.get('.email-login-toggle').attributes('disabled')).toBeDefined()
    wrapper.getComponent({ name: 'EmailLoginForm' }).vm.cancel()
    expect(wrapper.find('form').exists()).toBe(true)
    await wrapper.get('form').trigger('submit')
    await wrapper.get('.email-code-button').trigger('click')
    expect(verifyEmailAuth).toHaveBeenCalledOnce()
    wrapper.unmount()
    const reopened = mountWithApp(LoginView)
    await reopened.get('.email-login-toggle').trigger('click')
    expect((reopened.get('input[type=email]').element as HTMLInputElement).value).toBe('reader@example.com')
    reopened.unmount()
  })

  it('preserves the remembered address on send and failure, then replaces it on a successful retry', async () => {
    localStorage.setItem('slax:last-login-email', 'previous@example.com')
    verifyEmailAuth.mockRejectedValueOnce(new Error('Wrong code'))
    const wrapper = mountWithApp(LoginView)
    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('next@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(localStorage.getItem('slax:last-login-email')).toBe('previous@example.com')
    await wrapper.get('[autocomplete="one-time-code"]').setValue('012345')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBeTruthy()
    expect(wrapper.get('.email-code-button').attributes('disabled')).toBeUndefined()
    expect(localStorage.getItem('slax:last-login-email')).toBe('previous@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(localStorage.getItem('slax:last-login-email')).toBe('next@example.com')
    wrapper.unmount()
  })

  it('does not turn unavailable local storage into a login failure', async () => {
    const read = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    const write = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError') })
    const wrapper = mountWithApp(LoginView)
    try {
      await wrapper.get('.email-login-toggle').trigger('click')
      expect((wrapper.get('input[type=email]').element as HTMLInputElement).value).toBe('')
      await wrapper.get('input[type=email]').setValue('reader@example.com')
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      await wrapper.get('[autocomplete="one-time-code"]').setValue('012345')
      await wrapper.get('form').trigger('submit')
      await flushPromises()
      expect(navigate).toHaveBeenCalledOnce()
      expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    } finally {
      wrapper.unmount()
      read.mockRestore()
      write.mockRestore()
    }
  })

  it('reports an explicit navigation failure instead of silently leaving a busy form', async () => {
    navigate.mockResolvedValueOnce(false)
    const wrapper = mountWithApp(LoginView)
    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('[autocomplete="one-time-code"]').setValue('012345')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBeTruthy()
    expect(wrapper.get('.email-code-button').attributes('disabled')).toBeUndefined()
    wrapper.unmount()
  })

})
