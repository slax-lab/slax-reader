import { defineComponent, reactive, ref } from 'vue'

import SnapshotForkButton from '~/components/Snapshot/SnapshotForkButton.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises,mount } from '@vue/test-utils'
import { useBookmarkFork, useBookmarkForkMetadata } from '~/composables/bookmark/useBookmarkFork'
import { beforeEach, expect, it, vi } from 'vitest'

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

it('blocks offline/login saves and coalesces repeated clicks until admission without navigating', async () => {
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
  expect(mocks.navigate).not.toHaveBeenCalled()
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


it('shares same-source requests across entries while allowing other sources and accounts', async () => {
  const first = deferred(), other = deferred(), account = deferred()
  mocks.post.mockReturnValueOnce(first.promise).mockReturnValueOnce(other.promise).mockReturnValueOnce(account.promise)
  const a = useBookmarkFork(), b = useBookmarkFork()
  const requestA = a.fork('shared')
  await b.fork('shared')
  expect(mocks.post).toHaveBeenCalledTimes(1)
  const requestOther = b.fork('other')
  expect(mocks.post).toHaveBeenCalledTimes(2)
  mocks.user.userInfo.userId = 2
  const requestAccount = useBookmarkFork().fork('shared')
  expect(mocks.post).toHaveBeenCalledTimes(3)
  first.resolve({ bookmark_uid: 'old-account', disposition: 'updated' })
  other.resolve(null)
  account.resolve({ bookmark_uid: 'current-account', disposition: 'updated' })
  await Promise.all([requestA, requestOther, requestAccount])
  expect(mocks.navigate).not.toHaveBeenCalledWith('/b/old-account')
  expect(mocks.navigate).not.toHaveBeenCalled()
})


it('reflects a shared source request in both entries and releases UI reentry after a timeout without automatically retrying', async () => {
  const source = ref('timeout-source')
  const a = useBookmarkFork(source), b = useBookmarkFork(source)
  const timeout = new Error('timeout'); timeout.name = 'TimeoutError'
  mocks.post.mockRejectedValueOnce(timeout)
  const result = a.fork(source.value)
  expect(b.pending.value).toBe(true)
  await result
  expect(b.pending.value).toBe(false)
  expect(mocks.post).toHaveBeenCalledOnce()
  await b.fork(source.value)
  expect(mocks.post).toHaveBeenCalledTimes(2)
  source.value = 'other-source'
  expect(b.pending.value).toBe(false)
})

const mountButton = (source = 'source') => mount(SnapshotForkButton, {
  props: { bookmarkUid: source },
  global: { mocks: { $t: (key: string) => key } }
})
const metadataFor = (viewerStatus: 'pending' | 'success' | 'failed' | null) => ({
  has_fork: false, can_fork: true, fork: null, viewer_fork_status: viewerStatus
})

it.each(['pending', 'success'] as const)('disables a revisited source from persisted %s status without local sync', async status => {
  mocks.get.mockResolvedValue(metadataFor(status))
  const wrapper = mountButton()
  await flushPromises()
  expect(wrapper.get('button').element.disabled).toBe(true)
  await wrapper.get('button').trigger('click')
  expect(mocks.post).not.toHaveBeenCalled()
  expect(wrapper.text()).toContain('bookmark_fork.saved')
  wrapper.unmount()
})

it('stays on source and disables all source buttons immediately after admission', async () => {
  mocks.get.mockResolvedValue(metadataFor(null))
  const a = mountButton(), b = mountButton()
  await flushPromises()
  const admission = deferred(), status = deferred()
  mocks.post.mockReturnValueOnce(admission.promise)
  await a.get('button').trigger('click')
  expect(b.get('button').element.disabled).toBe(true)
  mocks.get.mockReturnValue(status.promise)
  admission.resolve({ bookmark_uid: 'destination', disposition: 'created' })
  await flushPromises()
  expect(a.get('button').element.disabled).toBe(true)
  expect(b.get('button').element.disabled).toBe(true)
  expect(mocks.navigate).not.toHaveBeenCalled()
  expect(a.get('button').attributes('aria-busy')).toBe('false')
  status.resolve(metadataFor('pending'))
  await flushPromises()
  expect(a.get('button').element.disabled).toBe(true)
  a.unmount(); b.unmount()
})

it('allows explicit retry after failure and a new fork after deletion on revisits', async () => {
  mocks.get.mockResolvedValue(metadataFor('success'))
  const previous = mountButton()
  await flushPromises()
  expect(previous.get('button').element.disabled).toBe(true)
  previous.unmount()
  mocks.get.mockResolvedValue(metadataFor('failed'))
  const failed = mountButton()
  await flushPromises()
  expect(failed.get('button').element.disabled).toBe(false)
  mocks.post.mockRejectedValueOnce(new Error('network failure'))
  await failed.get('button').trigger('click')
  await flushPromises()
  expect(failed.get('button').element.disabled).toBe(false)
  failed.unmount()
  mocks.get.mockResolvedValue(metadataFor(null))
  const deleted = mountButton()
  await flushPromises()
  expect(deleted.get('button').element.disabled).toBe(false)
  deleted.unmount()
})

it('keeps deliberate Reader URL refresh available even when the source button is disabled', async () => {
  mocks.get.mockResolvedValue(metadataFor('success'))
  const button = mountButton()
  await flushPromises()
  mocks.post.mockResolvedValue({ bookmark_uid: 'destination', disposition: 'updated' })
  const result = await useBookmarkFork().fork('source')
  expect(result?.disposition).toBe('updated')
  expect(mocks.post).toHaveBeenCalledOnce()
  expect(mocks.navigate).not.toHaveBeenCalled()
  button.unmount()
})

it('does not apply a late accepted request or metadata to another account or route', async () => {
  const oldMetadata = deferred(), accepted = deferred()
  mocks.get.mockReturnValueOnce(oldMetadata.promise).mockResolvedValue(metadataFor(null))
  mocks.post.mockReturnValueOnce(accepted.promise)
  const wrapper = mountButton('old-source')
  await wrapper.get('button').trigger('click')
  mocks.user.userInfo.userId = 2
  await wrapper.setProps({ bookmarkUid: 'new-source' })
  oldMetadata.resolve(metadataFor('success'))
  accepted.resolve({ bookmark_uid: 'old-destination', disposition: 'created' })
  await flushPromises()
  expect(wrapper.get('button').element.disabled).toBe(false)
  expect(mocks.navigate).not.toHaveBeenCalled()
  wrapper.unmount()
})
