// Modal/LoginModal 组件单测
// props: redirect (required string)
// emit: close / dismiss / success
// onMounted setTimeout → appear=true
// closeModal → appear=false
// onAfterLeave → emit dismiss
// 子组件 GoogleLoginButton 透传 redirect
import { nextTick, ref } from 'vue'

import LoginModal from '~~/app/components/Modal/LoginModal.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { eventLog, post, verifyEmailAuth, navigateTo } = vi.hoisted(() => ({
  eventLog: vi.fn(),
  post: vi.fn(),
  verifyEmailAuth: vi.fn(),
  navigateTo: vi.fn()
}))
mockNuxtImport('eventLog', () => eventLog)
mockNuxtImport('request', () => () => ({ post }))
mockNuxtImport('useAuth', () => () => ({ verifyEmailAuth }))
mockNuxtImport('navigateTo', () => navigateTo)

enableAutoUnmount(afterEach)

const runtimeConfig = {
  app: { baseURL: '/' },
  public: { slaxEnv: 'development', APPLE_OAUTH_CLIENT_ID: 'apple-client-id' }
}
mockNuxtImport('useRuntimeConfig', () => () => runtimeConfig)

vi.mock('@vueuse/core', async () => {
  const actual = await vi.importActual<typeof import('@vueuse/core')>('@vueuse/core')
  return {
    ...actual,
    useScrollLock: () => ref(false)
  }
})

describe('Modal/LoginModal', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    runtimeConfig.public.slaxEnv = 'development'
    post.mockReset().mockResolvedValue({ request_id: 'modal-attempt', expires_in: 300, resend_after: 60 })
    verifyEmailAuth.mockReset().mockResolvedValue('session')
    runtimeConfig.public.APPLE_OAUTH_CLIENT_ID = 'apple-client-id'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('mount → 渲染 .login-modal + .modal-shell + close button', () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })
    expect(wrapper.find('.login-modal').exists()).toBe(true)
    expect(wrapper.find('.modal-shell').exists()).toBe(true)
    expect(wrapper.find('button.modal-close').exists()).toBe(true)
  })

  it('GoogleLoginButton 子组件渲染', () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })
    expect(wrapper.findComponent({ name: 'GoogleLoginButton' }).exists()).toBe(true)
  })

  it('GoogleLoginButton 接收 redirect prop', () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/bar' } })
    const btn = wrapper.findComponent({ name: 'GoogleLoginButton' })
    expect(btn.props('redirect')).toBe('/bar')
  })

  it('未配置 Apple OAuth 时隐藏 AppleLoginButton', () => {
    runtimeConfig.public.APPLE_OAUTH_CLIENT_ID = ''
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })

    expect(wrapper.findComponent({ name: 'AppleLoginButton' }).exists()).toBe(false)
  })

  it('配置 Apple OAuth 时显示 AppleLoginButton', () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })

    expect(wrapper.findComponent({ name: 'AppleLoginButton' }).exists()).toBe(true)
  })

  it.each(['preview', 'beta', 'production'])('hides modal email login in %s', async environment => {
    runtimeConfig.public.slaxEnv = environment
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })
    await flushPromises()

    expect(wrapper.find('.email-login-toggle').exists()).toBe(false)
    expect(wrapper.find('input[type=email]').exists()).toBe(false)
    expect(wrapper.findComponent({ name: 'GoogleLoginButton' }).exists()).toBe(true)
    expect(wrapper.findComponent({ name: 'AppleLoginButton' }).exists()).toBe(true)
    expect(post).not.toHaveBeenCalled()
  })

  it('close button click → appear=false', async () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })
    await wrapper.find('button.modal-close').trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('外层 .login-modal click → 触发 closeModal', async () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })
    await wrapper.find('.login-modal').trigger('click')
    expect(wrapper.exists()).toBe(true)
  })

  it('Transition after-leave → emit dismiss', async () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })
    const transitions = wrapper.findAllComponents({ name: 'Transition' })
    transitions[0]!.vm.$emit('after-leave')
    expect(wrapper.emitted('dismiss')).toBeTruthy()
  })
  it('records one contextual view only when the modal becomes visible', async () => {
    vi.useFakeTimers()
    const authAttribution = { collection_id: 'Collection123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' } as const
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/c/Collection123', authAttribution } })
    expect(eventLog).not.toHaveBeenCalled()
    await vi.runOnlyPendingTimersAsync()
    await nextTick()
    expect(wrapper.get('.modal-shell').isVisible()).toBe(true)
    expect(eventLog).toHaveBeenCalledExactlyOnceWith({ event_name: 'screen_viewed', properties: { screen_name: 'signup', ...authAttribution } })
    expect(wrapper.findComponent({ name: 'GoogleLoginButton' }).props('authAttribution')).toEqual(authAttribution)
    await wrapper.setProps({ redirect: '/c/Collection123?subscribe_after_login=1' })
    await wrapper.get('button.modal-close').trigger('click')
    expect(eventLog).toHaveBeenCalledTimes(1)
    wrapper.unmount()
    const reopened = mountWithApp(LoginModal, { props: { redirect: '/c/Collection123', authAttribution } })
    await vi.runOnlyPendingTimersAsync()
    expect(eventLog).toHaveBeenCalledTimes(2)
    reopened.unmount()
  })

  it('keeps the modal benefits and terms around the sign-in choices', () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })
    const card = wrapper.get('.modal-shell > .auth-card')
    expect(card.findAll('.auth-benefits li')).toHaveLength(3)
    expect(card.get('.auth-btns').text()).toContain('Continue with email')
    expect(card.findAll('.auth-tos a').map(link => [link.attributes('href'), link.attributes('target')]))
      .toEqual([['/terms', '_blank'], ['/privacy', '_blank']])
  })

  it('verifies a code with collection attribution and returns to the pending subscribe action', async () => {
    const redirect = '/c/Collection123?subscribe_after_login=1'
    const authAttribution = { collection_id: 'Collection123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' } as const
    const wrapper = mountWithApp(LoginModal, { props: { redirect, authAttribution } })
    await vi.waitFor(() => expect(wrapper.get('.modal-shell').isVisible()).toBe(true))

    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('[autocomplete="one-time-code"]').setValue('012345')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(post).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      url: '/v1/user/email/send',
      body: { email: 'reader@example.com', locale: 'en', purpose: 'login' }
    }))
    expect(verifyEmailAuth).toHaveBeenCalledExactlyOnceWith({
      email: 'reader@example.com', request_id: 'modal-attempt', code: '012345', auth_attribution: authAttribution
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith(`${location.origin}${redirect}`, { external: true })
  })

  it('aborts a pending email code request when the modal closes', async () => {
    post.mockImplementationOnce(() => new Promise(() => {}))
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/foo' } })
    await vi.waitFor(() => expect(wrapper.get('.modal-shell').isVisible()).toBe(true))

    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await wrapper.get('form').trigger('submit')
    const signal = post.mock.calls[0]![0].signal
    expect(signal.aborted).toBe(false)
    await wrapper.get('.modal-close').trigger('click')
    expect(signal.aborted).toBe(true)
    expect(wrapper.find('form').exists()).toBe(false)
  })

  it('does not record an unmounted prompt or an unrelated modal', async () => {
    vi.useFakeTimers()
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/bookmarks' } })
    await vi.runOnlyPendingTimersAsync()
    expect(eventLog).not.toHaveBeenCalled()
    wrapper.unmount()
    const cancelled = mountWithApp(LoginModal, { props: { redirect: '/c/Collection123', authAttribution: { collection_id: 'Collection123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' } } })
    cancelled.unmount()
    await vi.runOnlyPendingTimersAsync()
    expect(eventLog).not.toHaveBeenCalled()
  })

})
