import AuthPage from '~~/app/pages/auth.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const env = vi.hoisted(() => ({
  route: { query: {} as Record<string, string> },
  requestAuth: vi.fn(),
  requestAppleAuth: vi.fn(),
  navigateTo: vi.fn()
}))

mockNuxtImport('useRoute', () => () => env.route)
mockNuxtImport('useAuth', () => () => env)
mockNuxtImport('navigateTo', () => env.navigateTo)
mockNuxtImport('analyticsLog', () => vi.fn())
mockNuxtImport('eventLog', () => vi.fn())
vi.mock('vue-router', async importOriginal => ({
  ...await importOriginal<typeof import('vue-router')>(),
  useRoute: () => env.route
}))

enableAutoUnmount(afterEach)

const setRecovery = (context: unknown, result = 'failed') => {
  env.route.query = { result }
  history.replaceState(null, '', '/auth#recovery=' + encodeURIComponent(JSON.stringify(context)))
}

beforeEach(() => {
  vi.clearAllMocks()
  env.navigateTo.mockResolvedValue(undefined)
  setRecovery({ target: '/bookmarks?filter=unread&view=all#section%20title', affCode: 'referral', platform: 'google' })
})

describe('OAuth callback recovery', () => {
  it.each([['failed', /sign.in.*not.*complete/i], ['timeout', /timed out/i]])('renders persistent recovery for %s', async (result, message) => {
    env.route.query.result = result
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').text()).toMatch(message)
    expect(wrapper.find('[role="status"]').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(true)
    expect(env.navigateTo).not.toHaveBeenCalled()
  })

  it('starts fresh Google authorization with the preserved return and referral context', async () => {
    const wrapper = mountWithApp(AuthPage)
    await wrapper.find('button').trigger('click')
    expect(env.requestAuth).toHaveBeenCalledWith({ redirect: '/bookmarks?filter=unread&view=all#section%20title', affCode: 'referral' })
  })

  const collection = { collection_id: 'Collection123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' }
  const hackerLinks = { source: 'hackerlinks', medium: 'resource_detail', campaign: 'mvp' }
  it.each([
    ['google', collection, collection],
    ['google', hackerLinks, hackerLinks],
    ['apple', hackerLinks, hackerLinks],
    ['apple', collection, undefined],
    ['google', { collection_id: [] }, undefined]
  ])('uses the correct provider and allowed retry attribution for %s / %j', async (platform, attribution, expected) => {
    const target = '/c/Collection123?subscribe_after_login=1'
    setRecovery({ target, platform, auth_attribution: attribution })
    const wrapper = mountWithApp(AuthPage)
    await wrapper.find('button').trigger('click')
    const request = platform === 'google' ? env.requestAuth : env.requestAppleAuth
    expect(request).toHaveBeenCalledExactlyOnceWith({ redirect: target, affCode: '', ...(expected ? { authAttribution: expected } : {}) })
  })

  it.each(['', '#recovery=%7B', '#recovery=null'])('uses the default Google action for invalid recovery context: %s', async hash => {
    history.replaceState(null, '', '/auth' + hash)
    const wrapper = mountWithApp(AuthPage)
    await wrapper.find('button').trigger('click')
    expect(env.requestAuth).toHaveBeenCalledWith({ redirect: '/bookmarks', affCode: '' })
  })

  it('preserves missing-code routing', () => {
    env.route.query = { error: 'access_denied' }
    mountWithApp(AuthPage)
    expect(env.navigateTo).toHaveBeenCalledWith('/login')
  })

  it('preserves the Android handoff without a Web login', () => {
    env.route.query = { platform: 'android', code: 'synthetic-single-use-code' }
    mountWithApp(AuthPage)
    expect(env.navigateTo).toHaveBeenCalledWith('slaxrd://auth?code=synthetic-single-use-code', { external: true })
  })

  it('shows recovery when the Android handoff rejects', async () => {
    env.route.query = { platform: 'android', code: 'synthetic-single-use-code' }
    env.navigateTo.mockRejectedValueOnce(new Error('Handoff failed'))
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()
    expect(wrapper.find('[role="alert"]').exists()).toBe(true)
  })
})
