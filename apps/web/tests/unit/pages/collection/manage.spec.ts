import CollectionManagePage from '~~/app/pages/collection/manage.vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  navigateTo: vi.fn(),
  useHead: vi.fn(),
  copyText: vi.fn(() => Promise.resolve()),
  toastShow: vi.fn(),
  refresh: vi.fn(),
  apply: vi.fn(),
  sharedInfo: { value: null as Record<string, unknown> | null },
  sharedLoaded: { value: false },
  route: { query: { from: 'starred' } as Record<string, string> }
}))

mocks.apply.mockImplementation((patch: Record<string, unknown>, base: Record<string, unknown> | null = mocks.sharedInfo.value) => {
  if (base) mocks.sharedInfo.value = { ...base, ...patch }
  mocks.sharedLoaded.value = true
})

mockNuxtImport('request', () => () => ({ get: mocks.get, post: mocks.post }))
mockNuxtImport('navigateTo', () => mocks.navigateTo)
mockNuxtImport('useRoute', () => () => mocks.route)
mockNuxtImport('useHead', () => mocks.useHead)
vi.mock('@commons/frontend-utils/string', () => ({ copyText: mocks.copyText }))
vi.mock('~/components/Toast', () => ({
  default: { showToast: mocks.toastShow },
  ToastType: { Normal: 'normal', Success: 'success', Error: 'error' }
}))
vi.mock('~/stores/user', () => ({
  useUserStore: () => ({ userInfo: { userId: 7, name: 'Alex' } })
}))
vi.mock('~/composables/useShareCollectInfo', () => ({
  useShareCollectInfo: () => ({
    info: mocks.sharedInfo,
    loaded: mocks.sharedLoaded,
    ensure: vi.fn(),
    refresh: mocks.refresh,
    apply: mocks.apply
  })
}))

const ownerInfo = (overrides: Record<string, unknown> = {}) => ({
  show_name: 'Alex Picks',
  description: 'Great reads',
  starred_count: 4,
  subscriber_count: 12,
  collection_code: 'CODE123',
  status: 1,
  show_marks: true,
  allow_marks: true,
  show_profile: true,
  avatar: '',
  ...overrides
})

const stubs = {
  ThemeSwitcher: true,
  NuxtLoadingIndicator: true,
  ClientOnly: { template: '<div><slot /></div>' },
  Teleport: { template: '<div><slot /></div>' }
}

const mountPage = async () => {
  const wrapper = mountWithApp(CollectionManagePage, { global: { stubs } })
  await flushPromises()
  return wrapper
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.route.query = { from: 'starred' }
  mocks.copyText.mockResolvedValue(undefined)
  mocks.get.mockResolvedValue(ownerInfo())
  mocks.post.mockResolvedValue({ status: 0, collection_code: 'CODE123' })
  mocks.refresh.mockResolvedValue(ownerInfo())
  mocks.sharedInfo.value = ownerInfo()
  mocks.sharedLoaded.value = true
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('pages/collection/manage', () => {
  it('opens directly from the guaranteed owner contract without redirecting', async () => {
    const wrapper = await mountPage()

    expect(mocks.get).toHaveBeenCalledWith({ url: '/v1/collection/mine' })
    expect(mocks.navigateTo).not.toHaveBeenCalled()
    expect(wrapper.find('.cm-title').text()).toBe('Manage collection')
    expect((wrapper.find('#cm-name').element as HTMLInputElement).value).toBe('Alex Picks')
    expect((wrapper.find('#cm-desc').element as HTMLTextAreaElement).value).toBe('Great reads')
    expect(wrapper.find('.cm-link-value-text').text()).toContain('/c/CODE123')
  })

  it('does not redirect when the response has no code; it still renders the management surface', async () => {
    mocks.get.mockResolvedValueOnce(ownerInfo({ collection_code: '' }))
    const wrapper = await mountPage()

    expect(mocks.navigateTo).not.toHaveBeenCalled()
    expect(wrapper.find('.cm-title').exists()).toBe(true)
    expect(wrapper.find('.cm-link-value-text').text()).toContain('/c/')
    expect((wrapper.find('.cm-link-copy').element as HTMLButtonElement).disabled).toBe(true)
  })

  it('edits name and description and keeps the stable URL', async () => {
    mocks.post.mockResolvedValueOnce({ ok: true })
    const wrapper = await mountPage()

    await wrapper.find('#cm-name').setValue('  New name  ')
    await wrapper.find('#cm-desc').setValue('  New description  ')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith({
      url: '/v1/collection/setting',
      body: { name: 'New name', description: 'New description' }
    })
    expect(wrapper.find('.cm-link-value-text').text()).toContain('/c/CODE123')
    expect(mocks.sharedInfo.value?.show_name).toBe('New name')
    expect(mocks.sharedInfo.value?.description).toBe('New description')
    expect(mocks.sharedLoaded.value).toBe(true)
    expect(mocks.refresh).not.toHaveBeenCalled()
    expect(mocks.toastShow).toHaveBeenCalledWith({ text: 'Changes saved' })
  })

  it('falls back to the default name when the name field is blank', async () => {
    mocks.post.mockResolvedValueOnce({ ok: true })
    const wrapper = await mountPage()

    await wrapper.find('#cm-name').setValue('   ')
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith(expect.objectContaining({ body: expect.objectContaining({ name: "Alex's Reading Recommendations" }) }))
  })

  it('closes and reopens explicitly while keeping the same public address', async () => {
    mocks.post.mockResolvedValueOnce({ status: 0, collection_code: 'CODE123' })
    const wrapper = await mountPage()
    const urlBefore = wrapper.find('.cm-link-value-text').text()

    await wrapper.find('.cm-danger-text-btn').trigger('click')
    await wrapper.find('.cm-modal-btn-danger').trigger('click')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith({ url: '/v1/user/setting/disable', body: { key: 'share_collect' } })
    expect(wrapper.find('.cm-status-pill').classes()).toContain('is-off')
    expect(wrapper.find('.cm-link-value-text').text()).toBe(urlBefore)

    mocks.post.mockResolvedValueOnce({ status: 1, collection_code: 'CODE123' })
    await wrapper.find('.cm-reopen-btn').trigger('click')
    await flushPromises()

    expect(mocks.post).toHaveBeenCalledWith({ url: '/v1/user/setting/enable', body: { key: 'share_collect' } })
    expect(wrapper.find('.cm-status-pill').classes()).not.toContain('is-off')
    expect(wrapper.find('.cm-link-value-text').text()).toBe(urlBefore)
  })

  it('syncs the shared starred-page cache after closing and reopening', async () => {
    mocks.post.mockResolvedValueOnce({ status: 0, collection_code: 'CODE123' })
    // Close: /mine refresh fails, so the server response must still update the shared visibility.
    mocks.refresh.mockResolvedValueOnce(null)
    const wrapper = await mountPage()

    await wrapper.find('.cm-danger-text-btn').trigger('click')
    await wrapper.find('.cm-modal-btn-danger').trigger('click')
    await flushPromises()

    expect(mocks.refresh).toHaveBeenCalledTimes(1)
    expect(mocks.sharedInfo.value?.status).toBe(0)
    expect(mocks.sharedLoaded.value).toBe(true)

    mocks.post.mockResolvedValueOnce({ status: 1, collection_code: 'CODE123' })
    // Reopen: even a stale pre-toggle /mine response cannot keep the shared entry closed.
    mocks.refresh.mockResolvedValueOnce(ownerInfo({ status: 0 }))
    await wrapper.find('.cm-reopen-btn').trigger('click')
    await flushPromises()

    expect(mocks.refresh).toHaveBeenCalledTimes(2)
    expect(mocks.sharedInfo.value?.status).toBe(1)
    expect(mocks.sharedLoaded.value).toBe(true)
  })

  it('uses public/closed wording instead of an initial enablement flow', async () => {
    mocks.get.mockResolvedValueOnce(ownerInfo({ status: 0 }))
    const wrapper = await mountPage()

    expect(wrapper.find('.cm-status-pill').text()).toBe('Closed')
    expect(wrapper.find('.cm-reopen-btn').text()).toBe('Make public again')
    expect(wrapper.text()).not.toContain('Enable collection')
    expect(wrapper.text()).not.toContain('Set up')
  })
})
