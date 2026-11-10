import AuthPage from '~~/app/pages/auth.vue'

import { RequestError } from '@commons/frontend-utils/request'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({
  route: { query: {} as Record<string, string> },
  grantAuth: vi.fn(),
  requestAuth: vi.fn(),
  requestAppleAuth: vi.fn(),
  navigateTo: vi.fn(),
  post: vi.fn()
}))

mockNuxtImport('useRoute', () => () => env.route)
mockNuxtImport('useAuth', () => () => env)
mockNuxtImport('navigateTo', () => env.navigateTo)
mockNuxtImport('request', () => () => ({ post: env.post }))
mockNuxtImport('analyticsLog', () => vi.fn())
mockNuxtImport('eventLog', () => vi.fn())
vi.mock('vue-router', async importOriginal => ({
  ...await importOriginal<typeof import('vue-router')>(),
  useRoute: () => env.route
}))

enableAutoUnmount(afterEach)

beforeEach(() => {
  vi.useFakeTimers()
  vi.clearAllMocks()
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  env.grantAuth.mockReset().mockImplementation(() => new Promise(() => {}))
  env.navigateTo.mockReset().mockResolvedValue(undefined)
  env.post.mockReset().mockResolvedValue({ linked: true })
  sessionStorage.clear()
  env.route.query = {
    code: 'synthetic-single-use-code',
    state: JSON.stringify({ nonce: 'synthetic', redirectUrl: 'https://auth.test/auth', target: '/bookmarks?filter=unread', affCode: 'referral', platform: 'google' })
  }
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('OAuth callback recovery', () => {
  it('replaces a pending login with persistent recovery at 20 seconds and cancels the request', async () => {
    const wrapper = mountWithApp(AuthPage)
    await vi.advanceTimersByTimeAsync(19_999)
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    expect(wrapper.find('[role="alert"]').text()).toMatch(/timed out/i)
    expect(wrapper.find('.i-svg-spinners\\:180-ring-with-bg').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(true)
    expect(env.grantAuth.mock.calls[0]![5].signal.aborted).toBe(true)
    expect(console.warn).toHaveBeenCalledWith('[auth] callback timed out', { phase: 'login' })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(env.navigateTo).not.toHaveBeenCalled()
  })

  it('records a safe failure phase without logging OAuth parameters or raw errors', async () => {
    env.grantAuth.mockRejectedValue(new Error('secret-provider-code-and-token'))
    mountWithApp(AuthPage)
    await flushPromises()
    expect(console.warn).toHaveBeenCalledExactlyOnceWith('[auth] callback failed', { phase: 'login' })
  })

  it.each([new TypeError('Load failed'), new Error('Google SSO error')])('renders recovery when login rejects: %s', async failure => {
    env.grantAuth.mockRejectedValue(failure)
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toMatch(/sign.in.*not.*complete/i)
    expect(wrapper.text()).not.toContain('TypeError')
    expect(wrapper.find('button').exists()).toBe(true)
    expect(env.navigateTo).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(wrapper.find('[role="alert"]').text()).not.toMatch(/timed out/i)
  })

  it('sends provider identity conflicts back to the other sign-in methods with the original context', async () => {
    const attribution = { source: 'hackerlinks', medium: 'header', campaign: 'mvp' }
    env.route.query.state = JSON.stringify({
      redirectUrl: 'https://auth.test/auth', target: '/bookmarks?filter=unread', affCode: 'referral', auth_attribution: attribution
    })
    env.grantAuth.mockRejectedValue(new RequestError({ name: 'EMAIL_AUTH_USE_EXISTING_LOGIN', code: 409, message: 'server description' }))
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Sign in with your existing method')
    const back = wrapper.get('a.auth-recovery-link')
    expect(back.text()).toBe('Back to sign in')
    const url = new URL(back.attributes('href')!, location.origin)
    expect(url.pathname).toBe('/login')
    expect(Object.fromEntries(url.searchParams)).toEqual({
      redirect: `${location.origin}/bookmarks?filter=unread`,
      aff: 'referral',
      utm_source: 'hackerlinks',
      utm_medium: 'header',
      utm_campaign: 'mvp'
    })
  })

  it('starts fresh Google authorization with the preserved return and referral context', async () => {
    env.grantAuth.mockRejectedValue(new TypeError('Load failed'))
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(env.requestAuth).toHaveBeenCalledWith({ redirect: '/bookmarks?filter=unread', affCode: 'referral' })
    expect(env.grantAuth).toHaveBeenCalledTimes(1)
  })

  it('preserves collection attribution on the login request and fresh Google authorization', async () => {
    const attribution = { collection_id: 'Collection123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' }
    env.route.query.state = JSON.stringify({ redirectUrl: 'https://auth.test/auth', target: '/c/Collection123?subscribe_after_login=1', affCode: 'referral', platform: 'google', auth_attribution: attribution })
    env.grantAuth.mockRejectedValue(new TypeError('Load failed'))
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()
    expect(env.grantAuth.mock.calls[0]![4]).toEqual(attribution)
    expect(env.grantAuth.mock.calls[0]![5].signal.aborted).toBe(false)
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(env.requestAuth).toHaveBeenCalledWith({ redirect: '/c/Collection123?subscribe_after_login=1', affCode: 'referral', authAttribution: attribution })
  })

  it('keeps login recovery available when optional collection attribution is malformed', async () => {
    env.route.query.state = JSON.stringify({ redirectUrl: 'https://auth.test/auth', target: '/bookmarks', platform: 'google', auth_attribution: { collection_id: [] } })
    env.grantAuth.mockRejectedValue(new TypeError('Load failed'))
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()
    expect(env.grantAuth.mock.calls[0]![4]).toBeUndefined()
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(env.requestAuth).toHaveBeenCalledWith({ redirect: '/bookmarks', affCode: '' })
  })

  it.each(['google', 'apple'] as const)('preserves HackerLinks acquisition on the %s login request and recovery', async platform => {
    const attribution = { source: 'hackerlinks', medium: platform === 'google' ? 'header' : 'resource_detail', campaign: 'mvp' } as const
    env.route.query.state = JSON.stringify({ redirectUrl: 'https://auth.test/auth', target: '/bookmarks', affCode: '', platform, auth_attribution: attribution })
    env.grantAuth.mockRejectedValue(new TypeError('Load failed'))
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()
    expect(env.grantAuth.mock.calls[0]![3]).toBe(platform)
    expect(env.grantAuth.mock.calls[0]![4]).toEqual(attribution)
    await wrapper.find('button').trigger('click')
    await flushPromises()
    const request = platform === 'google' ? env.requestAuth : env.requestAppleAuth
    expect(request).toHaveBeenCalledWith({ redirect: '/bookmarks', affCode: '', authAttribution: attribution })
  })

  it('drops collection attribution from an Apple callback', async () => {
    const attribution = { collection_id: 'Collection123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' }
    env.route.query.state = JSON.stringify({ redirectUrl: 'https://auth.test/auth', target: '/bookmarks', platform: 'apple', auth_attribution: attribution })
    env.grantAuth.mockRejectedValue(new TypeError('Load failed'))
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()
    expect(env.grantAuth.mock.calls[0]![4]).toBeUndefined()
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(env.requestAppleAuth).toHaveBeenCalledWith({ redirect: '/bookmarks', affCode: '' })
  })

  it('preserves the Apple provider on recovery', async () => {
    env.route.query.state = JSON.stringify({ redirectUrl: 'https://auth.test/auth', target: '/bookmarks', affCode: 'apple-ref', platform: 'apple' })
    env.grantAuth.mockRejectedValue(new Error('Apple SSO error'))
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(env.requestAppleAuth).toHaveBeenCalledWith({ redirect: '/bookmarks', affCode: 'apple-ref' })
    expect(env.requestAuth).not.toHaveBeenCalled()
  })

  it.each(['{', 'null', '[]', '{"redirectUrl":123}', '{"redirectUrl":"https://auth.test/auth","platform":"other"}'])('offers recovery without sending invalid state: %s', async state => {
    env.route.query.state = state
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(env.grantAuth).not.toHaveBeenCalled()
    await wrapper.find('button').trigger('click')
    await flushPromises()
    expect(env.requestAuth).toHaveBeenCalledWith({ redirect: '/bookmarks', affCode: '' })
  })

  it('navigates after success and clears the deadline', async () => {
    env.grantAuth.mockResolvedValue('synthetic-token')
    mountWithApp(AuthPage)
    await flushPromises()
    expect(env.navigateTo).toHaveBeenCalledWith('/bookmarks?filter=unread', { external: true })
    await vi.advanceTimersByTimeAsync(20_000)
    expect(env.grantAuth.mock.calls[0]![5].signal.aborted).toBe(false)
  })

  it.each([() => Promise.reject(new Error('Navigation failed')), () => Promise.resolve(false)])('renders recovery when success navigation fails', async navigate => {
    env.grantAuth.mockResolvedValue('synthetic-token')
    env.navigateTo.mockImplementation(navigate)
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })

  it('does not navigate if a timed-out request finishes later', async () => {
    let finish!: (token: string) => void
    env.grantAuth.mockImplementation(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountWithApp(AuthPage)
    await vi.advanceTimersByTimeAsync(20_000)
    finish('late-token')
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
    expect(env.navigateTo).not.toHaveBeenCalled()
  })

  it('cancels pending authentication and removes its timer when leaving the page', () => {
    const schedule = vi.spyOn(globalThis, 'setTimeout')
    const clear = vi.spyOn(globalThis, 'clearTimeout')
    const wrapper = mountWithApp(AuthPage)
    const signal = env.grantAuth.mock.calls[0]![5].signal
    const deadline = schedule.mock.results[schedule.mock.calls.findIndex(call => call[1] === 20_000)]!.value
    wrapper.unmount()
    expect(signal.aborted).toBe(true)
    expect(clear).toHaveBeenCalledWith(deadline)
    schedule.mockRestore()
    clear.mockRestore()
  })

  it('preserves missing-code routing', async () => {
    delete env.route.query.code
    mountWithApp(AuthPage)
    await flushPromises()
    expect(env.navigateTo).toHaveBeenCalledWith('/login')
    expect(env.grantAuth).not.toHaveBeenCalled()
  })

  it('preserves the Android handoff without a Web login', async () => {
    env.route.query.platform = 'android'
    mountWithApp(AuthPage)
    await flushPromises()
    expect(env.navigateTo).toHaveBeenCalledWith('slaxrd://auth?code=synthetic-single-use-code', { external: true })
    expect(env.grantAuth).not.toHaveBeenCalled()
  })
})


describe('Web provider linking callback', () => {
  const state = 'link.active-attempt'

  it.each(['google', 'apple'] as const)('finishes an active %s link without granting a login session', async type => {
    sessionStorage.setItem('slax:pending-provider-link', `${type}:${state}`)
    env.route.query = { state, code: 'synthetic-link-code' }
    mountWithApp(AuthPage)
    await flushPromises()

    expect(env.post).toHaveBeenCalledWith(expect.objectContaining({
      url: '/v1/user/bind',
      body: expect.objectContaining({ state, type, platform: 'web', code: 'synthetic-link-code' })
    }))
    expect(env.grantAuth).not.toHaveBeenCalled()
    expect(env.navigateTo).toHaveBeenCalledWith('/user#account', { replace: true })
    expect(sessionStorage.getItem('slax:pending-provider-link')).toBeNull()
  })

  it('does not grant a session or consume the active attempt for a different callback state', async () => {
    sessionStorage.setItem('slax:pending-provider-link', `google:${state}`)
    env.route.query = { state: 'link.different-attempt', code: 'synthetic-other-code' }
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Linking did not complete')
    expect(wrapper.get('a.auth-recovery-link').attributes('href')).toBe('/user#account')
    expect(env.post).not.toHaveBeenCalled()
    expect(env.grantAuth).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('slax:pending-provider-link')).toBe(`google:${state}`)
  })

  it('discards a canceled provider attempt and offers account settings', async () => {
    sessionStorage.setItem('slax:pending-provider-link', `apple:${state}`)
    env.route.query = { state, error: 'access_denied' }
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('Linking did not complete')
    expect(env.post).not.toHaveBeenCalled()
    expect(env.grantAuth).not.toHaveBeenCalled()
    expect(sessionStorage.getItem('slax:pending-provider-link')).toBeNull()
  })
})
