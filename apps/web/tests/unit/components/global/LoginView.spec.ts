import { nextTick } from 'vue'

import LoginView from '~~/app/components/global/LoginView.vue'

import { mountWithApp } from '../../../setup/mount'
import { RequestError } from '@commons/frontend-utils/request'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { WebAuthnAbortService } from '@simplewebauthn/browser'
import { ErrorName } from '@slax-reader/contracts/errors'
import { flushPromises } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { get, post, verifyEmailAuth, verifyPasskeyAuth, startAuthentication, browserSupportsPasskeys, browserSupportsWebAuthnAutofill, getBrowserCapabilities, sendSignal, navigate, analytics } = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  verifyEmailAuth: vi.fn(),
  verifyPasskeyAuth: vi.fn(),
  startAuthentication: vi.fn(),
  browserSupportsPasskeys: vi.fn(),
  browserSupportsWebAuthnAutofill: vi.fn(),
  getBrowserCapabilities: vi.fn(),
  sendSignal: vi.fn(),
  navigate: vi.fn(),
  analytics: vi.fn()
}))
mockNuxtImport('request', () => () => ({ get, post }))
mockNuxtImport('useAuth', () => () => ({ verifyEmailAuth, verifyPasskeyAuth }))
vi.mock('@simplewebauthn/browser', async importOriginal => ({ ...await importOriginal<typeof import('@simplewebauthn/browser')>(), startAuthentication, browserSupportsPasskeys, browserSupportsWebAuthnAutofill, getBrowserCapabilities, sendSignal }))
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
  afterEach(() => vi.unstubAllGlobals())
  beforeEach(() => {
    vi.clearAllMocks()
    browserSupportsPasskeys.mockReset().mockResolvedValue(true)
    browserSupportsWebAuthnAutofill.mockReset().mockResolvedValue(false)
    getBrowserCapabilities.mockReset().mockResolvedValue({ conditionalGet: 'unsupported' })
    sendSignal.mockReset().mockResolvedValue(undefined)
    startAuthentication.mockReset()
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

  it.each(['development', 'preview', 'beta', 'production'])('sends and verifies email with referral and acquisition context in %s', async environment => {
    runtimeConfig.public.slaxEnv = environment
    get.mockResolvedValue({ enabled: true })
    runtimeConfig.public.TURNSTILE_SITE_KEY = ''
    const authAttribution = { source: 'hackerlinks', medium: 'header', campaign: 'mvp' } as const
    const redirect = `${location.origin}/bookmarks?filter=unread#saved`
    const wrapper = mountWithApp(LoginView, { props: { authAttribution, affcode: 'invite', redirect } })
    await flushPromises()
    await wrapper.get('.email-login-toggle').trigger('click')
    expect(analytics).toHaveBeenCalledWith({ event: 'user_login_start', method: 'email' })
    expect(wrapper.find('.email-passkey-button').exists()).toBe(['development', 'preview', 'beta'].includes(environment))
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

  it('authenticates the entered mailbox with Passkey and keeps its continuation context', async () => {
    const authAttribution = { source: 'hackerlinks', medium: 'header', campaign: 'mvp' } as const
    const options = { challenge: 'challenge', rpId: location.hostname, userVerification: 'required' }
    const credential = { id: 'credential', rawId: 'credential', type: 'public-key', response: { clientDataJSON: 'client-data', authenticatorData: 'authenticator-data', signature: 'signature' }, clientExtensionResults: {} }
    post.mockResolvedValueOnce({ purpose: 'login', request_id: 'passkey-attempt', options })
    startAuthentication.mockResolvedValueOnce(credential)
    verifyPasskeyAuth.mockResolvedValueOnce('session')
    runtimeConfig.public.TURNSTILE_SITE_KEY = ''
    const wrapper = mountWithApp(LoginView, { props: { affcode: 'invite', authAttribution, redirect: '/bookmarks?filter=unread' } })
    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await wrapper.get('.email-passkey-button').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ url: '/v1/user/passkey/challenge', body: { purpose: 'login', email: 'reader@example.com' } }))
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: options })
    expect(verifyPasskeyAuth).toHaveBeenCalledWith({ type: 'passkey', email: 'reader@example.com', request_id: 'passkey-attempt', credential, auth_attribution: authAttribution }, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(navigate).toHaveBeenCalledWith(`${location.origin}/bookmarks?filter=unread`, { external: true })
    expect(localStorage.getItem('slax:last-login-email')).toBe('reader@example.com')
    expect(wrapper.get('.email-login-toggle').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[type=email]').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.email-code-button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.email-passkey-button').attributes('disabled')).toBeDefined()
    await wrapper.get('form').trigger('submit')
    await wrapper.get('.email-passkey-button').trigger('click')
    await flushPromises()
    expect(post).toHaveBeenCalledOnce()
    expect(verifyPasskeyAuth).toHaveBeenCalledOnce()
    wrapper.unmount()
  })

  it('discards a Passkey assertion after closing email sign-in', async () => {
    let finish!: (credential: unknown) => void
    post.mockResolvedValueOnce({ purpose: 'login', request_id: 'passkey-attempt', options: { challenge: 'challenge' } })
    let browserSignal!: AbortSignal
    startAuthentication.mockImplementationOnce(() => {
      browserSignal = WebAuthnAbortService.createNewAbortSignal()
      return new Promise(resolve => { finish = resolve })
    })
    const wrapper = mountWithApp(LoginView)
    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await wrapper.get('.email-passkey-button').trigger('click')
    await flushPromises()
    await wrapper.get('.email-login-toggle').trigger('click')
    finish({ id: 'late-credential' })
    await flushPromises()
    expect(browserSignal.aborted).toBe(true)
    expect(verifyPasskeyAuth).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(localStorage.getItem('slax:last-login-email')).toBeNull()
    wrapper.unmount()
  })

  it('keeps email-code login usable when the browser cancels Passkey authentication', async () => {
    post.mockResolvedValueOnce({ purpose: 'login', request_id: 'attempt', options: { challenge: 'challenge' } })
    startAuthentication.mockRejectedValueOnce(Object.assign(new Error('canceled'), { code: 'ERROR_PASSTHROUGH_SEE_CAUSE_PROPERTY', cause: new DOMException('canceled', 'NotAllowedError') }))
    const wrapper = mountWithApp(LoginView)
    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await wrapper.get('.email-passkey-button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Passkey request canceled')
    expect((wrapper.get('input[type=email]').element as HTMLInputElement).value).toBe('reader@example.com')
    expect(wrapper.get('button[type=submit]').attributes('disabled')).toBeUndefined()
    await wrapper.get('form').trigger('submit')
    await flushPromises()
    expect(wrapper.find('[autocomplete="one-time-code"]').exists()).toBe(true)
    wrapper.unmount()
  })

  it('restores email sign-in when the server rejects a Passkey proof', async () => {
    localStorage.setItem('slax:last-login-email', 'previous@example.com')
    post.mockResolvedValueOnce({ purpose: 'login', request_id: 'attempt', options: { challenge: 'challenge' } })
    startAuthentication.mockResolvedValueOnce({ id: 'other-mailbox-credential' })
    verifyPasskeyAuth.mockRejectedValueOnce(new Error('Invalid Passkey proof'))
    const wrapper = mountWithApp(LoginView)
    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await wrapper.get('.email-passkey-button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toBeTruthy()
    for (const selector of ['.email-login-toggle', 'input[type=email]', '.email-code-button', '.email-passkey-button']) {
      expect(wrapper.get(selector).attributes('disabled')).toBeUndefined()
    }
    expect(localStorage.getItem('slax:last-login-email')).toBe('previous@example.com')
    expect(navigate).not.toHaveBeenCalled()
    expect(sendSignal).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps email available when passkey login capability is absent', async () => {
    vi.stubGlobal('PublicKeyCredential', undefined)
    browserSupportsPasskeys.mockResolvedValueOnce(false)
    const wrapper = mountWithApp(LoginView)
    await flushPromises()
    await wrapper.get('.email-login-toggle').trigger('click')
    expect(wrapper.find('.email-passkey-button').exists()).toBe(false)
    expect(wrapper.get('input[type=email]').attributes('autocomplete')).toBe('email')
    expect(wrapper.get('.email-code-button').attributes('disabled')).toBeUndefined()
    expect(getBrowserCapabilities).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('keeps manual Passkey login available in older WebAuthn browsers without the capabilities API', async () => {
    vi.stubGlobal('PublicKeyCredential', class {
      static isUserVerifyingPlatformAuthenticatorAvailable = async () => true
      static isConditionalMediationAvailable = async () => true
    })
    const browser = await vi.importActual<typeof import('@simplewebauthn/browser')>('@simplewebauthn/browser')
    expect(await browser.browserSupportsPasskeys()).toBe(false)
    browserSupportsPasskeys.mockImplementationOnce(browser.browserSupportsPasskeys)
    getBrowserCapabilities.mockResolvedValueOnce({ conditionalGet: 'unknown' })
    post.mockResolvedValueOnce({ purpose: 'login', request_id: 'attempt', options: { challenge: 'challenge' } })
    startAuthentication.mockResolvedValueOnce({ id: 'legacy-browser-credential' })
    verifyPasskeyAuth.mockResolvedValueOnce('session')
    const wrapper = mountWithApp(LoginView)
    await flushPromises()
    await wrapper.get('.email-login-toggle').trigger('click')
    expect(wrapper.get('input[type=email]').attributes('autocomplete')).toBe('email')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await wrapper.get('.email-passkey-button').trigger('click')
    await flushPromises()
    expect(verifyPasskeyAuth).toHaveBeenCalledWith(expect.objectContaining({ type: 'passkey', email: 'reader@example.com', credential: { id: 'legacy-browser-credential' } }), expect.anything())
    expect(navigate).toHaveBeenCalledOnce()
    expect(browserSupportsWebAuthnAutofill).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not fall back when a modern browser explicitly reports Passkeys unsupported', async () => {
    vi.stubGlobal('PublicKeyCredential', class {
      static getClientCapabilities = async () => ({ passkeyPlatformAuthenticator: false, userVerifyingPlatformAuthenticator: false, hybridTransport: false })
    })
    const browser = await vi.importActual<typeof import('@simplewebauthn/browser')>('@simplewebauthn/browser')
    expect(browser.browserSupportsWebAuthn()).toBe(true)
    browserSupportsPasskeys.mockImplementationOnce(browser.browserSupportsPasskeys)
    const wrapper = mountWithApp(LoginView)
    await flushPromises()
    await wrapper.get('.email-login-toggle').trigger('click')
    expect(wrapper.find('.email-passkey-button').exists()).toBe(false)
    expect(wrapper.get('.email-code-button').attributes('disabled')).toBeUndefined()
    expect(getBrowserCapabilities).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('signals only an explicit server unknown-credential rejection and preserves the login error', async () => {
    post.mockResolvedValueOnce({ purpose: 'login', request_id: 'attempt', options: { challenge: 'challenge', rpId: 'example.test' } })
    startAuthentication.mockResolvedValueOnce({ id: 'removed-credential' })
    verifyPasskeyAuth.mockRejectedValueOnce(new RequestError({ name: ErrorName.PASSKEY_CREDENTIAL_UNKNOWN, message: 'Missing', code: 400 }))
    sendSignal.mockRejectedValueOnce(new Error('Signal unavailable'))
    const wrapper = mountWithApp(LoginView)
    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await wrapper.get('.email-passkey-button').trigger('click')
    await flushPromises()
    expect(sendSignal).toHaveBeenCalledWith({ signalName: 'unknownCredential', rpID: 'example.test', credentialID: 'removed-credential' })
    expect(wrapper.get('[role="alert"]').text()).toBeTruthy()
    expect(wrapper.get('.email-passkey-button').attributes('disabled')).toBeUndefined()
    expect(navigate).not.toHaveBeenCalled()
    wrapper.unmount()
  })

  it('does not signal a valid credential as unknown when the mailbox proof is rejected', async () => {
    post.mockResolvedValueOnce({ purpose: 'login', request_id: 'attempt', options: { challenge: 'challenge', rpId: 'example.test' } })
    startAuthentication.mockResolvedValueOnce({ id: 'other-account-credential' })
    verifyPasskeyAuth.mockRejectedValueOnce(new RequestError({ name: ErrorName.PASSKEY_VERIFICATION_FAILED, message: 'Invalid proof', code: 400 }))
    const wrapper = mountWithApp(LoginView)
    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('wrong@example.com')
    await wrapper.get('.email-passkey-button').trigger('click')
    await flushPromises()
    expect(sendSignal).not.toHaveBeenCalled()
    expect(wrapper.get('[role="alert"]').text()).toBeTruthy()
    wrapper.unmount()
  })

  it('waits for a committed email before conditional authentication and cancels when email changes', async () => {
    getBrowserCapabilities.mockResolvedValueOnce({ conditionalGet: 'supported' })
    browserSupportsWebAuthnAutofill.mockResolvedValueOnce(true)
    let finish!: (value: unknown) => void
    let browserSignal!: AbortSignal
    post.mockResolvedValueOnce({ purpose: 'login', request_id: 'attempt', options: { challenge: 'challenge' } })
    startAuthentication.mockImplementationOnce(() => {
      browserSignal = WebAuthnAbortService.createNewAbortSignal()
      return new Promise(resolve => { finish = resolve })
    })
    const wrapper = mountWithApp(LoginView)
    await flushPromises()
    await wrapper.get('.email-login-toggle').trigger('click')
    expect(post).not.toHaveBeenCalled()
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await flushPromises()
    expect(wrapper.get('input[type=email]').attributes('autocomplete')).toBe('username webauthn')
    expect(startAuthentication).toHaveBeenCalledWith({ optionsJSON: { challenge: 'challenge' }, useBrowserAutofill: true })
    expect(wrapper.get('input[type=email]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('.email-code-button').attributes('disabled')).toBeUndefined()
    await wrapper.get('input[type=email]').setValue('')
    finish({ id: 'late-credential' })
    await flushPromises()
    expect(browserSignal.aborted).toBe(true)
    expect(verifyPasskeyAuth).not.toHaveBeenCalled()
    expect(navigate).not.toHaveBeenCalled()
    expect(localStorage.getItem('slax:last-login-email')).toBeNull()
    wrapper.unmount()
  })

  it('cancels conditional authentication before sending an email code', async () => {
    getBrowserCapabilities.mockResolvedValueOnce({ conditionalGet: 'supported' })
    browserSupportsWebAuthnAutofill.mockResolvedValueOnce(true)
    let finish!: (value: unknown) => void
    let browserSignal!: AbortSignal
    post.mockResolvedValueOnce({ purpose: 'login', request_id: 'attempt', options: { challenge: 'challenge' } })
      .mockResolvedValueOnce({ request_id: 'email-attempt', expires_in: 300, resend_after: 60 })
    startAuthentication.mockImplementationOnce(() => {
      browserSignal = WebAuthnAbortService.createNewAbortSignal()
      return new Promise(resolve => { finish = resolve })
    })
    const wrapper = mountWithApp(LoginView)
    await flushPromises()
    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await flushPromises()
    await wrapper.get('form').trigger('submit')
    finish({ id: 'late-credential' })
    await flushPromises()
    expect(browserSignal.aborted).toBe(true)
    expect(wrapper.find('[autocomplete="one-time-code"]').exists()).toBe(true)
    expect(verifyPasskeyAuth).not.toHaveBeenCalled()
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ url: '/v1/user/email/send' }))
    wrapper.unmount()
  })

  it('uses the normal session completion and pending lock after an autofill credential is selected', async () => {
    getBrowserCapabilities.mockResolvedValueOnce({ conditionalGet: 'supported' })
    browserSupportsWebAuthnAutofill.mockResolvedValueOnce(true)
    let select!: (value: unknown) => void
    let verified!: (value: string) => void
    post.mockResolvedValueOnce({ purpose: 'login', request_id: 'attempt', options: { challenge: 'challenge' } })
    startAuthentication.mockImplementationOnce(() => new Promise(resolve => { select = resolve }))
    verifyPasskeyAuth.mockImplementationOnce(() => new Promise(resolve => { verified = resolve }))
    const wrapper = mountWithApp(LoginView)
    await flushPromises()
    await wrapper.get('.email-login-toggle').trigger('click')
    await wrapper.get('input[type=email]').setValue('reader@example.com')
    await flushPromises()
    expect(wrapper.get('.email-code-button').attributes('disabled')).toBeUndefined()
    select({ id: 'selected-credential' })
    await flushPromises()
    expect(wrapper.get('.email-code-button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('input[type=email]').attributes('disabled')).toBeDefined()
    verified('session')
    await flushPromises()
    expect(navigate).toHaveBeenCalledOnce()
    expect(localStorage.getItem('slax:last-login-email')).toBe('reader@example.com')
    expect(wrapper.get('.email-login-toggle').attributes('disabled')).toBeDefined()
    expect(wrapper.get('.email-passkey-button').attributes('disabled')).toBeDefined()
    wrapper.unmount()
  })

  it('keeps manual Passkey login when conditional UI is unsupported or unknown', async () => {
    getBrowserCapabilities.mockResolvedValueOnce({ conditionalGet: 'unknown' })
    const wrapper = mountWithApp(LoginView)
    await flushPromises()
    await wrapper.get('.email-login-toggle').trigger('click')
    expect(wrapper.find('.email-passkey-button').exists()).toBe(true)
    expect(wrapper.get('input[type=email]').attributes('autocomplete')).toBe('email')
    expect(browserSupportsWebAuthnAutofill).not.toHaveBeenCalled()
    wrapper.unmount()
  })

})
