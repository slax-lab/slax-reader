import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { post, store, navigate, login, toast, clearData } = vi.hoisted(() => ({
  post: vi.fn(),
  store: { isLogin: true },
  navigate: vi.fn(),
  login: vi.fn(),
  toast: vi.fn(),
  clearData: vi.fn()
}))

mockNuxtImport('request', () => () => ({ post }))
mockNuxtImport('navigateTo', () => navigate)
mockNuxtImport('clearNuxtData', () => clearData)
mockNuxtImport('useRequestURL', () => () => new URL('https://r.slax.com/b/source-uuid?highlight=mark'))
vi.mock('~/stores/user', () => ({ useUserStore: () => store }))
vi.mock('~/components/Modal', () => ({ showLoginModal: login }))
vi.mock('~/components/Toast', () => ({ default: { showToast: toast }, ToastType: { Success: 'success', Error: 'error' } }))

const mountButton = async (props = {}) => {
  const component = (await import('~~/app/components/Snapshot/SnapshotForkButton.vue')).default
  return mountWithApp(component, { props: { bookmarkUid: 'source-uuid', canFork: true, isOwner: false, ...props } })
}

describe('SnapshotForkButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    post.mockReset()
    store.isLogin = true
  })

  it('hides the action for owners and non-forkable sources', async () => {
    expect((await mountButton({ isOwner: true })).find('button').exists()).toBe(false)
    expect((await mountButton({ canFork: false })).find('button').exists()).toBe(false)
  })

  it('preserves the source route through anonymous login', async () => {
    store.isLogin = false
    const wrapper = await mountButton()
    await wrapper.get('button').trigger('click')
    expect(login).toHaveBeenCalledWith({ redirect: 'https://r.slax.com/b/source-uuid?highlight=mark' })
    expect(post).not.toHaveBeenCalled()
  })

  it('disables the action while saving and opens the returned private snapshot', async () => {
    let resolve!: (value: unknown) => void
    post.mockReturnValue(new Promise(value => { resolve = value }))
    const wrapper = await mountButton()
    await wrapper.get('button').trigger('click')
    expect(wrapper.get('button').attributes('disabled')).toBeDefined()
    expect(wrapper.get('button').attributes('aria-busy')).toBe('true')
    resolve({ bookmark_uid: 'destination-uuid', write_mode: 'created', fork_info: null })
    await flushPromises()
    expect(clearData).toHaveBeenCalledWith('content-destination-uuid')
    expect(clearData.mock.invocationCallOrder[0]).toBeLessThan(navigate.mock.invocationCallOrder[0]!)
    expect(navigate).toHaveBeenCalledWith('/b/destination-uuid')
  })

  it('announces an error and offers a retry with the same operation key', async () => {
    post.mockRejectedValueOnce(new Error('Network unavailable'))
      .mockResolvedValueOnce({ bookmark_uid: 'destination-uuid', write_mode: 'overwritten', fork_info: null })
    const wrapper = await mountButton()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(wrapper.get('[role="alert"]').text()).toContain('Try again')
    expect(wrapper.get('button').attributes('disabled')).toBeUndefined()
    await wrapper.get('button').trigger('click')
    await flushPromises()
    expect(post.mock.calls[1]?.[0]?.headers).toEqual(post.mock.calls[0]?.[0]?.headers)
    expect(navigate).toHaveBeenCalledWith('/b/destination-uuid')
  })
})
