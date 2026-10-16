import UserLabSection from '~~/app/components/UserLabSection.vue'
import { useLabFeatures } from '~~/app/composables/useLabFeatures'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockGet, mockPost, mockRequest, mockToastShowToast } = vi.hoisted(() => {
  const mockGet = vi.fn()
  const mockPost = vi.fn()
  return {
    mockGet,
    mockPost,
    mockRequest: vi.fn(() => ({ get: mockGet, post: mockPost })),
    mockToastShowToast: vi.fn()
  }
})

mockNuxtImport('request', () => mockRequest)

vi.mock('~/components/Toast', () => ({
  default: { showToast: mockToastShowToast },
  ToastType: { Success: 'success', Error: 'error', Normal: 'normal' }
}))

const rss = () => ({ key: 'rss', status: 'active', enabled: false, enabled_at: null })
const hiddenFeatures = (enabled = false) => ['youtube'].map(key => ({ key, status: 'active', enabled, enabled_at: enabled ? '2026-09-08T00:00:00.000Z' : null }))

const mountSection = async (features: unknown[]) => {
  mockGet.mockResolvedValue({ features })
  const wrapper = mountWithApp(UserLabSection)
  await flushPromises()
  return wrapper
}

describe('UserLabSection', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPost.mockResolvedValue('ok')
    const labs = useLabFeatures()
    labs.features.value = []
    labs.loaded.value = false
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('loads /v1/user/labs on mount', async () => {
    await mountSection([])
    expect(mockGet).toHaveBeenCalledWith({ url: '/v1/user/labs' })
  })

  it.each([
    { name: 'empty', features: [] },
    { name: 'hidden-only', features: hiddenFeatures() },
    { name: 'untranslated-only', features: [{ ...rss(), key: 'no_such_feature' }] }
  ])('omits the entire card for $name responses', async ({ features }) => {
    const wrapper = await mountSection(features)
    expect(wrapper.find('.settings-card').exists()).toBe(false)
    expect(wrapper.find('button').exists()).toBe(false)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('renders RSS and omits hidden and untranslated features', async () => {
    const [youtube] = hiddenFeatures()
    const wrapper = await mountSection([youtube, rss(), { ...rss(), key: 'no_such_feature' }])
    expect(wrapper.find('#labs.settings-card').exists()).toBe(true)
    expect(wrapper.find('.title').text()).toBe('Labs')
    expect(wrapper.find('.intro').text()).toContain('still rough')
    const rows = wrapper.findAll('.lab-row')
    expect(rows).toHaveLength(1)
    expect(rows[0]!.find('.lab-name span').text()).toBe('RSS feeds')
    expect(rows[0]!.find('.lab-pill').text()).toBe('In Labs')
    expect(rows[0]!.find('.lab-desc').text()).toContain('Browse your feeds')
    expect(rows[0]!.find('.switch-toggle').classes()).not.toContain('on')
    expect(wrapper.text()).not.toContain('YouTube videos')
  })

  it('renders the PDF bookmarks row and toggles it', async () => {
    const wrapper = await mountSection([{ key: 'pdf', status: 'active', enabled: false, enabled_at: null }])
    const row = wrapper.find('.lab-row')
    expect(row.find('.lab-name span').text()).toBe('PDF bookmarks')
    await row.find('button').trigger('click')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith({ url: '/v1/user/setting/enable', body: { key: 'lab:pdf' } })
  })

  it.each([
    { status: 'active', enabled: false },
    { status: 'active', enabled: true },
    { status: 'graduated', enabled: true }
  ])('keeps $status hidden preferences intact when enabled=$enabled', async ({ status, enabled }) => {
    const features = hiddenFeatures(enabled).map(feature => ({ ...feature, status }))
    const original = structuredClone(features)
    const wrapper = await mountSection(features)
    const labs = useLabFeatures()
    expect(wrapper.find('.lab-row').exists()).toBe(false)
    expect(labs.features.value).toEqual(original)
    expect(labs.isEnabled('youtube')).toBe(enabled)
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('shows a released RSS feature enabled with a disabled toggle', async () => {
    const wrapper = await mountSection([{ ...rss(), status: 'graduated', enabled: true }])
    const row = wrapper.find('.lab-row')
    expect(row.find('.lab-pill').text()).toBe('Released')
    const toggle = row.find('.switch-toggle')
    expect(toggle.classes()).toContain('on')
    expect(toggle.attributes('disabled')).toBeDefined()
    await toggle.trigger('click')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('enables RSS without updating hidden preferences', async () => {
    const hidden = hiddenFeatures(true)
    const original = structuredClone(hidden)
    const wrapper = await mountSection([...hidden, rss()])
    await wrapper.find('.switch-toggle').trigger('click')
    expect(wrapper.find('.switch-toggle').classes()).toContain('on')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledExactlyOnceWith({ url: '/v1/user/setting/enable', body: { key: 'lab:rss' } })
    expect(wrapper.find('.switch-toggle').classes()).toContain('on')
    expect(useLabFeatures().features.value.filter(feature => feature.key !== 'rss')).toEqual(original)
  })

  it('disables an enabled RSS feature', async () => {
    const wrapper = await mountSection([{ ...rss(), enabled: true, enabled_at: '2026-09-08T00:00:00.000Z' }])
    await wrapper.find('.switch-toggle').trigger('click')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledExactlyOnceWith({ url: '/v1/user/setting/disable', body: { key: 'lab:rss' } })
    expect(wrapper.find('.switch-toggle').classes()).not.toContain('on')
  })

  it('rolls back a failed RSS toggle without changing hidden preferences', async () => {
    mockPost.mockRejectedValue(new Error('500'))
    const hidden = hiddenFeatures(true)
    const original = structuredClone(hidden)
    const wrapper = await mountSection([...hidden, rss()])
    await wrapper.find('.switch-toggle').trigger('click')
    await flushPromises()
    expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ text: 'Operation failed', type: 'error' }))
    expect(mockPost).toHaveBeenCalledExactlyOnceWith({ url: '/v1/user/setting/enable', body: { key: 'lab:rss' } })
    expect(wrapper.find('.switch-toggle').classes()).not.toContain('on')
    expect(useLabFeatures().features.value.filter(feature => feature.key !== 'rss')).toEqual(original)
  })
})
