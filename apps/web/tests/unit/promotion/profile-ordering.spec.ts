// @vitest-environment happy-dom
import { defineComponent, h, KeepAlive, nextTick, ref, watch } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import KocPromotionHost from '~~/app/components/Promotion/KocPromotionHost.vue'
import OnboardingPage from '~~/app/pages/onboarding.vue'

import { initialPromotionState } from '~~/app/utils/promotionFlow'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount,flushPromises } from '@vue/test-utils'
import { mount } from '@vue/test-utils'
import { useOnboardingPending } from '~~/app/composables/bookmark/useOnboardingPending'
import { useKocPromotionFlow } from '~~/app/composables/promotion/useKocPromotionFlow'
import { useUserStore } from '~~/app/stores/user'
import { baseUser } from '~~/tests/fixtures/user'
import { createPinia, setActivePinia } from 'pinia'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const env = vi.hoisted(() => ({ router: null as any, states: new Map<string, any>(), token: 'test-session', post: vi.fn(), get: vi.fn(), localEnabled: false, localRead: vi.fn(), pinia: null as any, fetch: vi.fn(), user: null as any }))
mockNuxtImport('useState', () => (key: string, init: () => unknown) => {
  if (!env.states.has(key)) env.states.set(key, ref(init()))
  return env.states.get(key)
})
mockNuxtImport('useI18n', () => () => ({ t: (key: string) => (key === 'promotion.resume' ? 'Claim KOC reward' : key) }))
mockNuxtImport('useHead', () => () => {})
mockNuxtImport('addChannelMessageHandler', () => () => {})
mockNuxtImport('removeChannelMessageHandler', () => () => {})
mockNuxtImport('postChannelMessage', () => () => {})
mockNuxtImport('useRoute', () => () => new Proxy({}, { get: (_, key) => env.router?.currentRoute.value[key] }))
mockNuxtImport('useRouter', () => () => env.router)
mockNuxtImport('navigateTo', () => (to: any, options: any) => (options?.replace ? env.router.replace(to) : env.router.push(to)))
mockNuxtImport('useRuntimeConfig', () => () => ({ app: { baseURL: '/' }, public: { DWEB_API_BASE_URL: 'https://api.test', TURNSTILE_SITE_KEY: '' } }))
mockNuxtImport('isLocalFirstEnabled', () => () => env.localEnabled)
mockNuxtImport('loadLocalUserInfo', () => env.localRead)
// Mock the complete network boundary: importing its real module while building
// partial auto-import mocks can evaluate the user store through a circular import.
vi.mock('~/utils/request', () => ({
  request: () => ({ post: env.post, get: env.get }),
  getUserToken: () => env.token,
  haveRequestToken: () => true,
  getClientEventHeaders: () => ({}),
  getDeviceId: () => 'test-device'
}))
vi.mock('~/components/Toast', () => ({ default: { showToast: vi.fn() }, ToastType: { Error: 'error' } }))
vi.mock('~/components/Modal', () => ({ showFeedbackModal: vi.fn() }))
enableAutoUnmount(afterEach)
beforeEach(() => {
  localStorage.clear()
  env.states.clear()
  env.token = 'test-session'
  env.localEnabled = false
  env.get.mockReset()
  env.localRead.mockReset()
  useState('onboarding-flags', () => ({})).value = {}
  useState('koc-promotion', initialPromotionState).value = initialPromotionState()
  env.pinia = createPinia()
  setActivePinia(env.pinia)
  env.user = useUserStore()
  vi.spyOn(env.user, 'changeLocalLocale').mockImplementation(async (locale: string) => { env.user.locale = locale })
  env.post.mockReset().mockResolvedValue({ title: 'Received', message: '60 days', subMessage: '' })
  env.fetch.mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify({
          data: url.includes('/me')
            ? baseUser
            : url.includes('blogger_info')
              ? { activity_type: 'blogger', activity_id: 'daguang' }
              : { status: false, reason: 'eligible', reward: { kind: 'trial', days: 60 } }
        })
      )
  )
  vi.stubGlobal('fetch', env.fetch)
})
afterEach(() => vi.unstubAllGlobals())
async function mountJourney(url: string, empty = true) {
  let mounts = 0
  const Inbox = defineComponent({
    name: 'bookmarks',
    setup() {
      mounts++
      void env.user.getUserInfo({ refresh: true }).catch(() => {})
      const flow = useKocPromotionFlow()
      const flags = useOnboardingPending(flow.userId)
      watch(
        [flow.blocksOnboarding, flow.userId, () => env.router.currentRoute.value.path, flags.isDismissed],
        ([blocked, id, path]) => {
          if (empty && id && !blocked && !flags.isDismissed.value && ['/', '/bookmarks'].includes(path as string)) {
            flags.setPending()
            void env.router.replace(flow.returnTarget('/onboarding'))
          }
        },
        { immediate: true }
      )
      return () => h('div', 'Inbox')
    }
  })
  env.router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', alias: '/bookmarks', component: Inbox },
      { path: '/onboarding', component: OnboardingPage },
      { path: '/elsewhere', component: { render: () => h('div', 'Elsewhere') } }
    ]
  })
  await env.router.push(url)
  await env.router.isReady()
  const Shell = defineComponent({
    setup: () => () =>
      h('div', [
        h(
          RouterView,
          {},
          {
            default: ({ Component }: any) =>
              h(KeepAlive, { include: ['bookmarks'] }, () => Component && h(Component, { key: env.router.currentRoute.value.path === '/onboarding' ? 'onboarding' : 'bookmarks' }))
          }
        ),
        h(KocPromotionHost)
      ])
  })
  const wrapper = mount(Shell, {
    global: {
      plugins: [env.pinia, env.router],
      stubs: {
        OnboardingTopBar: true,
        BookmarksOnboardingHero: {
          name: 'BookmarksOnboardingHero',
          emits: ['skip', 'complete'],
          template: '<button class="skip" @click="$emit(\'skip\')">Skip onboarding</button>'
        }
      }
    }
  })
  for (let i = 0; i < 4; i++) {
    await flushPromises()
    await nextTick()
  }
  return { wrapper, mounts: () => mounts }
}
it('initial page profile cannot overwrite the newer post-grant profile', async () => {
  const oldProfile = { ...baseUser, lang: 'zh', subscription_end_at: '2020-01-01T00:00:00.000Z' }
  const newProfile = { ...baseUser, lang: 'en', subscription_end_at: '2030-01-01T00:00:00.000Z' }
  env.user.locale = 'zh'
  let releaseOldProfile!: () => void
  env.get.mockImplementationOnce(() => new Promise(resolve => {
    releaseOldProfile = () => resolve(oldProfile)
  }))
  let received = false
  env.post.mockImplementationOnce(async () => {
    received = true
    return { title: 'Received', message: '60 days', subMessage: '' }
  })
  env.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify({ data:
    url.includes('/me') ? (received ? newProfile : oldProfile) :
    url.includes('blogger_info') ? { activity_type: 'blogger', activity_id: 'daguang' } : { status: false }
  })))
  const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true', false)
  await wrapper.find('.btn-confirm').trigger('click')
  await flushPromises()
  expect(env.user.userInfo.subscription_end_at).toBe(newProfile.subscription_end_at)
  expect(env.user.locale).toBe('en')
  releaseOldProfile()
  await flushPromises()
  expect(env.user.userInfo.subscription_end_at).toBe(newProfile.subscription_end_at)
  expect(env.user.locale).toBe('en')
})

it('keeps a newer server profile when an earlier offline fallback finishes later', async () => {
  env.localEnabled = true
  env.get.mockRejectedValueOnce(Error('offline')).mockResolvedValueOnce(baseUser)
  let release!: (value: unknown) => void
  env.localRead.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  const older = env.user.refreshUserInfo()
  await flushPromises()
  await env.user.refreshUserInfo()
  release({ ...baseUser, userId: 0, subscription_end_at: '2020-01-01' })
  await older
  expect(env.user.userInfo).toEqual(baseUser)
})

it('still provides local user info offline without using it as a KOC identity', async () => {
  env.localEnabled = true
  const local = { ...baseUser, userId: 0 }
  env.get.mockRejectedValue(Error('offline'))
  env.localRead.mockResolvedValue(local)
  await env.user.refreshUserInfo()
  expect(env.user.userInfo).toEqual(local)
  env.fetch.mockRejectedValue(Error('offline'))
  const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true', false)
  expect(useState('koc-promotion').value.userId).toBeNull()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  expect(env.post).not.toHaveBeenCalled()
})

it('does not restore a profile after user state is cleared in the same session', async () => {
  let release!: (value: unknown) => void
  env.get.mockReturnValueOnce(new Promise(resolve => { release = resolve }))
  const pending = env.user.refreshUserInfo()
  const rejected = expect(pending).rejects.toThrow('Session changed')
  await env.user.clearUserInfo()
  release(baseUser)
  await rejected
  expect(env.user.userInfo).toBeNull()
})
