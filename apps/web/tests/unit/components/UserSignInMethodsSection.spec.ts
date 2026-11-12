import UserSignInMethodsSection from '~~/app/components/UserSignInMethodsSection.vue'

import { deriveAccountKey } from '~~/app/utils/accountContext'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserToken, clearAuth, oauth } = vi.hoisted(() => ({
  getUserToken: vi.fn(),
  clearAuth: vi.fn(),
  oauth: { callbackOrigin: '', environment: 'development', appleClientId: '' }
}))
mockNuxtImport('getUserToken', () => getUserToken)
mockNuxtImport('getClientEventHeaders', () => () => ({ 'X-CLIENT-TYPE': 'web' }))
mockNuxtImport('useAuth', () => () => ({ clearAuth }))
mockNuxtImport('useRuntimeConfig', () => () => ({
  app: { baseURL: '/' },
  public: { slaxEnv: oauth.environment, AUTH_BASE_URL: oauth.callbackOrigin || location.origin, DWEB_API_BASE_URL: 'https://api.example.test', GOOGLE_OAUTH_CLIENT_ID: 'google-client', APPLE_OAUTH_CLIENT_ID: oauth.appleClientId }
}))

const ownerToken = `fixture.${btoa('{"id":1}')}.token`
const otherToken = `fixture.${btoa('{"id":2}')}.token`
const accountKey = deriveAccountKey(ownerToken)!
const fetchMock = vi.fn<typeof fetch>()
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status })
const platforms = [{ platform: 'google', user_name: 'reader@gmail.test', created_at: new Date('2026-11-01T00:00:00Z') }]

enableAutoUnmount(afterEach)

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  getUserToken.mockReset().mockReturnValue(ownerToken)
  clearAuth.mockClear()
  sessionStorage.clear()
  localStorage.clear()
  oauth.callbackOrigin = ''
  oauth.environment = 'development'
  oauth.appleClientId = ''
})

afterEach(() => vi.unstubAllGlobals())

describe('Account sign-in methods', () => {
  it('places configured provider rows before email', () => {
    oauth.appleClientId = 'apple-client'
    const wrapper = mountWithApp(UserSignInMethodsSection, { props: { accountKey, platform: [] } })
    expect(wrapper.findAll('.login-method-name').map(row => row.text())).toEqual(['Google', 'Apple', 'Sign-in email'])
  })

  it.each(['development', 'preview', 'beta'])('displays linked identities and binds email in %s', async environment => {
    oauth.environment = environment
    localStorage.setItem('slax:last-login-email', 'previous@example.com')
    fetchMock.mockResolvedValueOnce(json({ request_id: 'bind-attempt', expires_in: 300, resend_after: 60 }))
    fetchMock.mockResolvedValueOnce(json({ email: 'Reader@example.com' }))

    const wrapper = mountWithApp(UserSignInMethodsSection, { attachTo: document.body, props: { accountKey, platform: platforms } })
    await flushPromises()
    expect(wrapper.text()).toContain('GoogleLinked')
    expect(wrapper.text()).not.toContain('Link Apple')
    await wrapper.get('button').trigger('click')
    expect((wrapper.get('input[type=email]').element as HTMLInputElement).value).toBe('')
    await wrapper.get('input[type=email]').setValue('Reader@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('[autocomplete="one-time-code"]').setValue('012345')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.example.test/v1/user/email/send', expect.objectContaining({
      body: JSON.stringify({ email: 'Reader@example.com', locale: 'en', purpose: 'bind' }),
      headers: expect.objectContaining({ Authorization: `Bearer ${ownerToken}` })
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.example.test/v1/user/setting', expect.objectContaining({
      body: JSON.stringify({
        key: 'bind_login_identity',
        value: { email: 'Reader@example.com', request_id: 'bind-attempt', code: '012345', type: 'email' }
      }),
      headers: expect.objectContaining({ Authorization: `Bearer ${ownerToken}` })
    }))
    expect(wrapper.text()).toContain('Reader@example.com')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(document.activeElement).toBe(wrapper.get('[tabindex="-1"]').element)
    expect(platforms).toHaveLength(1)
    expect(clearAuth).not.toHaveBeenCalled()
    expect(localStorage.getItem('slax:last-login-email')).toBe('previous@example.com')
  })

  it.each(['development', 'preview', 'beta', 'production'])('shows a login mailbox only in test profiles for %s', async environment => {
    oauth.environment = environment
    const wrapper = mountWithApp(UserSignInMethodsSection, { props: {
      accountKey,
      profileEmail: 'reader@example.com',
      platform: [...platforms, { platform: 'mail', user_name: 'reader@example.com', created_at: new Date('2026-11-01T00:00:00Z') }]
    } })

    expect(wrapper.text().includes('Same as profile email')).toBe(['development', 'preview', 'beta'].includes(environment))
    expect(wrapper.findAll('.login-method-row')).toHaveLength(['development', 'preview', 'beta'].includes(environment) ? 2 : 0)
    expect(wrapper.text().includes('GoogleLinked')).toBe(['development', 'preview', 'beta'].includes(environment))
    expect(wrapper.find('section').exists()).toBe(['development', 'preview', 'beta'].includes(environment))
    expect(wrapper.find('button').exists()).toBe(false)
  })

  it('shows Apple as linked from the platform list when the client is configured', () => {
    oauth.appleClientId = 'apple-client'
    const wrapper = mountWithApp(UserSignInMethodsSection, { props: {
      accountKey,
      platform: [...platforms, { platform: 'apple', user_name: 'reader@privaterelay.appleid.com', created_at: new Date('2026-11-01T00:00:00Z') }]
    } })

    expect(wrapper.text()).toContain('AppleLinked')
    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Link email'])
  })

  it('does not mistake the mail-collection platform for a login mailbox', async () => {
    const wrapper = mountWithApp(UserSignInMethodsSection, { props: {
      accountKey,
      platform: [{ platform: 'email', user_name: 'collection@example.com', created_at: new Date('2026-11-01T00:00:00Z') }]
    } })

    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Link Google', 'Link email'])
    expect(wrapper.text()).not.toContain('collection@example.com')
  })

  it('keeps email linking available when the provider callback uses a different origin', async () => {
    oauth.callbackOrigin = 'https://auth.example.test'
    const wrapper = mountWithApp(UserSignInMethodsSection, { props: { accountKey, platform: [] } })
    await flushPromises()

    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Link email'])
    expect(wrapper.text()).toContain('Provider linking is unavailable from this Web address')
  })

  it.each(['production'])('hides the entire sign-in methods section in %s', async environment => {
    oauth.environment = environment
    const wrapper = mountWithApp(UserSignInMethodsSection, { props: { accountKey, platform: [] } })
    await flushPromises()

    expect(wrapper.find('section').exists()).toBe(false)
    expect(wrapper.text()).toBe('')
    expect(wrapper.findAll('button')).toHaveLength(0)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not navigate with a provider challenge for a different sign-in method', async () => {
    fetchMock.mockResolvedValueOnce(json({ type: 'apple', state: 'link.fixture', nonce: 'nonce' }))
    const wrapper = mountWithApp(UserSignInMethodsSection, { props: { accountKey, platform: [] } })
    const previousUrl = location.href

    await wrapper.findAll('button')[0]!.trigger('click')
    await flushPromises()

    expect(wrapper.get('[role="alert"]').text()).toContain('We couldn’t link this sign-in method')
    expect(location.href).toBe(previousUrl)
    expect(sessionStorage.length).toBe(0)
  })

  it('refuses to send a code or start a provider link when another tab switches accounts', async () => {
    const wrapper = mountWithApp(UserSignInMethodsSection, { props: { accountKey, platform: [] } })
    await flushPromises()

    getUserToken.mockReturnValue(otherToken)
    const [linkGoogle, linkEmail] = wrapper.findAll('button')
    await linkEmail!.trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.get('form [role="alert"]').text()).toMatch(/session changed or expired/)
    await linkGoogle!.trigger('click')
    await flushPromises()
    expect(wrapper.get('.login-methods-error').text()).toMatch(/session changed or expired/)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(clearAuth).not.toHaveBeenCalled()
  })

  it.each([200, 401])('discards a pending provider response with status %i after another tab switches accounts', async status => {
    let finish!: (response: Response) => void
    fetchMock.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountWithApp(UserSignInMethodsSection, { props: { accountKey, platform: [] } })
    await flushPromises()

    const previousUrl = location.href
    await wrapper.findAll('button')[0]!.trigger('click')
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.example.test/v1/user/bind_link', expect.objectContaining({
      body: JSON.stringify({ platform: 'google', client_platform: 'web' }),
      headers: expect.objectContaining({ Authorization: `Bearer ${ownerToken}` })
    }))
    getUserToken.mockReturnValue(otherToken)
    finish(json({ type: 'google', state: 'link.fixture', nonce: 'nonce' }, status))
    await flushPromises()
    expect(wrapper.get('.login-methods-error').text()).toMatch(/session changed or expired/)
    expect(location.href).toBe(previousUrl)
    expect(sessionStorage.length).toBe(0)
    expect(clearAuth).not.toHaveBeenCalled()
  })
})
