// @vitest-environment happy-dom
import { computed,defineComponent, h, KeepAlive, nextTick, ref, watch } from 'vue'
import { createMemoryHistory, createRouter, RouterView } from 'vue-router'

import KocPromotionHost from '~~/app/components/Promotion/KocPromotionHost.vue'
import OnboardingPage from '~~/app/pages/onboarding.vue'

import { initialPromotionState } from '~~/app/utils/promotionFlow'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { enableAutoUnmount,flushPromises } from '@vue/test-utils'
import { mount } from '@vue/test-utils'
import { useOnboardingPending } from '~~/app/composables/bookmark/useOnboardingPending'
import { useKocPromotionFlow } from '~~/app/composables/promotion/useKocPromotionFlow'
import { baseUser } from '~~/tests/fixtures/user'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const env = vi.hoisted(() => ({ router: null as any, states: new Map<string, any>(), token: 'test-session', post: vi.fn(), fetch: vi.fn(), channel: null as any, user: null as any }))
mockNuxtImport('useState', () => (key: string, init: () => unknown) => {
  if (!env.states.has(key)) env.states.set(key, ref(init()))
  return env.states.get(key)
})
mockNuxtImport('useI18n', () => () => ({ t: (key: string) => (key === 'promotion.resume' ? 'Claim KOC reward' : key) }))
mockNuxtImport('useHead', () => () => {})
mockNuxtImport('getClientEventHeaders', () => () => ({}))
mockNuxtImport('addChannelMessageHandler', () => (handler: any) => { env.channel = handler })
mockNuxtImport('removeChannelMessageHandler', () => () => {})
mockNuxtImport('postChannelMessage', () => () => {})
mockNuxtImport('getUserToken', () => () => env.token)
mockNuxtImport('useRoute', () => () => new Proxy({}, { get: (_, key) => env.router?.currentRoute.value[key] }))
mockNuxtImport('useRouter', () => () => env.router)
mockNuxtImport('navigateTo', () => (to: any, options: any) => (options?.replace ? env.router.replace(to) : env.router.push(to)))
mockNuxtImport('request', () => () => ({ post: env.post }))
mockNuxtImport('useRuntimeConfig', () => () => ({ app: { baseURL: '/' }, public: { DWEB_API_BASE_URL: 'https://api.test', TURNSTILE_SITE_KEY: '' } }))
vi.mock('~/stores/user', () => ({ useUserStore: () => env.user }))
vi.mock('~/components/Toast', () => ({ default: { showToast: vi.fn() }, ToastType: { Error: 'error' } }))
vi.mock('~/components/Modal', () => ({ showFeedbackModal: vi.fn() }))
enableAutoUnmount(afterEach)
beforeEach(() => {
  localStorage.clear()
  env.states.clear()
  useState('onboarding-flags', () => ({})).value = {}
  useState('koc-promotion', initialPromotionState).value = initialPromotionState()
  env.token = 'test-session'
  env.channel = null
  env.user = {
    user: null, userInfo: null, locale: 'en', changeLocalLocale: vi.fn(), getUserInfo: vi.fn().mockResolvedValue(baseUser),
    refreshServerUserInfo: async () => {
      const token = env.token
      const response = await env.fetch('https://api.test/v1/user/me')
      const { data } = await response.json()
      if (token !== env.token || !response.ok) throw Error('Profile unavailable')
      env.user.user = data
      return data
    }
  }
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


it.each(['validation', 'eligibility'])('keeps an explicit invite when another tab changes storage during %s', async stage => {
  let release!: (response: Response) => void
  env.fetch.mockImplementation(async (url: string) => {
    if (url.includes('/me')) return new Response(JSON.stringify({ data: baseUser }))
    const isValidation = url.includes('blogger_info')
    const data = isValidation
      ? { activity_type: 'blogger', activity_id: new URL(url).searchParams.get('blogger') }
      : { status: false }
    if (!release && ((stage === 'validation' && isValidation) || (stage === 'eligibility' && !isValidation)))
      return new Promise<Response>(resolve => { release = resolve })
    return new Response(JSON.stringify({ data }))
  })
  const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true#retained', false)
  const key = `slax_koc_pending_v1_${baseUser.userId}`
  localStorage.setItem(key, JSON.stringify({ version: 1, blogger: 'lenyy', capturedAt: 1, deferred: true }))
  window.dispatchEvent(new StorageEvent('storage', { key }))
  await flushPromises()
  release(new Response(JSON.stringify({ data: stage === 'validation' ? { activity_type: 'blogger', activity_id: 'daguang' } : { status: false } })))
  await flushPromises()
  await flushPromises()
  expect(useState('koc-promotion').value.pending?.blogger).toBe('daguang')
  expect(JSON.parse(localStorage.getItem(key)!).blogger).toBe('daguang')
  expect(env.router.currentRoute.value.fullPath).toBe('/#retained')
  expect(wrapper.find('[role="dialog"]').exists()).toBe(true)
  await wrapper.find('.btn-confirm').trigger('click')
  await flushPromises()
  expect(env.post.mock.calls[0][0].body.activity_id).toBe('daguang')
})

it('still restores another tab invitation on a bare Inbox URL', async () => {
  const { wrapper } = await mountJourney('/', false)
  const key = `slax_koc_pending_v1_${baseUser.userId}`
  localStorage.setItem(key, JSON.stringify({ version: 1, blogger: 'daguang', capturedAt: 1, deferred: true }))
  window.dispatchEvent(new StorageEvent('storage', { key }))
  await flushPromises()
  await flushPromises()
  expect(wrapper.text()).toContain('Claim KOC reward')
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  expect(useState('koc-promotion').value.pending?.blogger).toBe('daguang')
})


it('restores the newest stored invite when an older stored invite is still validating', async () => {
  const key = `slax_koc_pending_v1_${baseUser.userId}`
  localStorage.setItem(key, JSON.stringify({ version: 1, blogger: 'daguang', capturedAt: 1, deferred: true }))
  let release!: (response: Response) => void
  env.fetch.mockImplementation(async (url: string) => {
    if (url.includes('/me')) return new Response(JSON.stringify({ data: baseUser }))
    if (url.includes('blogger_info')) {
      const blogger = new URL(url).searchParams.get('blogger')
      if (blogger === 'daguang' && !release) return new Promise<Response>(resolve => { release = resolve })
      return new Response(JSON.stringify({ data: { activity_type: 'blogger', activity_id: blogger } }))
    }
    return new Response(JSON.stringify({ data: { status: false } }))
  })
  const { wrapper } = await mountJourney('/', false)
  localStorage.setItem(key, JSON.stringify({ version: 1, blogger: 'lenyy', capturedAt: 2, deferred: true }))
  window.dispatchEvent(new StorageEvent('storage', { key }))
  release(new Response(JSON.stringify({ data: { activity_type: 'blogger', activity_id: 'daguang' } })))
  await flushPromises()
  await flushPromises()
  expect(useState('koc-promotion').value.pending?.blogger).toBe('lenyy')
  expect(JSON.parse(localStorage.getItem(key)!).blogger).toBe('lenyy')
  expect(wrapper.text()).toContain('Claim KOC reward')
})

it('reconciles a KOC grant that settles after returning from another page', async () => {
  let received = false
  let release!: () => void
  env.post.mockImplementationOnce(() => new Promise(resolve => {
    release = () => {
      received = true
      resolve({ title: 'Received', message: '60 days', subMessage: '' })
    }
  }))
  env.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify({ data:
    url.includes('/me') ? { ...baseUser, nickname: received ? 'refreshed' : 'original' } :
    url.includes('blogger_info') ? { activity_type: 'blogger', activity_id: 'daguang' } :
    { status: received, reason: received ? 'already_received' : 'eligible' }
  })))
  const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true', false)
  await wrapper.find('.btn-confirm').trigger('click')
  await env.router.push('/elsewhere')
  await flushPromises()
  await env.router.push('/')
  await flushPromises()
  expect(wrapper.find('.form-state').exists()).toBe(false)
  release()
  await flushPromises()
  await flushPromises()
  expect(wrapper.find('.form-state').exists()).toBe(false)
  expect(useState('koc-promotion').value.pending).toBeNull()
  expect(env.user.user.nickname).toBe('refreshed')
})

it('adopts a newer stored invitation after the original in-flight claim fails', async () => {
  let reject!: (error: Error) => void
  env.post.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  env.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify({ data:
    url.includes('/me') ? baseUser : url.includes('blogger_info') ?
    { activity_type: 'blogger', activity_id: new URL(url).searchParams.get('blogger') } : { status: false }
  })))
  const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true', false)
  await wrapper.find('.btn-confirm').trigger('click')
  const key = `slax_koc_pending_v1_${baseUser.userId}`
  localStorage.setItem(key, JSON.stringify({ version: 1, blogger: 'lenyy', capturedAt: 9, deferred: true }))
  window.dispatchEvent(new StorageEvent('storage', { key }))
  await flushPromises()
  reject(Error('connection lost'))
  await flushPromises()
  await flushPromises()
  expect(useState('koc-promotion').value.pending.blogger).toBe('lenyy')
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
})

it('reconciles a disposed failed submission against a newer explicit invitation', async () => {
  let reject!: (error: Error) => void
  env.post.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  env.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify({ data:
    url.includes('/me') ? baseUser : url.includes('blogger_info') ?
    { activity_type: 'blogger', activity_id: new URL(url).searchParams.get('blogger') } : { status: false }
  })))
  const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true', false)
  await wrapper.find('.btn-confirm').trigger('click')
  await env.router.push('/elsewhere')
  await flushPromises()
  await env.router.push('/?activity_id=lenyy&activity_type=blogger&claim=true')
  await flushPromises()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  expect(env.router.currentRoute.value.query.activity_id).toBe('lenyy')
  reject(Error('connection lost'))
  await flushPromises()
  await flushPromises()
  expect(useState('koc-promotion').value.pending.blogger).toBe('lenyy')
  expect(wrapper.find('.form-state').exists()).toBe(true)
  expect(env.post).toHaveBeenCalledTimes(1)
})

it('does not let a disposed submission change a newly authenticated account', async () => {
  let release!: () => void
  env.post.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ title: 'Received', message: '60 days' }) }))
  const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true', false)
  await wrapper.find('.btn-confirm').trigger('click')
  await env.router.push('/elsewhere')
  await flushPromises()
  env.token = 'another-account'
  env.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify({ data:
    url.includes('/me') ? { ...baseUser, userId: baseUser.userId + 1 } :
    url.includes('blogger_info') ? { activity_type: 'blogger', activity_id: 'lenyy' } : { status: false }
  })))
  await env.router.push('/?activity_id=lenyy&activity_type=blogger&claim=true')
  await flushPromises()
  const newProfile = env.user.user
  release()
  await flushPromises()
  expect(useState('koc-promotion').value.pending.blogger).toBe('lenyy')
  expect(useState('koc-promotion').value.userId).toBe(baseUser.userId + 1)
  expect(env.user.user).toBe(newProfile)
  expect(wrapper.find('.form-state').exists()).toBe(true)
  env.token = 'test-session'
})

it('retains a queued storage invitation when a subscription broadcast arrives during a disposed submission', async () => {
  let reject!: (error: Error) => void
  env.post.mockImplementationOnce(() => new Promise((_resolve, fail) => { reject = fail }))
  env.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify({ data:
    url.includes('/me') ? baseUser : url.includes('blogger_info') ?
    { activity_type: 'blogger', activity_id: new URL(url).searchParams.get('blogger') } : { status: false }
  })))
  const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true', false)
  await wrapper.find('.btn-confirm').trigger('click')
  await env.router.push('/elsewhere')
  await flushPromises()
  await env.router.push('/')
  await flushPromises()
  const key = `slax_koc_pending_v1_${baseUser.userId}`
  localStorage.setItem(key, JSON.stringify({ version: 1, blogger: 'lenyy', capturedAt: 9, deferred: true }))
  window.dispatchEvent(new StorageEvent('storage', { key }))
  env.channel('subscription', { subscription: { userId: baseUser.userId } })
  await flushPromises()
  expect(JSON.parse(localStorage.getItem(key)!).blogger).toBe('lenyy')
  reject(Error('connection lost'))
  await flushPromises()
  await flushPromises()
  expect(useState('koc-promotion').value.pending.blogger).toBe('lenyy')
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
})

it('does not block the new account subscription broadcast with an old submission owner', async () => {
  let release!: () => void
  env.post.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve({ title: 'Received', message: '60 days' }) }))
  const { wrapper } = await mountJourney('/?activity_id=daguang&activity_type=blogger&claim=true', false)
  await wrapper.find('.btn-confirm').trigger('click')
  await env.router.push('/elsewhere')
  await flushPromises()
  env.token = 'new-account'
  const user = { ...baseUser, userId: baseUser.userId + 1 }
  let received = false
  env.fetch.mockImplementation(async (url: string) => new Response(JSON.stringify({ data:
    url.includes('/me') ? user : url.includes('blogger_info') ?
    { activity_type: 'blogger', activity_id: 'lenyy' } : { status: received, reason: received ? 'already_received' : 'eligible' }
  })))
  await env.router.push('/?activity_id=lenyy&activity_type=blogger&claim=true')
  await flushPromises()
  received = true
  env.channel('subscription', { subscription: { userId: user.userId } })
  await flushPromises()
  await flushPromises()
  expect(useState('koc-promotion').value.pending).toBeNull()
  expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  release()
  await flushPromises()
})

it('drains a profile refresh queued behind a failed read', async () => {
  await mountJourney('/', false)
  let reject!: (error: Error) => void
  let profileReads = 0
  env.fetch.mockImplementation(async () => {
    profileReads++
    if (profileReads === 1) return await new Promise((_resolve, fail) => { reject = fail })
    return new Response(JSON.stringify({ data: { ...baseUser, name: 'Refreshed' } }))
  })
  env.channel('subscription', { subscription: { userId: baseUser.userId } })
  await flushPromises()
  env.channel('subscription', { subscription: { userId: baseUser.userId } })
  reject(Error('temporary network failure'))
  await flushPromises()
  expect(profileReads).toBe(2)
  expect(env.user.user.name).toBe('Refreshed')
})
