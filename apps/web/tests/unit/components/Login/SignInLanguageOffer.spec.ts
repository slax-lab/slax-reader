import SignInLanguageOffer from '~/components/Login/SignInLanguageOffer.vue'

import type { SignInLanguageChoice } from '~/utils/signInLanguage'

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { useState } from '#app'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const store = vi.hoisted(() => ({ confirmedAccountLocale: { accountKey: 'id:reader', locale: 'en' }, changeLocale: vi.fn() }))
vi.mock('~/stores/user', () => ({ useUserStore: () => store }))
mockNuxtImport('getUserToken', () => () => 'head.' + btoa(JSON.stringify({ id: 'reader' })) + '.signature')
enableAutoUnmount(afterEach)

describe('Web sign-in language offer', () => {
  beforeEach(() => {
    useState<SignInLanguageChoice>('sign-in-language-choice').value = { accountKey: 'id:reader', origin: 'zh' }
    store.confirmedAccountLocale.locale = 'en'
    store.changeLocale.mockReset().mockResolvedValue(undefined)
  })

  it('uses the originating language and saves only when the reader chooses it', async () => {
    const wrapper = await mountSuspended(SignInLanguageOffer)
    await vi.waitFor(() => expect(wrapper.find('aside').exists()).toBe(true))
    expect(wrapper.get('aside').attributes('lang')).toBe('zh')
    expect(wrapper.text()).toContain('继续使用中文')
    expect(store.changeLocale).not.toHaveBeenCalled()
    await wrapper.get('.actions button:first-child').trigger('click')
    await flushPromises()
    expect(store.changeLocale).toHaveBeenCalledExactlyOnceWith('zh')
    expect(wrapper.find('aside').exists()).toBe(false)
  })

  it.each(['.dismiss', '.actions button:last-child'])('consumes the offer without a write via %s', async selector => {
    const wrapper = await mountSuspended(SignInLanguageOffer)
    await vi.waitFor(() => expect(wrapper.find(selector).exists()).toBe(true))
    await wrapper.get(selector).trigger('click')
    expect(store.changeLocale).not.toHaveBeenCalled()
    expect(wrapper.find('aside').exists()).toBe(false)
  })

  it('hides the offer if the active preference already matches', async () => {
    store.confirmedAccountLocale.locale = 'zh'
    const wrapper = await mountSuspended(SignInLanguageOffer)
    await flushPromises()
    expect(wrapper.find('aside').exists()).toBe(false)
    expect(store.changeLocale).not.toHaveBeenCalled()
  })
})
