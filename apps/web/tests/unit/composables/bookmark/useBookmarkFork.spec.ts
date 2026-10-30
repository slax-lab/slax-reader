import { computed, reactive, ref } from 'vue'

import SnapshotForkButton from '~/components/Snapshot/SnapshotForkButton.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises, mount } from '@vue/test-utils'
import { useBookmarkFork } from '~/composables/bookmark/useBookmarkFork'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ post: vi.fn(), login: vi.fn(), toast: vi.fn(), user: null as any }))
vi.mock('~/stores/user', () => ({ useUserStore: () => mocks.user }))
vi.mock('~/composables/useAccountContext', () => ({ useAccountContext: () => ({ sync: () => {}, context: computed(() => ({ generation: mocks.user.generation })) }) }))
vi.mock('~/utils/request', () => ({ request: () => ({ post: mocks.post }) }))
vi.mock('~/components/Modal', () => ({ showLoginModal: mocks.login }))
vi.mock('~/components/Toast', () => ({ default: { showToast: mocks.toast }, ToastType: { Error: 'error' } }))
mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }))

beforeEach(() => {
  vi.clearAllMocks()
  useRuntimeConfig().public.PUBLIC_BASE_URL = 'https://reader.test'
  mocks.user = reactive({ isLogin: true, userInfo: { userId: 1 }, generation: 0 })
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }
const mountButton = (status: 'pending' | 'success' | 'failed' | null = null) => mount(SnapshotForkButton, {
  props: { bookmarkUid: 'source', viewerForkStatus: status },
  global: { mocks: { $t: (key: string) => key } }
})

it('blocks offline and anonymous saves using existing feedback', async () => {
  const action = useBookmarkFork()
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
  await action.fork('source')
  expect(mocks.post).not.toHaveBeenCalled()
  expect(action.error.value).toBe('bookmark_fork.offline')
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  mocks.user.isLogin = false
  await action.fork('source')
  expect(mocks.login).toHaveBeenCalledOnce()
  expect(mocks.post).not.toHaveBeenCalled()
})

it('uses add_url admission without requiring a destination UUID; shares request and saved state', async () => {
  const a = mountButton(), b = mountButton()
  const pending = deferred()
  mocks.post.mockReturnValueOnce(pending.promise)
  await a.get('button').trigger('click')
  await b.get('button').trigger('click')
  expect(mocks.post).toHaveBeenCalledOnce()
  expect(mocks.post.mock.calls[0][0]).toMatchObject({ url: '/v1/bookmark/add_url', body: { target_url: 'https://reader.test/b/source', tags: [] } })
  expect(b.get('button').element.disabled).toBe(true)
  pending.resolve({ bmId: '' })
  await flushPromises()
  expect(a.emitted('accepted')).toHaveLength(1)
  expect(a.get('button').element.disabled).toBe(true)
  expect(b.get('button').element.disabled).toBe(true)
  expect(a.get('button').attributes('aria-busy')).toBe('false')
  a.unmount(); b.unmount()
})

it.each(['pending', 'success'] as const)('uses persisted %s from page detail and supports deliberate URL refresh', async status => {
  const button = mountButton(status)
  expect(button.get('button').element.disabled).toBe(true)
  mocks.post.mockResolvedValue({ bmId: '' })
  expect(await useBookmarkFork().fork('source')).toEqual({ bmId: '' })
  expect(mocks.post).toHaveBeenCalledOnce()
  button.unmount()
})

it('reconciles failed/deleted copies on a fresh detail and permits explicit retry after request failure', async () => {
  const button = mountButton('success')
  await button.setProps({ viewerForkStatus: 'failed' })
  expect(button.get('button').element.disabled).toBe(false)
  mocks.post.mockRejectedValueOnce(new Error('network failure'))
  await button.get('button').trigger('click')
  await flushPromises()
  expect(button.get('button').element.disabled).toBe(false)
  expect(button.emitted('accepted')).toBeUndefined()
  await button.setProps({ viewerForkStatus: 'success' })
  await button.setProps({ viewerForkStatus: null })
  expect(button.get('button').element.disabled).toBe(false)
  button.unmount()
})

it('suppresses actions while the new account detail is unavailable', async () => {
  const button = mountButton()
  await button.setProps({ ready: false, viewerForkStatus: undefined })
  await button.get('button').trigger('click')
  expect(mocks.post).not.toHaveBeenCalled()
  expect(button.get('button').element.disabled).toBe(true)
  button.unmount()
})

it.each(['account', 'session', 'route'])('ignores late acceptance after a %s change', async change => {
  const pending = deferred()
  mocks.post.mockReturnValueOnce(pending.promise)
  const button = mountButton()
  await button.get('button').trigger('click')
  if (change === 'route') await button.setProps({ bookmarkUid: 'another-source' })
  else {
    mocks.user.generation++
    if (change === 'account') mocks.user.userInfo.userId = 2
  }
  pending.resolve({ bmId: '' })
  await flushPromises()
  expect(button.emitted('accepted')).toBeUndefined()
  button.unmount()
})

it('coalesces same-source requests while allowing independent resources', async () => {
  const source = ref('source')
  const a = useBookmarkFork(source), b = useBookmarkFork(source)
  const pending = deferred()
  mocks.post.mockReturnValueOnce(pending.promise)
  const result = a.fork('source')
  await b.fork('source')
  expect(mocks.post).toHaveBeenCalledOnce()
  expect(b.pending.value).toBe(true)
  await b.fork('other')
  expect(mocks.post).toHaveBeenCalledTimes(2)
  pending.resolve(null)
  await result
  expect(b.pending.value).toBe(false)
})
