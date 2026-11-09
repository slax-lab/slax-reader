import AuthPage from '~~/app/pages/auth.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount, flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { createHash } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { route, grantAuth, navigate } = vi.hoisted(() => ({
  route: { query: {} as Record<string, string> },
  grantAuth: vi.fn(),
  navigate: vi.fn().mockResolvedValue(undefined)
}))
vi.mock('vue-router', async original => ({ ...await original<typeof import('vue-router')>(), useRoute: () => route }))
mockNuxtImport('useAuth', () => () => ({ grantAuth }))
mockNuxtImport('navigateTo', () => navigate)
vi.mock('@vueuse/integrations/useCookies', () => ({
  useCookies: () => ({
    get: (name: string) => document.cookie.split('; ').find(cookie => cookie.startsWith(name + '='))?.slice(name.length + 1),
    remove: (name: string) => { document.cookie = name + '=; Max-Age=0; Path=/' }
  })
}))

enableAutoUnmount(afterEach)

const nonce = '1023456789abcdef1023456789abcdef'
function bindState() {
  document.cookie = `reader-oauth-${nonce}=${createHash('sha256').update(route.query.state!).digest('hex')}; Path=/`
}

describe('OAuth callback provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    route.query = {}
    vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (_, data) => Uint8Array.from(createHash('sha256').update(data as Uint8Array).digest()).buffer)
  })
  afterEach(() => vi.restoreAllMocks())

  it('passes collection provenance from its own callback state and keeps the subscription return target', async () => {
    const attribution = { collection_id: 'Collection123', source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' }
    route.query = { code: 'fixture-code', state: JSON.stringify({ nonce, redirectUrl: 'https://fixture.test/auth', target: '/c/Collection123?subscribe_after_login=1', affCode: 'affiliate', platform: 'google', auth_attribution: attribution }) }
    bindState()
    grantAuth.mockResolvedValueOnce('/c/Collection123?subscribe_after_login=1')
    mountWithApp(AuthPage)
    await flushPromises()
    expect(grantAuth).toHaveBeenCalledWith('fixture-code', route.query.state, expect.any(AbortSignal))
    expect(navigate).toHaveBeenCalledWith('/c/Collection123?subscribe_after_login=1', { external: true })
  })

  it('preserves a callback without collection metadata', async () => {
    route.query = { code: 'fixture-code', state: JSON.stringify({ nonce, redirectUrl: 'https://fixture.test/auth', affCode: '' }) }
    bindState()
    grantAuth.mockResolvedValueOnce('/bookmarks')
    mountWithApp(AuthPage)
    await flushPromises()
    expect(grantAuth).toHaveBeenCalledWith('fixture-code', route.query.state, expect.any(AbortSignal))
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
