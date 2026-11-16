import { createApp } from 'vue'

import DefaultLayout from '~~/app/layouts/default.vue'

import powerSyncPlugin from '~~/app/plugins/powersync.client'

import { mockNuxtImport, mountSuspended } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount } from '@vue/test-utils'
import { useNuxtApp, useRuntimeConfig } from '#app'
import { POWER_SYNC_DATABASE_GENERATION, POWER_SYNC_LOCAL_DATA_VERSION } from '~~/app/local-first/version'
import { useUserStore } from '~~/app/stores/user'
import { createPinia, disposePinia, type Pinia, setActivePinia } from 'pinia'
import persistedState from 'pinia-plugin-persistedstate'
import Cookies, { type CookieSetOptions } from 'universal-cookie'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const boundary = vi.hoisted(() => ({
  cookies: null as unknown as Cookies,
  connect: vi.fn(),
  navigate: vi.fn()
}))

// Preserve real cookie storage and cleanup, without VueUse's polling listener.
vi.mock('@vueuse/integrations/useCookies', () => ({
  useCookies: () => ({
    get: (name: string) => boundary.cookies.get(name, { doNotParse: true }),
    set: (name: string, value: string, options?: CookieSetOptions) => boundary.cookies.set(name, value, options),
    remove: (name: string, options?: CookieSetOptions) => boundary.cookies.remove(name, options)
  })
}))
mockNuxtImport('navigateTo', () => boundary.navigate)
mockNuxtImport('addChannelMessageHandler', () => () => {})
mockNuxtImport('removeChannelMessageHandler', () => () => {})
vi.mock('~/local-first/schema', () => ({ AppSchema: {} }))
vi.mock('@powersync/vue', () => ({ createPowerSyncPlugin: () => ({ install() {} }) }))
vi.mock('@powersync/web', () => ({
  SyncStreamConnectionMethod: { HTTP: 'http' },
  PowerSyncDatabase: class {
    init = async () => {}
    connect = boundary.connect
    disconnectAndClear = async () => {}
    close = async () => {}
    connected = false
    connecting = false
  }
}))
vi.mock('~/local-first/powersync-recovery', () => ({
  initializePowerSyncWithFallback: async ({ createDatabase }: { createDatabase: (mode: string) => unknown }) => ({ database: createDatabase('main'), mode: 'main' })
}))
vi.mock('~/components/Promotion/KocPromotionHost.vue', () => ({ default: { render: () => null } }))
vi.mock('~/components/Tips/InAppBrowserTip.vue', () => ({ default: { render: () => null } }))

let pinia: Pinia
let cookieName: string
const token = (exp: number) => `header.${btoa(JSON.stringify({ id: 'cold-start-user', exp }))}.signature`
const mountLayout = () => mountSuspended(DefaultLayout, {
  global: {
    plugins: [pinia],
    stubs: { NuxtPage: true, NuxtPwaAssets: true, ClientOnly: true }
  }
})

enableAutoUnmount(afterEach)
beforeEach(async () => {
  vi.clearAllMocks()
  boundary.connect.mockResolvedValue(undefined)
  boundary.cookies = new Cookies()
  const app = useNuxtApp()
  cookieName = String(useRuntimeConfig().public.COOKIE_TOKEN_NAME)
  boundary.cookies.remove(cookieName, { path: '/' })
  localStorage.clear()
  localStorage.setItem(`slax:powersync:${POWER_SYNC_DATABASE_GENERATION}:dataVersion`, String(POWER_SYNC_LOCAL_DATA_VERSION))
  window.history.replaceState(null, '', '/bookmarks')
  pinia = createPinia()
  createApp({}).use(pinia)
  pinia.use(persistedState)
  setActivePinia(pinia)
  await app.$i18n.setLocale('en')
})
afterEach(() => {
  boundary.cookies.remove(cookieName, { path: '/' })
  disposePinia(pinia)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('expired-session cleanup before the first layout render', () => {
  it.each(['expired', 'rejected'] as const)('recovers when the login token is %s on the first visit', async status => {
    const app = useNuxtApp()
    boundary.cookies.set(cookieName, token(status === 'expired' ? 1 : 9999999999), { path: '/' })
    const fetch = vi.fn().mockResolvedValue(new Response('', { status: 401 }))
    vi.stubGlobal('fetch', fetch)
    expect(pinia.state.value.user).toBeUndefined()

    await powerSyncPlugin(app)
    await vi.waitFor(() => expect(boundary.connect).toHaveBeenCalled())
    const connector = boundary.connect.mock.calls[0]![0]
    // The SDK requests credentials asynchronously, outside component setup.
    await expect(connector.fetchCredentials()).resolves.toBeNull()

    expect(boundary.cookies.get(cookieName)).toBeUndefined()
    expect(boundary.navigate).toHaveBeenCalledWith('/login')
    expect(fetch).toHaveBeenCalledTimes(status === 'expired' ? 0 : 1)
    const store = useUserStore(pinia)
    expect(store.userInfo).toBeNull()
    expect(store.changeLocalLocale).toBeTypeOf('function')
    const layout = await mountLayout()
    expect(layout.find('.default-layout').exists()).toBe(true)
    expect(useUserStore(pinia)).toBe(store)
    await store.changeLocalLocale('zh', true)
    expect(app.$i18n.locale.value).toBe('zh')
  })

  it.each(['en', 'zh'] as const)('uses the active %s locale when first created outside component setup', async locale => {
    await useNuxtApp().$i18n.setLocale(locale)
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const store = useUserStore(pinia)
    expect(store.currentLocale).toBe(locale)
    await mountLayout()
    expect(useNuxtApp().$i18n.locale.value).toBe(locale)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('restores a persisted locale without saving an account preference', async () => {
    localStorage.setItem('user', JSON.stringify({ locale: 'zh' }))
    const fetch = vi.fn()
    vi.stubGlobal('fetch', fetch)
    const store = useUserStore(pinia)
    expect(store.currentLocale).toBe('zh')
    await mountLayout()
    await vi.waitFor(() => expect(useNuxtApp().$i18n.locale.value).toBe('zh'))
    expect(fetch).not.toHaveBeenCalled()
  })
})
