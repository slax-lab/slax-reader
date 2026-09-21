// DashboardClient 组件渲染单元测试
// 覆盖：加载态 / 错误态 / 数据态（summaryCards 展示）
//
// DashboardClient 依赖 useDashboardMetrics（auto-import），用 vi.hoisted + mockNuxtImport 提供假数据。
// 组件在 onMounted 调用 load()，需要 mockNuxtImport 确保 load 不实际发请求。
import { ref } from 'vue'

import { mountWithApp } from '../../../setup/mount'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// runtimeConfig: setupNuxt 路由 plugin 需要 app.baseURL
const runtimeConfig = {
  app: { baseURL: '/' },
  public: {}
}
mockNuxtImport('useRuntimeConfig', () => () => runtimeConfig)

// vi.hoisted 内只能用 vi.fn()，不能用 vue ref（会因为 hoisting 导致 TDZ 错误）
const { mockLoad } = vi.hoisted(() => ({
  mockLoad: vi.fn()
}))

// Refs 定义在模块作用域，mockNuxtImport 闭包捕获它们
const mockLoadingRef = ref(false)
const mockErrorRef = ref('')
const mockSummaryCardsRef = ref<Array<{ key: string; title: string; value: number; displayValue?: string; description?: string }>>([])

mockNuxtImport('useDashboardMetrics', () => () => ({
  loading: mockLoadingRef,
  errorMessage: mockErrorRef,
  summaryCards: mockSummaryCardsRef,
  load: mockLoad
}))

describe('DashboardClient', () => {
  beforeEach(() => {
    mockLoad.mockReset()
    mockLoadingRef.value = false
    mockErrorRef.value = ''
    mockSummaryCardsRef.value = []
  })

  it('加载态：显示 loading spinner', async () => {
    mockLoadingRef.value = true

    const DashboardClient = await import('~~/app/components/Dashboard/DashboardClient.vue')
    const wrapper = mountWithApp(DashboardClient.default)

    expect(wrapper.find('.dashboard-loading').exists()).toBe(true)
    expect(wrapper.find('.dashboard-loading__spinner').exists()).toBe(true)
    expect(wrapper.find('.dashboard-content').exists()).toBe(false)
  })

  it('错误态：显示错误信息和重试按钮', async () => {
    mockLoadingRef.value = false
    mockErrorRef.value = '网络请求失败'

    const DashboardClient = await import('~~/app/components/Dashboard/DashboardClient.vue')
    const wrapper = mountWithApp(DashboardClient.default)

    expect(wrapper.find('.dashboard-state--error').exists()).toBe(true)
    expect(wrapper.find('.dashboard-state--error').text()).toContain('网络请求失败')
    const retryBtn = wrapper.find('.dashboard-state--error button')
    expect(retryBtn.exists()).toBe(true)
    expect(retryBtn.text()).toBe('重试')
  })

  it('数据态（无 summaryCards）：不渲染 metrics-banner', async () => {
    mockLoadingRef.value = false
    mockErrorRef.value = ''
    mockSummaryCardsRef.value = []

    const DashboardClient = await import('~~/app/components/Dashboard/DashboardClient.vue')
    const wrapper = mountWithApp(DashboardClient.default)

    expect(wrapper.find('.dashboard-content').exists()).toBe(true)
    expect(wrapper.find('.metrics-banner').exists()).toBe(false)
  })

  it('数据态（有 summaryCards）：渲染 metrics-banner 和卡片列表', async () => {
    mockLoadingRef.value = false
    mockErrorRef.value = ''
    mockSummaryCardsRef.value = [
      { key: 'active_users', title: '活跃用户数', value: 1234 },
      { key: 'new_users', title: '新用户数', value: 56 }
    ]

    const DashboardClient = await import('~~/app/components/Dashboard/DashboardClient.vue')
    const wrapper = mountWithApp(DashboardClient.default)

    expect(wrapper.find('.metrics-banner').exists()).toBe(true)
    const items = wrapper.findAll('.metrics-banner__item')
    expect(items.length).toBe(2)
    expect(items[0]?.text()).toContain('活跃用户数')
    expect(items[1]?.text()).toContain('新用户数')
  })

  it('onMounted 调用 load()', async () => {
    const DashboardClient = await import('~~/app/components/Dashboard/DashboardClient.vue')
    mountWithApp(DashboardClient.default)

    expect(mockLoad).toHaveBeenCalledTimes(1)
  })

  it('点击重试按钮再次调用 load()', async () => {
    mockErrorRef.value = '出错了'

    const DashboardClient = await import('~~/app/components/Dashboard/DashboardClient.vue')
    const wrapper = mountWithApp(DashboardClient.default)

    const retryBtn = wrapper.find('.dashboard-state--error button')
    await retryBtn.trigger('click')

    // load 在 onMounted 调用一次 + 点击 retry 一次 = 2
    expect(mockLoad).toHaveBeenCalledTimes(2)
  })

  it('数据态（有 summaryCards）：渲染 label / value 文字内容', async () => {
    mockLoadingRef.value = false
    mockErrorRef.value = ''
    mockSummaryCardsRef.value = [
      { key: 'active_users', title: '活跃用户数', value: 100 },
      { key: 'new_users', title: '新用户数', value: 50, description: '当日新注册用户' }
    ]

    const DashboardClient = await import('~~/app/components/Dashboard/DashboardClient.vue')
    const wrapper = mountWithApp(DashboardClient.default)

    expect(wrapper.find('.metrics-banner').exists()).toBe(true)
    const items = wrapper.findAll('.metrics-banner__item')
    expect(items.length).toBe(2)
    expect(items[0]?.find('.metrics-banner__label').text()).toBe('活跃用户数')
    expect(items[0]?.find('.metrics-banner__value').text()).toBe('100')
  })

  it('summaryCard 有 description 时渲染 desc-btn', async () => {
    mockLoadingRef.value = false
    mockErrorRef.value = ''
    mockSummaryCardsRef.value = [{ key: 'ai_power_users', title: 'AI 用户数', value: 30, description: 'AI 功能使用说明', displayValue: '30 / 20 / 10' }]

    const DashboardClient = await import('~~/app/components/Dashboard/DashboardClient.vue')
    const wrapper = mountWithApp(DashboardClient.default)

    expect(wrapper.find('.metrics-banner__desc-btn').exists()).toBe(true)
  })

  it('summaryCard 有 displayValue 时渲染多值格式', async () => {
    mockLoadingRef.value = false
    mockErrorRef.value = ''
    mockSummaryCardsRef.value = [{ key: 'ai_power_users', title: 'AI 用户数', value: 30, displayValue: '30 / 20 / 10' }]

    const DashboardClient = await import('~~/app/components/Dashboard/DashboardClient.vue')
    const wrapper = mountWithApp(DashboardClient.default)

    const valueEl = wrapper.find('.metrics-banner__value')
    expect(valueEl.classes()).toContain('metrics-banner__value--multi')
    expect(valueEl.text()).toBe('30 / 20 / 10')
  })

  it('clicking desc-btn opens description bubble', async () => {
    mockLoadingRef.value = false
    mockErrorRef.value = ''
    mockSummaryCardsRef.value = [{ key: 'ai_power_users', title: 'AI 用户数', value: 30, description: 'AI 功能说明', displayValue: '30 / 20 / 10' }]

    const DashboardClient = await import('~~/app/components/Dashboard/DashboardClient.vue')
    const wrapper = mountWithApp(DashboardClient.default)

    const descBtn = wrapper.find('.metrics-banner__desc-btn')
    await descBtn.trigger('click')
    // toggleDescription is async (calls nextTick internally)
    await wrapper.vm.$nextTick()
    await wrapper.vm.$nextTick()

    // openDescriptionKey is set → activeDescription is non-empty → bubble renders
    const vm = wrapper.vm as any
    expect(vm.openDescriptionKey).toBe('ai_power_users')
  })

  it('clicking desc-btn again closes description bubble', async () => {
    mockLoadingRef.value = false
    mockErrorRef.value = ''
    mockSummaryCardsRef.value = [{ key: 'ai_power_users', title: 'AI 用户数', value: 30, description: 'AI 功能说明' }]

    const DashboardClient = await import('~~/app/components/Dashboard/DashboardClient.vue')
    const wrapper = mountWithApp(DashboardClient.default)

    const descBtn = wrapper.find('.metrics-banner__desc-btn')
    await descBtn.trigger('click')
    await wrapper.vm.$nextTick()
    const vm = wrapper.vm as any
    expect(vm.openDescriptionKey).toBe('ai_power_users')

    // Click again to toggle off
    await descBtn.trigger('click')
    await wrapper.vm.$nextTick()
    expect(vm.openDescriptionKey).toBeNull()
  })
})
