import { defineComponent, reactive, ref } from 'vue'
import { mount, flushPromises } from '@vue/test-utils'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, expect, it, vi } from 'vitest'
import { useBookmarkFork, useBookmarkForkMetadata } from '~/composables/bookmark/useBookmarkFork'

const mocks = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), navigate: vi.fn(), login: vi.fn(), toast: vi.fn(), user: null as any }))
vi.mock('~/stores/user', () => ({ useUserStore: () => mocks.user }))
vi.mock('~/utils/request', () => ({ request: () => ({ get: mocks.get, post: mocks.post }) }))
vi.mock('~/components/Modal', () => ({ showLoginModal: mocks.login }))
vi.mock('~/components/Toast', () => ({ default: { showToast: mocks.toast }, ToastType: { Error: 'error' } }))
mockNuxtImport('navigateTo', () => mocks.navigate)
mockNuxtImport('useI18n', () => () => ({ t: (key: string) => key }))

beforeEach(() => {
  vi.clearAllMocks()
  mocks.user = reactive({ isLogin: true, userInfo: { userId: 1 } })
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
})
const deferred = () => { let resolve!: (value: any) => void; const promise = new Promise(r => { resolve = r }); return { promise, resolve } }

it('blocks offline/login saves and coalesces repeated clicks until navigation completes', async () => {
  const action = useBookmarkFork()
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true })
  await action.fork('source')
  expect(mocks.post).not.toHaveBeenCalled()
  expect(action.error.value).toBe('bookmark_fork.offline')
  Object.defineProperty(navigator, 'onLine', { value: true, configurable: true })
  mocks.user.isLogin = false
  await action.fork('source')
  expect(mocks.login).toHaveBeenCalledOnce()
  mocks.user.isLogin = true
  const result = deferred()
  mocks.post.mockReturnValueOnce(result.promise)
  const pending = action.fork('source')
  await action.fork('source')
  expect(action.pending.value).toBe(true)
  expect(mocks.post).toHaveBeenCalledOnce()
  result.resolve({ bookmark_uid: 'destination', disposition: 'already_saved' })
  await pending
  expect(mocks.navigate).toHaveBeenCalledWith('/b/destination')
  expect(action.pending.value).toBe(false)
})

it('clears account-scoped attribution and ignores stale route/account responses without extra CORS headers', async () => {
  const first = deferred(), second = deferred(), third = deferred()
  mocks.get.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
  const uuid = ref('first')
  let metadata: ReturnType<typeof useBookmarkForkMetadata>
  const wrapper = mount(defineComponent({ setup() { metadata = useBookmarkForkMetadata(uuid); return () => null } }))
  expect(mocks.get.mock.calls[0][0].headers).toBeUndefined()
  uuid.value = 'second'
  first.resolve({ has_fork: true, fork: { display_name: 'Stale route owner' } })
  await flushPromises()
  expect(metadata!.value).toBeNull()
  second.resolve({ has_fork: true, fork: { display_name: 'Current owner' } })
  await flushPromises()
  expect(metadata!.value?.fork?.display_name).toBe('Current owner')
  mocks.user.userInfo.userId = 2
  expect(metadata!.value).toBeNull()
  third.resolve({ has_fork: true, fork: { status: 'unavailable' } })
  await flushPromises()
  expect(metadata!.value?.fork?.status).toBe('unavailable')
  wrapper.unmount()
})
