import AccountLoginMethods from '~~/app/components/Login/AccountLoginMethods.vue'

import { deriveAccountKey } from '~~/app/utils/accountContext'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserToken, clearAuth, oauth } = vi.hoisted(() => ({
  getUserToken: vi.fn(),
  clearAuth: vi.fn(),
  oauth: { callbackOrigin: '' }
}))
mockNuxtImport('getUserToken', () => getUserToken)
mockNuxtImport('getClientEventHeaders', () => () => ({ 'X-CLIENT-TYPE': 'web' }))
mockNuxtImport('useAuth', () => () => ({ clearAuth }))
mockNuxtImport('useRuntimeConfig', () => () => ({
  app: { baseURL: '/' },
  public: { AUTH_BASE_URL: oauth.callbackOrigin || location.origin, DWEB_API_BASE_URL: 'https://api.example.test', GOOGLE_OAUTH_CLIENT_ID: 'google-client' }
}))

const ownerToken = `fixture.${btoa('{"id":1}')}.token`
const otherToken = `fixture.${btoa('{"id":2}')}.token`
const accountKey = deriveAccountKey(ownerToken)!
const fetchMock = vi.fn<typeof fetch>()
const json = (data: unknown, status = 200) => new Response(JSON.stringify({ data }), { status })
const identities = { enabled: true, show_email_binding: true, email: null, google: true, apple: false }

enableAutoUnmount(afterEach)

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  getUserToken.mockReset().mockReturnValue(ownerToken)
  clearAuth.mockClear()
  sessionStorage.clear()
  oauth.callbackOrigin = ''
})

afterEach(() => vi.unstubAllGlobals())

describe('Account sign-in methods', () => {
  it('displays linked identities and uses the account-scoped email endpoints', async () => {
    fetchMock.mockResolvedValueOnce(json({ request_id: 'bind-attempt', expires_in: 300, resend_after: 60 }))
    fetchMock.mockResolvedValueOnce(json({ email: 'Reader@example.com' }))

    const wrapper = mountWithApp(AccountLoginMethods, { props: { accountKey, loginIdentities: identities } })
    await flushPromises()
    expect(wrapper.text()).toContain('GoogleLinked')
    expect(wrapper.text()).not.toContain('Link Apple')
    await wrapper.get('button').trigger('click')
    await wrapper.get('input[type=email]').setValue('Reader@example.com')
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    await wrapper.get('[autocomplete="one-time-code"]').setValue('012345')
    await wrapper.get('form').trigger('submit')
    await flushPromises()

    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://api.example.test/v1/user/login/email/send', expect.objectContaining({
      body: JSON.stringify({ email: 'Reader@example.com', locale: 'en', purpose: 'bind' }),
      headers: expect.objectContaining({ Authorization: `Bearer ${ownerToken}` })
    }))
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://api.example.test/v1/user/bind', expect.objectContaining({
      body: JSON.stringify({ email: 'Reader@example.com', request_id: 'bind-attempt', code: '012345', type: 'email' }),
      headers: expect.objectContaining({ Authorization: `Bearer ${ownerToken}` })
    }))
    expect(wrapper.text()).toContain('Reader@example.com')
    expect(wrapper.find('form').exists()).toBe(false)
    expect(clearAuth).not.toHaveBeenCalled()
  })

  it('keeps email linking available when the provider callback uses a different origin', async () => {
    oauth.callbackOrigin = 'https://auth.example.test'
    const wrapper = mountWithApp(AccountLoginMethods, { props: { accountKey, loginIdentities: { ...identities, google: false } } })
    await flushPromises()

    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Link email'])
    expect(wrapper.text()).toContain('Provider linking is unavailable from this Web address')
  })

  it('hides email binding while keeping provider linking available', async () => {
    const wrapper = mountWithApp(AccountLoginMethods, { props: { accountKey, loginIdentities: { ...identities, google: false, show_email_binding: false } } })
    await flushPromises()

    expect(wrapper.findAll('button').map(button => button.text())).toEqual(['Link Google'])
  })

  it('refuses to send a code or start a provider link when another tab switches accounts', async () => {
    const wrapper = mountWithApp(AccountLoginMethods, { props: { accountKey, loginIdentities: { ...identities, google: false } } })
    await flushPromises()

    getUserToken.mockReturnValue(otherToken)
    const [linkEmail, linkGoogle] = wrapper.findAll('button')
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
    const wrapper = mountWithApp(AccountLoginMethods, { props: { accountKey, loginIdentities: { ...identities, google: false } } })
    await flushPromises()

    const previousUrl = location.href
    await wrapper.findAll('button')[1]!.trigger('click')
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.example.test/v1/user/bind_link', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${ownerToken}` })
    }))
    getUserToken.mockReturnValue(otherToken)
    finish(json({ state: 'link.fixture', nonce: 'nonce' }, status))
    await flushPromises()
    expect(wrapper.get('.login-methods-error').text()).toMatch(/session changed or expired/)
    expect(location.href).toBe(previousUrl)
    expect(sessionStorage.length).toBe(0)
    expect(clearAuth).not.toHaveBeenCalled()
  })
})
