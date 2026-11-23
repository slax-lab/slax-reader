import EmailLoginPage from '~~/app/pages/email-login.vue'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const env = vi.hoisted(() => ({ verify: vi.fn(), navigate: vi.fn(), signedIn: false }))
mockNuxtImport('useAuth', () => () => ({ verifyEmailLinkAuth: env.verify }))
mockNuxtImport('navigateTo', () => env.navigate)
mockNuxtImport('useRuntimeConfig', () => () => ({ app: { baseURL: '/', buildAssetsDir: '/_nuxt/', cdnURL: '' }, public: { COOKIE_TOKEN_NAME: 'email-link-test' } }))
vi.mock('~/utils/authCookie', async importOriginal => ({ ...await importOriginal<typeof import('~/utils/authCookie')>(), configuredCookieName: (name: string) => name, readStringCookie: () => env.signedIn ? 'current-token' : undefined }))
enableAutoUnmount(afterEach)
beforeEach(() => {
  vi.useFakeTimers()
  env.signedIn = false
  env.verify.mockReset().mockResolvedValue('token')
  env.navigate.mockReset().mockResolvedValue(undefined)
  window.__slaxEmailLoginFragment = '#' + new URLSearchParams({ email: 'reader@example.com', request_id: '550e8400-e29b-41d4-a716-446655440000', token: 'a'.repeat(43) })
})
afterEach(() => {vi.useRealTimers(); delete window.__slaxEmailLoginFragment})
describe('email sign-in link page', () => {
  it('uses existing session completion and bookmarks destination', async () => {
    mountWithApp(EmailLoginPage)
    await flushPromises()
    expect(env.verify).toHaveBeenCalledOnce()
    expect(env.verify.mock.calls[0][0]).toMatchObject({ email: 'reader@example.com', token: 'a'.repeat(43) })
    expect(env.navigate).toHaveBeenCalledWith('/bookmarks')
    expect(window.__slaxEmailLoginFragment).toBeUndefined()
  })
  it('preserves an existing account without submitting proof', async () => {
    env.signedIn = true
    const wrapper = mountWithApp(EmailLoginPage)
    await flushPromises()
    expect(wrapper.text()).toMatch(/sign out/i)
    expect(env.verify).not.toHaveBeenCalled()
    expect(env.navigate).not.toHaveBeenCalled()
  })
  it('rejects a missing proof and offers a fresh login', async () => {
    delete window.__slaxEmailLoginFragment
    const wrapper = mountWithApp(EmailLoginPage)
    await flushPromises()
    expect(env.verify).not.toHaveBeenCalled()
    expect(wrapper.get('a').attributes('href')).toBe('/login')
  })
  it('shows persistent recovery after a network failure without replay', async () => {
    env.verify.mockRejectedValue(new Error('synthetic-secret'))
    const wrapper = mountWithApp(EmailLoginPage)
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).not.toContain('synthetic-secret')
    expect(wrapper.get('a').attributes('href')).toBe('/login')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(env.verify).toHaveBeenCalledOnce()
  })
  it('cancels on disposal and prevents late success navigation', async () => {
    let complete!: () => void
    env.verify.mockImplementation(() => new Promise<void>(resolve => {complete = resolve}))
    const wrapper = mountWithApp(EmailLoginPage)
    await flushPromises()
    const signal = env.verify.mock.calls[0][1].signal
    wrapper.unmount()
    complete(); await flushPromises()
    expect(signal.aborted).toBe(true)
    expect(env.navigate).not.toHaveBeenCalled()
  })
  it('bounds waiting without an automatic proof retry', async () => {
    env.verify.mockImplementation(() => new Promise(() => {}))
    const wrapper = mountWithApp(EmailLoginPage)
    await vi.advanceTimersByTimeAsync(20_000)
    expect(wrapper.get('[role="alert"]').exists()).toBe(true)
    expect(env.verify.mock.calls[0][1].signal.aborted).toBe(true)
  })
})
