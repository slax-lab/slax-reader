// Modal/LoginModal 组件单测
// props: redirect (required string)
// emit: close / dismiss / success
// onMounted setTimeout → appear=true
// closeModal → appear=false
// onAfterLeave → emit dismiss
// 子组件 GoogleLoginButton 透传 redirect
import { nextTick, ref } from 'vue'

import LoginModal from '~~/app/components/Modal/LoginModal.vue'

import { consumeSnapshotSaveFeedback, startSnapshotSave } from '~/utils/bookmarkFork'

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
vi.mock('~/utils/request', () => ({ request: () => ({ post }) }))

const cookies = vi.hoisted(() => new Map<string, string>())
vi.mock('@vueuse/integrations/useCookies', () => ({
  useCookies: () => ({
    get: (key: string) => cookies.get(key),
    set: (key: string, value: string) => cookies.set(key, value),
    remove: (key: string) => cookies.delete(key)
  })
}))

enableAutoUnmount(afterEach)

const runtimeConfig = {
  app: { baseURL: '/' },
  public: { slaxEnv: 'development', APPLE_OAUTH_CLIENT_ID: 'apple-client-id', PUBLIC_BASE_URL: 'https://reader.test' }
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
    cookies.clear()
    localStorage.clear()
    sessionStorage.clear()
    runtimeConfig.public.slaxEnv = 'development'
    post.mockReset().mockResolvedValue({ request_id: 'modal-attempt', expires_in: 300, resend_after: 60 })
    verifyEmailAuth.mockReset().mockResolvedValue('session')
    runtimeConfig.public.APPLE_OAUTH_CLIENT_ID = 'apple-client-id'
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('restores the pending code step only for this continuation and forgets it on address change', async () => {
    const mount = (redirect = '/saved') => mountWithApp(LoginModal, { props: { redirect } })
    const first = mount()
    await first.get('.email-login-toggle').trigger('click')
    await first.get('input[type=email]').setValue('reader@example.com')
    await first.get('form').trigger('submit')
    await flushPromises()
    await first.get('[autocomplete="one-time-code"]').setValue('012345')
    expect(JSON.stringify(sessionStorage)).not.toContain('012345')
    first.unmount()
    const different = mount('/other')
    expect(different.find('form').exists()).toBe(false)
    different.unmount()
    const restored = mount()
    await flushPromises()
    expect(restored.get('form').text()).toContain('reader@example.com')
    expect((restored.get('[autocomplete="one-time-code"]').element as HTMLInputElement).value).toBe('')
    expect(restored.get('.email-code-actions button:last-child').attributes('disabled')).toBeDefined()
    expect(post).toHaveBeenCalledOnce()
    await restored.get('.email-code-actions button').trigger('click')
    restored.unmount()
    const cleared = mount()
    expect(cleared.find('form').exists()).toBe(false)
    cleared.unmount()
  })

  it('restores a snapshot challenge across save nonces and returns with the current nonce', async () => {
    const articleA = '00000000-0000-4000-8000-00000000000a'
    const articleB = '00000000-0000-4000-8000-00000000000b'
    const mount = (article: string, nonce: string) => mountWithApp(LoginModal, { props: {
      redirect: '/b/' + article + '?slax_save=' + nonce,
      authAttribution: { source_screen: 'detail', presentation: 'modal', trigger_element_id: 'snapshot_save_button', source_bookmark_id: article }
    } })
    const first = mount(articleA, 'first')
    await first.get('.email-login-toggle').trigger('click')
    await first.get('input[type=email]').setValue('reader@example.com')
    await first.get('form').trigger('submit')
    await flushPromises()
    first.unmount()
    const different = mount(articleB, 'second')
    expect(different.find('form').exists()).toBe(false)
    different.unmount()
    const restored = mount(articleA, 'third')
    await flushPromises()
    await restored.get('[autocomplete="one-time-code"]').setValue('012345')
    await restored.get('form').trigger('submit')
    await flushPromises()
    expect(post).toHaveBeenCalledOnce()
    expect(verifyEmailAuth.mock.calls[0]![0].auth_attribution.source_bookmark_id).toBe(articleA)
    expect(navigateTo).toHaveBeenCalledWith(location.origin + '/b/' + articleA + '?slax_save=third', { external: true })
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
    expect(wrapper.findComponent({ name: 'AppleLoginButton' }).props('authAttribution')).toBeUndefined()
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

  it.each(['development', 'preview', 'beta', 'production'])('verifies a code with collection attribution and returns to the pending subscribe action in %s', async environment => {
    runtimeConfig.public.slaxEnv = environment
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
    expect(wrapper.get('.email-code-button').attributes('disabled')).toBeDefined()
    expect(localStorage.getItem('slax:last-login-email')).toBe('reader@example.com')
  })

  it('automatically saves the source after completing email-code sign-in', async () => {
    const source = '00000000-0000-4000-8000-000000000001'
    const authAttribution = { source_screen: 'detail', presentation: 'modal', trigger_element_id: 'snapshot_save_button', source_bookmark_id: source } as const
    const redirect = new URL(startSnapshotSave(source).redirect)
    redirect.pathname = `/b/${source}`
    const wrapper = mountWithApp(LoginModal, { props: { redirect: redirect.href, authAttribution } })
    await vi.waitFor(() => expect(wrapper.get('.modal-shell').isVisible()).toBe(true))

    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('[autocomplete="one-time-code"]').setValue('012345')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(verifyEmailAuth).toHaveBeenCalledExactlyOnceWith({
      email: 'reader@example.com', request_id: 'modal-attempt', code: '012345', auth_attribution: authAttribution
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(post).toHaveBeenCalledTimes(2)
    expect(post).toHaveBeenNthCalledWith(2, expect.objectContaining({
      url: '/v1/bookmark/add_url',
      body: { target_url: `https://reader.test/b/${source}`, tags: [], snapshot_save: true },
      headers: { Authorization: 'Bearer session' }
    }))
    expect(post).toHaveBeenCalledBefore(navigateTo)
    expect(navigateTo).toHaveBeenCalledExactlyOnceWith(`${location.origin}/b/${source}`, { external: true })
    expect(consumeSnapshotSaveFeedback(source, 'session')).toBe(true)
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

  it('records snapshot save provenance and passes it to Google and Apple', async () => {
    vi.useFakeTimers()
    const authAttribution = { source_screen: 'detail', presentation: 'modal', trigger_element_id: 'snapshot_save_button', source_bookmark_id: '00000000-0000-4000-8000-000000000001' } as const
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/b/source', authAttribution } })
    await vi.runOnlyPendingTimersAsync()
    await nextTick()
    expect(eventLog).toHaveBeenCalledExactlyOnceWith({ event_name: 'screen_viewed', properties: { screen_name: 'signup', ...authAttribution } })
    expect(wrapper.findComponent({ name: 'GoogleLoginButton' }).props('authAttribution')).toEqual(authAttribution)
    expect(wrapper.findComponent({ name: 'AppleLoginButton' }).props('authAttribution')).toEqual(authAttribution)
    wrapper.unmount()
  })

  it('does not attach provenance to an ordinary login', () => {
    const wrapper = mountWithApp(LoginModal, { props: { redirect: '/bookmarks' } })
    expect(wrapper.findComponent({ name: 'GoogleLoginButton' }).props('authAttribution')).toBeUndefined()
    expect(wrapper.findComponent({ name: 'AppleLoginButton' }).props('authAttribution')).toBeUndefined()
    expect(eventLog).not.toHaveBeenCalled()
    wrapper.unmount()
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
