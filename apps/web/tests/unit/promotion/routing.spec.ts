// @vitest-environment happy-dom
import { defineComponent, h, KeepAlive, ref, nextTick, watch, computed } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises, enableAutoUnmount } from '@vue/test-utils'
import { beforeEach, afterEach, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import KocPromotionHost from '~~/app/components/Promotion/KocPromotionHost.vue'
import OnboardingPage from '~~/app/pages/onboarding.vue'
import { useKocPromotionFlow } from '~~/app/composables/promotion/useKocPromotionFlow'
import { useOnboardingPending } from '~~/app/composables/bookmark/useOnboardingPending'
import { initialPromotionState } from '~~/app/utils/promotionFlow'
import { baseUser } from '~~/tests/fixtures/user'
const env = vi.hoisted(() => ({ router: null as any, states: new Map<string, any>(), token: 'test-session', post: vi.fn(), fetch: vi.fn(), user: null as any }))
mockNuxtImport('useState', () => (key: string, init: () => unknown) => {
  if (!env.states.has(key)) env.states.set(key, ref(init()))
  return env.states.get(key)
})
mockNuxtImport('useI18n', () => () => ({ t: (key: string, args?: any) => (key === 'promotion.resume' ? 'Claim KOC reward' : key) }))
mockNuxtImport('useHead', () => () => {})
mockNuxtImport('getClientEventHeaders', () => () => ({}))
mockNuxtImport('addChannelMessageHandler', () => () => {})
mockNuxtImport('removeChannelMessageHandler', () => () => {})
mockNuxtImport('postChannelMessage', () => () => {})
mockNuxtImport('getUserToken', () => () => env.token)
mockNuxtImport('useRoute', () => () => new Proxy({}, { get: (_, key) => env.router?.currentRoute.value[key] }))
mockNuxtImport('useRouter', () => () => env.router)
mockNuxtImport('navigateTo', () => (to: any, options: any) => (options?.replace ? env.router.replace(to) : env.router.push(to)))
mockNuxtImport('request', () => () => ({ post: env.post }))
mockNuxtImport('useRuntimeConfig', () => () => ({ app: { baseURL: '/' }, public: { DWEB_API_BASE_URL: 'https://api.test', TURNSTILE_SITE_KEY: '' } }))
vi.mock('~/stores/user', () => ({ useUserStore: () => env.user }))
vi.mock('~/components/Modal', () => ({ showFeedbackModal: vi.fn() }))
enableAutoUnmount(afterEach)
beforeEach(() => {
  localStorage.clear()
  env.states.clear()
  useState('onboarding-flags', () => ({})).value = {}
  useState('koc-promotion', initialPromotionState).value = initialPromotionState()
  env.user = { user: null, userInfo: null, getUserInfo: vi.fn().mockResolvedValue(baseUser) }
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
      plugins: [env.router],
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
it('presents claim before onboarding, acknowledges success, and skips back to the cached root Inbox', async () => {
  const { wrapper, mounts } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true')
  expect(env.router.currentRoute.value.fullPath).toBe('/')
  expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  await wrapper.find('.btn-confirm').trigger('click')
  await flushPromises()
  expect(env.router.currentRoute.value.path).toBe('/')
  await wrapper.find('.success-continue').trigger('click')
  await flushPromises()
  expect(env.router.currentRoute.value.path).toBe('/onboarding')
  await wrapper.find('.skip').trigger('click')
  await flushPromises()
  expect(env.router.currentRoute.value.path).toBe('/')
  expect(mounts()).toBe(1)
  expect(env.post).toHaveBeenCalledTimes(1)
})
it('restores Later after a document reconstruction and rearms on a fresh invitation', async () => {
  const first = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true')
  await first.wrapper.find('.btn-cancel').trigger('click')
  await flushPromises()
  expect(env.router.currentRoute.value.path).toBe('/onboarding')
  first.wrapper.unmount()
  useState('koc-promotion', initialPromotionState).value = initialPromotionState()
  const next = await mountJourney('/onboarding')
  expect(next.wrapper.find('[role="dialog"]').exists()).toBe(false)
  expect(next.wrapper.text()).toContain('Claim KOC reward')
  await env.router.push('/?activity_id=daguang&activity_type=blogger&claim=true')
  await flushPromises()
  expect(next.wrapper.find('[role="dialog"]').exists()).toBe(true)
  expect(env.post).not.toHaveBeenCalled()
})
it('reopens an unresolved offer after navigating away and returning to a cached root', async () => {
  const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true', false)
  await env.router.push('/elsewhere')
  await flushPromises()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  await env.router.push('/')
  await flushPromises()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
})
it('does not strand success after leaving before acknowledgement', async () => {
  const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true')
  await wrapper.find('.btn-confirm').trigger('click')
  await flushPromises()
  await env.router.push('/elsewhere')
  await flushPromises()
  await env.router.push('/')
  await flushPromises()
  expect(env.router.currentRoute.value.path).toBe('/onboarding')
  expect(env.post).toHaveBeenCalledTimes(1)
})
it('keeps the newest explicit invite when an earlier status response is delayed', async () => {
  let release!: (r: Response) => void
  env.fetch.mockImplementation(async (url: string) => {
    if (url.includes('/me')) return new Response(JSON.stringify({ data: baseUser }))
    if (url.includes('blogger_info')) return new Response(JSON.stringify({ data: { activity_type: 'blogger', activity_id: new URL(url).searchParams.get('blogger') } }))
    if (!release)
      return new Promise<Response>(r => {
        release = r
      })
    return new Response(JSON.stringify({ data: { status: false } }))
  })
  const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true', false)
  await env.router.push('/?activity_id=lenyy&activity_type=blogger&claim=true#retained')
  release(new Response(JSON.stringify({ data: { status: false } })))
  await flushPromises()
  await flushPromises()
  expect(useState('koc-promotion').value.pending.blogger).toBe('lenyy')
  expect(env.router.currentRoute.value.fullPath).toBe('/#retained')
  await wrapper.find('.btn-confirm').trigger('click')
  await flushPromises()
  expect(env.post.mock.calls[0][0].body.activity_id).toBe('lenyy')
})

it('preserves deferred URL fallback through onboarding when storage is denied', async () => {
  const get = vi.spyOn(localStorage, 'getItem').mockImplementation(() => {
    throw Error('denied')
  })
  const set = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
    throw Error('denied')
  })
  try {
    const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true')
    expect(set).toHaveBeenCalled()
    await wrapper.find('.btn-cancel').trigger('click')
    await flushPromises()
    await flushPromises()
    expect(env.router.currentRoute.value.path).toBe('/onboarding')
    expect(env.router.currentRoute.value.query).toMatchObject({ activity_id: 'daguang', koc_deferred: 'true' })
    await wrapper.find('.skip').trigger('click')
    await flushPromises()
    expect(env.router.currentRoute.value.path).toBe('/')
    expect(env.router.currentRoute.value.query.koc_deferred).toBe('true')
    await wrapper
      .findAll('button')
      .find(button => button.text() === 'Claim KOC reward')!
      .trigger('click')
    await flushPromises()
    await flushPromises()
    expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
    expect(env.router.currentRoute.value.query.koc_deferred).toBeUndefined()
  } finally {
    get.mockRestore()
    set.mockRestore()
  }
})

it('keeps attribution stable in flight and selects a newer invitation after a failed attempt', async () => {
  let reject!: (e: Error) => void
  env.post.mockReturnValueOnce(
    new Promise((_resolve, fail) => {
      reject = fail
    })
  )
  env.fetch.mockImplementation(
    async (url: string) =>
      new Response(
        JSON.stringify({
          data: url.includes('/me')
            ? baseUser
            : url.includes('blogger_info')
              ? { activity_type: 'blogger', activity_id: new URL(url).searchParams.get('blogger') }
              : { status: false }
        })
      )
  )
  const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true', false)
  await wrapper.find('.btn-confirm').trigger('click')
  await env.router.push('/?activity_id=lenyy&activity_type=blogger&claim=true')
  await flushPromises()
  expect(env.post.mock.calls[0][0].body.activity_id).toBe('daguang')
  expect(env.router.currentRoute.value.query.activity_id).toBe('lenyy')
  reject(Error('connection lost'))
  await flushPromises()
  await flushPromises()
  expect(useState('koc-promotion').value.pending.blogger).toBe('lenyy')
  expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
})
