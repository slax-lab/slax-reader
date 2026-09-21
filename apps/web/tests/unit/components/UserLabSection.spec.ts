// UserLabSection 组件单测
// 挂载时 GET /v1/user/labs；空列表不渲染整张卡；没有文案的 key 跳过；
// graduated 行开关禁用且显示为开；点击开关 → POST setting/enable|disable，失败回滚 + toast
import UserLabSection from '~~/app/components/UserLabSection.vue'

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

// 工厂而不是常量：组件会通过响应式代理改到原对象，常量会把上一个用例的开关状态带进下一个
const youtube = () => ({ key: 'youtube', status: 'active', enabled: false, enabled_at: null })

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
  })

  afterEach(() => {
    document.body.innerHTML = ''
  })

  it('挂载时请求 /v1/user/labs', async () => {
    await mountSection([])
    expect(mockGet).toHaveBeenCalledWith({ url: '/v1/user/labs' })
  })

  it('列表为空 → 整张卡不渲染', async () => {
    const wrapper = await mountSection([])
    expect(wrapper.find('.settings-card').exists()).toBe(false)
  })

  it('渲染标题、说明和功能行；没有文案的 key 跳过', async () => {
    const wrapper = await mountSection([youtube(), { key: 'no_such_feature', status: 'active', enabled: true, enabled_at: null }])
    expect(wrapper.find('#labs.settings-card').exists()).toBe(true)
    expect(wrapper.find('.title').text()).toBe('Labs')
    expect(wrapper.find('.intro').text()).toContain('still rough')
    const rows = wrapper.findAll('.lab-row')
    expect(rows.length).toBe(1)
    expect(rows[0]!.find('.lab-name span').text()).toBe('YouTube videos')
    expect(rows[0]!.find('.lab-pill').text()).toBe('In Labs')
    expect(rows[0]!.find('.lab-desc').text()).toContain('transcript')
    expect(rows[0]!.find('.switch-toggle').classes()).not.toContain('on')
  })

  it('graduated → 标签“已正式发布”，开关禁用并显示为开', async () => {
    const wrapper = await mountSection([{ ...youtube(), status: 'graduated', enabled: true }])
    const row = wrapper.find('.lab-row')
    expect(row.find('.lab-pill').text()).toBe('Released')
    const toggle = row.find('.switch-toggle')
    expect(toggle.classes()).toContain('on')
    expect(toggle.attributes('disabled')).toBeDefined()
    await toggle.trigger('click')
    expect(mockPost).not.toHaveBeenCalled()
  })

  it('点击开关 → 乐观置开 + POST /v1/user/setting/enable { key: lab:youtube }', async () => {
    const wrapper = await mountSection([youtube()])
    await wrapper.find('.switch-toggle').trigger('click')
    expect(wrapper.find('.switch-toggle').classes()).toContain('on')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith({ url: '/v1/user/setting/enable', body: { key: 'lab:youtube' } })
    expect(wrapper.find('.switch-toggle').classes()).toContain('on')
  })

  it('已开的功能点击 → POST /v1/user/setting/disable', async () => {
    const wrapper = await mountSection([{ ...youtube(), enabled: true, enabled_at: '2026-09-08T00:00:00.000Z' }])
    await wrapper.find('.switch-toggle').trigger('click')
    await flushPromises()
    expect(mockPost).toHaveBeenCalledWith({ url: '/v1/user/setting/disable', body: { key: 'lab:youtube' } })
    expect(wrapper.find('.switch-toggle').classes()).not.toContain('on')
  })

  it('请求失败 → 回滚开关 + toast operate_failed', async () => {
    mockPost.mockRejectedValue(new Error('500'))
    const wrapper = await mountSection([youtube()])
    await wrapper.find('.switch-toggle').trigger('click')
    await flushPromises()
    expect(mockToastShowToast).toHaveBeenCalledWith(expect.objectContaining({ text: 'Operation failed', type: 'error' }))
    expect(mockPost).toHaveBeenCalledTimes(1)
    expect(wrapper.find('.switch-toggle').classes()).not.toContain('on')
  })
})
