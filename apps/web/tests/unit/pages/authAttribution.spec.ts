import AuthPage from '~~/app/pages/auth.vue'

import { consumeSnapshotSaveFeedback, startSnapshotSave } from '~/utils/bookmarkFork'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { route, grantAuth, navigate, post } = vi.hoisted(() => ({
  route: { query: {} as Record<string, string> },
  grantAuth: vi.fn().mockResolvedValue('fixture-token'),
  navigate: vi.fn().mockResolvedValue(undefined),
  post: vi.fn()
}))
vi.mock('vue-router', async original => ({ ...await original<typeof import('vue-router')>(), useRoute: () => route }))
mockNuxtImport('useAuth', () => () => ({ grantAuth }))
mockNuxtImport('navigateTo', () => navigate)
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

describe('OAuth callback provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    cookies.clear()
    grantAuth.mockReset().mockResolvedValue('fixture-token')
    post.mockReset().mockResolvedValue({ bmId: 123 })
    useRuntimeConfig().public.PUBLIC_BASE_URL = 'https://reader.test'
    route.query = {}
  })

  it('passes collection provenance from its own callback state and keeps the subscription return target', async () => {
    const attribution = { collection_id: 'Collection123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' }
    route.query = { code: 'fixture-code', state: JSON.stringify({ redirectUrl: 'https://fixture.test/auth', target: '/c/Collection123?subscribe_after_login=1', affCode: 'affiliate', platform: 'google', auth_attribution: attribution }) }
    mountWithApp(AuthPage)
    await flushPromises()
    expect(grantAuth).toHaveBeenCalledExactlyOnceWith('fixture-code', 'https://fixture.test/auth', 'affiliate', 'google', attribution, expect.objectContaining({ signal: expect.any(AbortSignal), errorInterceptors: expect.any(Function) }))
    expect(navigate).toHaveBeenCalledWith('/c/Collection123?subscribe_after_login=1', { external: true })
  })

  const snapshotSource = '00000000-0000-4000-8000-000000000001'

  it.each(['google', 'apple'] as const)('resumes one explicit article save after the %s callback', async platform => {
    const attribution = { source_screen: 'detail', presentation: 'modal', trigger_element_id: 'snapshot_save_button', source_bookmark_id: snapshotSource }
    const target = new URL(startSnapshotSave(snapshotSource).redirect)
    target.pathname = `/b/${snapshotSource}`
    route.query = { code: 'fixture-code', state: JSON.stringify({ redirectUrl: 'https://fixture.test/auth', target: target.href, platform, auth_attribution: attribution }) }
    mountWithApp(AuthPage)
    await flushPromises()

    expect(grantAuth).toHaveBeenCalledExactlyOnceWith('fixture-code', 'https://fixture.test/auth', '', platform, attribution, expect.objectContaining({ signal: expect.any(AbortSignal), errorInterceptors: expect.any(Function) }))
    expect(post).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      url: '/v1/bookmark/add_url',
      body: { target_url: `https://reader.test/b/${snapshotSource}`, tags: [], snapshot_save: true },
      headers: { Authorization: 'Bearer fixture-token' }
    }))
    expect(post).toHaveBeenCalledBefore(navigate)
    expect(navigate).toHaveBeenCalledExactlyOnceWith(`${location.origin}/b/${snapshotSource}`, { external: true })
    expect(consumeSnapshotSaveFeedback(snapshotSource, 'fixture-token')).toBe(true)
  })

  it('drops snapshot provenance with a non-UUID source without failing the callback', async () => {
    route.query = { code: 'fixture-code', state: JSON.stringify({ redirectUrl: 'https://fixture.test/auth', target: '/b/source', platform: 'google', auth_attribution: { source_screen: 'detail', presentation: 'modal', trigger_element_id: 'snapshot_save_button', source_bookmark_id: 'source' } }) }
    mountWithApp(AuthPage)
    await flushPromises()
    expect(grantAuth).toHaveBeenCalledWith('fixture-code', 'https://fixture.test/auth', '', 'google', undefined, expect.objectContaining({ signal: expect.any(AbortSignal) }))
    expect(navigate).toHaveBeenCalledWith('/b/source', { external: true })
  })

  it('preserves snapshot provenance on Apple recovery', async () => {
    const attribution = { source_screen: 'detail', presentation: 'modal', trigger_element_id: 'snapshot_save_button', source_bookmark_id: snapshotSource }
    grantAuth.mockRejectedValue(new TypeError('Load failed'))
    route.query = { code: 'fixture-code', state: JSON.stringify({ redirectUrl: 'https://fixture.test/auth', target: `/b/${snapshotSource}`, platform: 'apple', auth_attribution: attribution }) }
    const wrapper = mountWithApp(AuthPage)
    await flushPromises()
    expect(wrapper.findComponent({ name: 'AppleLoginButton' }).props('authAttribution')).toEqual(attribution)
    wrapper.unmount()
  })

  it('preserves a callback without collection metadata', async () => {
    route.query = { code: 'fixture-code', state: JSON.stringify({ redirectUrl: 'https://fixture.test/auth', affCode: '' }) }
    mountWithApp(AuthPage)
    await flushPromises()
    expect(grantAuth).toHaveBeenCalledWith('fixture-code', 'https://fixture.test/auth', '', 'google', undefined, expect.objectContaining({ signal: expect.any(AbortSignal), errorInterceptors: expect.any(Function) }))
    expect(navigate).toHaveBeenCalledWith('/bookmarks', { external: true })
  })

  it('does not exchange credentials when Google returns a cancellation without a code', async () => {
    route.query = { error: 'access_denied' }
    mountWithApp(AuthPage)
    await flushPromises()
    expect(grantAuth).not.toHaveBeenCalled()
    expect(navigate).toHaveBeenCalledWith('/login')
  })
})
