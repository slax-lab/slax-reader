import UserPasskeySection from '~~/app/components/UserPasskeySection.vue'

import { deriveAccountKey } from '~~/app/utils/accountContext'
import { createAccountEmailAuthRequest } from '~~/app/utils/accountEmailAuthRequest'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { WebAuthnAbortService } from '@simplewebauthn/browser'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { getUserToken, startRegistration, sendSignal } = vi.hoisted(() => ({ getUserToken: vi.fn(), startRegistration: vi.fn(), sendSignal: vi.fn() }))
mockNuxtImport('getUserToken', () => getUserToken)
mockNuxtImport('getClientEventHeaders', () => () => ({ 'X-CLIENT-TYPE': 'web' }))
mockNuxtImport('useRuntimeConfig', () => () => ({ app: { baseURL: '/' }, public: { DWEB_API_BASE_URL: 'https://api.example.test' } }))
vi.mock('@simplewebauthn/browser', async importOriginal => ({ ...await importOriginal<typeof import('@simplewebauthn/browser')>(), startRegistration, sendSignal, browserSupportsWebAuthn: () => true }))
const ownerToken = `fixture.${btoa('{"id":1}')}.token`
const otherToken = `fixture.${btoa('{"id":2}')}.token`
const fetchMock = vi.fn<typeof fetch>()
const json = (data: unknown) => new Response(JSON.stringify({ data }), { status: 200 })
const credentialState = { rp_id: 'example.test', user_handle: 'b3duZXI', credential_ids: [] as string[] }
const saved = { id: 1, name: 'Laptop', created_at: '2026-11-12T00:00:00Z', last_used_at: null }
const mountSection = (loginEmail: string | undefined = 'reader@example.com') => mountWithApp(UserPasskeySection, { props: { account: createAccountEmailAuthRequest(deriveAccountKey(ownerToken)!), loginEmail } })
enableAutoUnmount(afterEach)
beforeEach(() => {
  fetchMock.mockReset()
  getUserToken.mockReset().mockReturnValue(ownerToken)
  startRegistration.mockReset()
  sendSignal.mockReset().mockResolvedValue(undefined)
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
    fetchMock.mockResolvedValueOnce(json([])).mockResolvedValueOnce(json({ purpose: 'register', request_id: 'register-attempt', options })).mockResolvedValueOnce(json({ linked: true })).mockResolvedValueOnce(json([saved])).mockResolvedValueOnce(json({ deleted: true, credential_state: credentialState }))
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
    expect(fetchMock).toHaveBeenLastCalledWith('https://api.example.test/v1/user/setting', expect.objectContaining({ body: JSON.stringify({ key: 'delete_passkey', value: { id: 1 } }) }))
    expect(wrapper.text()).not.toContain('Laptop')
    expect(wrapper.text()).toContain('No Passkeys yet')
    expect(sendSignal).toHaveBeenCalledWith({ signalName: 'allAcceptedCredentials', rpID: credentialState.rp_id, userID: credentialState.user_handle, allAcceptedCredentialIDs: [] })
  })


  it('signals the complete remaining server credential IDs rather than the deleted metadata id', async () => {
    const remaining = { ...saved, id: 2, name: 'Phone' }
    fetchMock.mockResolvedValueOnce(json([saved, remaining])).mockResolvedValueOnce(json({ deleted: true, credential_state: { ...credentialState, credential_ids: ['remaining-credential'] } }))
    const wrapper = mountSection()
    await wrapper.get('.passkey-toggle').trigger('click')
    await flushPromises()
    await wrapper.findAll('.passkey-delete')[0]!.trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Laptop')
    expect(wrapper.text()).toContain('Phone')
    expect(sendSignal).toHaveBeenCalledWith({ signalName: 'allAcceptedCredentials', rpID: credentialState.rp_id, userID: credentialState.user_handle, allAcceptedCredentialIDs: ['remaining-credential'] })
  })

  it.each(['async rejection', 'synchronous failure', 'missing credential state'])('keeps deletion successful after credential synchronization %s', async failure => {
    fetchMock.mockResolvedValueOnce(json([saved])).mockResolvedValueOnce(json({ deleted: true, ...(failure === 'missing credential state' ? {} : { credential_state: credentialState }) }))
    if (failure === 'async rejection') sendSignal.mockRejectedValueOnce(new Error('Signal unavailable'))
    if (failure === 'synchronous failure') sendSignal.mockImplementationOnce(() => { throw new Error('Signal unavailable') })
    const wrapper = mountSection()
    await wrapper.get('.passkey-toggle').trigger('click')
    await flushPromises()
    await wrapper.get('.passkey-delete').trigger('click')
    await flushPromises()
    expect(wrapper.text()).not.toContain('Laptop')
    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Passkey deleted')
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
    expect(sendSignal).not.toHaveBeenCalled()
  })

})
