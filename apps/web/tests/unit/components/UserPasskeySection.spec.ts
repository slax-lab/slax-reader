import UserPasskeySection from '~~/app/components/UserPasskeySection.vue'

import { deriveAccountKey } from '~~/app/utils/accountContext'
import { createAccountEmailAuthRequest } from '~~/app/utils/accountEmailAuthRequest'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { WebAuthnAbortService } from '@simplewebauthn/browser'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserToken, startRegistration } = vi.hoisted(() => ({ getUserToken: vi.fn(), startRegistration: vi.fn() }))
mockNuxtImport('getUserToken', () => getUserToken)
mockNuxtImport('getClientEventHeaders', () => () => ({ 'X-CLIENT-TYPE': 'web' }))
mockNuxtImport('useRuntimeConfig', () => () => ({ app: { baseURL: '/' }, public: { DWEB_API_BASE_URL: 'https://api.example.test' } }))
vi.mock('@simplewebauthn/browser', async importOriginal => ({ ...await importOriginal<typeof import('@simplewebauthn/browser')>(), startRegistration, browserSupportsWebAuthn: () => true }))
const ownerToken = `fixture.${btoa('{"id":1}')}.token`
const otherToken = `fixture.${btoa('{"id":2}')}.token`
const fetchMock = vi.fn<typeof fetch>()
const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })
const saved = { uuid: 'passkey-uuid', name: 'Laptop', created_at: '2026-11-12T00:00:00Z', last_used_at: null }
const mountSection = (loginEmail: string | undefined = 'reader@example.com') => mountWithApp(UserPasskeySection, { props: { account: createAccountEmailAuthRequest(deriveAccountKey(ownerToken)!), loginEmail } })
enableAutoUnmount(afterEach)
beforeEach(() => {
  fetchMock.mockReset()
  getUserToken.mockReset().mockReturnValue(ownerToken)
  startRegistration.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

describe('Passkey account management', () => {
  it('requires a verified login mailbox before offering credential creation', async () => {
    const wrapper = mountSection('')
    expect(wrapper.text()).toContain('Link a sign-in email first')
    expect(wrapper.find('button').exists()).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('lists authenticated metadata, registers and deletes without changing the login session', async () => {
    const options = { challenge: 'register-challenge', rp: { name: 'Slax Reader' }, user: { id: 'owner', name: 'reader@example.com', displayName: 'Reader' }, pubKeyCredParams: [{ type: 'public-key', alg: -7 }] }
    const credential = { id: 'credential', rawId: 'credential', type: 'public-key', response: { clientDataJSON: 'client-data', attestationObject: 'attestation' }, clientExtensionResults: {} }
    fetchMock.mockResolvedValueOnce(json([])).mockResolvedValueOnce(json({ purpose: 'register', request_id: 'register-attempt', options })).mockResolvedValueOnce(json({ linked: true })).mockResolvedValueOnce(json([saved])).mockResolvedValueOnce(json({ deleted: true }))
    startRegistration.mockResolvedValueOnce(credential)
    const wrapper = mountSection()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('No Passkeys yet')
    await wrapper.get('.passkey-add').trigger('click')
    await flushPromises()
    expect(startRegistration).toHaveBeenCalledWith({ optionsJSON: options })
    expect(fetchMock).toHaveBeenNthCalledWith(3, 'https://api.example.test/v1/user/setting', expect.objectContaining({ body: JSON.stringify({ key: 'bind_login_identity', value: { type: 'passkey', request_id: 'register-attempt', credential, name: 'Passkey' } }), headers: expect.objectContaining({ Authorization: `Bearer ${ownerToken}` }) }))
    expect(wrapper.text()).toContain('Laptop')
    expect(wrapper.text()).toContain('Never used')
    await wrapper.get('.passkey-delete').trigger('click')
    await flushPromises()
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.example.test/v1/user/setting', expect.objectContaining({ body: JSON.stringify({ key: 'delete_passkey', value: { uuid: 'passkey-uuid' } }) }))
    expect(wrapper.text()).not.toContain('Laptop')
    expect(wrapper.text()).toContain('No Passkeys yet')
  })

  it('does not attach a credential when the account changes during the browser ceremony', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockResolvedValueOnce(json([])).mockResolvedValueOnce(json({ purpose: 'register', request_id: 'attempt', options: { challenge: 'challenge' } }))
    startRegistration.mockImplementationOnce(() => new Promise(resolve => { finish = resolve }))
    const wrapper = mountSection()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await wrapper.get('.passkey-add').trigger('click')
    await flushPromises()
    getUserToken.mockReturnValue(otherToken)
    finish({ id: 'late-credential' })
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(wrapper.get('[role="alert"]').text()).toContain('session changed or expired')
  })

  it('discards a browser ceremony after closing credential management', async () => {
    let finish!: (value: unknown) => void
    fetchMock.mockResolvedValueOnce(json([])).mockResolvedValueOnce(json({ purpose: 'register', request_id: 'attempt', options: { challenge: 'challenge' } }))
    let browserSignal!: AbortSignal
    startRegistration.mockImplementationOnce(() => {
      browserSignal = WebAuthnAbortService.createNewAbortSignal()
      return new Promise(resolve => { finish = resolve })
    })
    const wrapper = mountSection()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await wrapper.get('.passkey-add').trigger('click')
    await flushPromises()
    await wrapper.get('.passkey-toggle').trigger('click')
    finish({ id: 'late-credential' })
    await flushPromises()
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(wrapper.find('.passkey-panel').exists()).toBe(false)
    expect(browserSignal.aborted).toBe(true)
  })
  it('keeps a saved credential visible when deletion fails', async () => {
    fetchMock.mockResolvedValueOnce(json([saved])).mockResolvedValueOnce(new Response(JSON.stringify({ message: 'unavailable' }), { status: 503 }))
    const wrapper = mountSection()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    await wrapper.get('.passkey-delete').trigger('click')
    await flushPromises()
    expect(wrapper.text()).toContain('Laptop')
    expect(wrapper.get('[role="alert"]').text()).toContain('couldn’t complete')
    expect(wrapper.get('.passkey-delete').attributes('disabled')).toBeUndefined()
  })

})
