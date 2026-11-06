import AuthPage from '~~/app/pages/auth.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { route, grantAuth, navigate } = vi.hoisted(() => ({
  route: { query: {} as Record<string, string> },
  grantAuth: vi.fn().mockResolvedValue('fixture-token'),
  navigate: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('vue-router', async original => ({ ...await original<typeof import('vue-router')>(), useRoute: () => route }))
mockNuxtImport('useAuth', () => () => ({ grantAuth }))
mockNuxtImport('navigateTo', () => navigate)
enableAutoUnmount(afterEach)

describe('OAuth callback provenance', () => {
  beforeEach(() => { vi.clearAllMocks(); route.query = {} })

  it('passes collection provenance from its own callback state and keeps the subscription return target', async () => {
    const attribution = { collection_id: 'Collection123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' }
    route.query = { code: 'fixture-code', state: JSON.stringify({ redirectUrl: 'https://fixture.test/auth', target: '/c/Collection123?subscribe_after_login=1', affCode: 'affiliate', platform: 'google', auth_attribution: attribution }) }
    mountWithApp(AuthPage)
    await flushPromises()
    expect(grantAuth).toHaveBeenCalledExactlyOnceWith('fixture-code', 'https://fixture.test/auth', 'affiliate', 'google', attribution, expect.objectContaining({ signal: expect.any(AbortSignal), errorInterceptors: expect.any(Function) }))
    expect(navigate).toHaveBeenCalledWith('/c/Collection123?subscribe_after_login=1', { external: true })
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
