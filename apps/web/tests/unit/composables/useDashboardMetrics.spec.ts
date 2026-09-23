// useDashboardMetrics 单元测试
// 覆盖：load() 成功路径（daily snapshot 命中）+ daily endpoint 抛错降级 + 降级也失败时 errorMessage 设置
//
// request() 是 Nuxt auto-import，用 mockNuxtImport('request', ...) 拦截。
// useDashboardMetricsDailySource 内部用 useState 缓存 queryKey，
// beforeEach 必须 clearNuxtState 清 5 个 key，否则缓存命中跳过 request 调用造成假阳性。
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { clearNuxtState } from '#app'
import { beforeEach, describe, expect, it, vi } from 'vitest'

// 5 个 useState key（来自 useDashboardMetricsDailySource）
const DAILY_STATE_KEYS = [
  'dashboard-metrics-daily-records',
  'dashboard-metrics-daily-query',
  'dashboard-metrics-daily-loading',
  'dashboard-metrics-daily-error',
  'dashboard-metrics-daily-query-key'
]

const { mockPost, mockRequest } = vi.hoisted(() => {
  const post = vi.fn()
  return {
    mockPost: post,
    mockRequest: vi.fn(() => ({
      post,
      get: vi.fn(),
      put: vi.fn(),
      delete: vi.fn(),
      stream: vi.fn(),
      upgrade: vi.fn(),
      uploadFile: vi.fn()
    }))
  }
})

mockNuxtImport('request', () => mockRequest)

// 最小有效 DashboardMetricsDailyItem（匹配真实 DTO 形状，让 normalizeDailyMetric 不崩）
const makeDailyItem = (day: string) => ({
  day,
  new_users_ios: 1,
  new_users_android: 2,
  new_users_web: 3,
  new_users_extension: 0,
  active_users: 10,
  active_users_ios: 4,
  active_users_android: 2,
  active_users_web: 3,
  active_users_extension: 1,
  new_bookmarks: 5,
  bookmark_users: 4,
  new_subscriptions: 1,
  archive_users: 2,
  activated_users: 3,
  ai_power_users: 2,
  overview_users: 1,
  summary_users: 1
})

const makeOverallMetrics = () => ({
  new_bookmarks: 100,
  bookmark_users: 80,
  new_subscriptions: 10,
  archive_users: 20,
  activated_users: 30,
  ai_power_users: 15,
  overview_users: 50,
  summary_users: 40
})

const makePlatformMetrics = () => [
  { platform: 'web', new_users: 50, active_users: 200 },
  { platform: 'ios', new_users: 30, active_users: 150 }
]

describe('useDashboardMetrics', () => {
  beforeEach(() => {
    mockPost.mockReset()
    mockRequest.mockClear()
    clearNuxtState(DAILY_STATE_KEYS)
  })

  it('load() 成功路径：daily snapshot 命中，覆盖 overallMetrics 与 platformMetrics', async () => {
    // daily endpoint 返回包含今天日期的记录，applyDailySnapshot 会命中
    const today = new Date()
    const pad = (n: number) => `${n}`.padStart(2, '0')
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`

    mockPost.mockResolvedValue([makeDailyItem(todayStr)])

    const { useDashboardMetrics } = await import('~~/app/composables/useDashboardMetrics')
    const metrics = useDashboardMetrics()

    await metrics.load()

    expect(metrics.loading.value).toBe(false)
    expect(metrics.errorMessage.value).toBe('')
    expect(metrics.overallMetrics.value).not.toBeNull()
    expect(metrics.platformMetrics.value.length).toBeGreaterThan(0)
  })

  it('load() daily endpoint 抛错时降级 fallback（overall + platform endpoints 成功），不抛未处理异常', async () => {
    // daily 失败，fallback 成功
    mockPost.mockRejectedValueOnce(new Error('daily unavailable')).mockResolvedValueOnce(makeOverallMetrics()).mockResolvedValueOnce(makePlatformMetrics())

    const { useDashboardMetrics } = await import('~~/app/composables/useDashboardMetrics')
    const metrics = useDashboardMetrics()

    await expect(metrics.load()).resolves.not.toThrow()
    expect(metrics.loading.value).toBe(false)
    expect(metrics.overallMetrics.value?.new_bookmarks).toBe(100)
    expect(metrics.platformMetrics.value.length).toBe(2)
  })

  it('load() daily + fallback 全失败时，errorMessage 非空且 loading 置 false', async () => {
    mockPost.mockRejectedValue(new Error('all endpoints down'))

    const { useDashboardMetrics } = await import('~~/app/composables/useDashboardMetrics')
    const metrics = useDashboardMetrics()

    await metrics.load()

    expect(metrics.loading.value).toBe(false)
    expect(metrics.errorMessage.value).not.toBe('')
  })

  it('summaryCards 在 overallMetrics 为 null 时返回空数组', async () => {
    // daily 返回空数组 → applyDailySnapshot 返回 false → fallback
    // fallback overall 返 null → getOverallMetrics 抛 Error → errorMessage 非空
    mockPost.mockResolvedValueOnce([]) // daily: empty, snapshot fails
    mockPost.mockResolvedValueOnce(null) // overall: null → throws inside getOverallMetrics
    mockPost.mockResolvedValueOnce(makePlatformMetrics()) // platform fallback

    const { useDashboardMetrics } = await import('~~/app/composables/useDashboardMetrics')
    const metrics = useDashboardMetrics()

    await metrics.load()

    // overallMetrics is null → summaryCards should be empty
    expect(metrics.summaryCards.value).toEqual([])
  })

  it('summaryCards 在 overallMetrics 有值时返回 8 个卡片', async () => {
    const today = new Date()
    const pad = (n: number) => `${n}`.padStart(2, '0')
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    mockPost
      .mockResolvedValueOnce([makeDailyItem(todayStr)])
      .mockResolvedValueOnce(makeOverallMetrics())
      .mockResolvedValueOnce(makePlatformMetrics())

    const { useDashboardMetrics } = await import('~~/app/composables/useDashboardMetrics')
    const metrics = useDashboardMetrics()
    await metrics.load()

    expect(metrics.summaryCards.value.length).toBe(8)
    expect(metrics.summaryCards.value[0]!.key).toBe('active_users')
    expect(metrics.summaryCards.value[6]!.key).toBe('ai_power_users')
    // ai_power_users displayValue 格式："{ai} / {overview} / {summary}"
    expect(metrics.summaryCards.value[6]!.displayValue).toContain(' / ')
  })

  it('totalActiveUsers 是 platformMetrics active_users 之和（daily snapshot 命中时来自 daily item）', async () => {
    const today = new Date()
    const pad = (n: number) => `${n}`.padStart(2, '0')
    const todayStr = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`
    mockPost
      .mockResolvedValueOnce([makeDailyItem(todayStr)])
      .mockResolvedValueOnce(makeOverallMetrics())
      .mockResolvedValueOnce(makePlatformMetrics())

    const { useDashboardMetrics } = await import('~~/app/composables/useDashboardMetrics')
    const metrics = useDashboardMetrics()
    await metrics.load()

    // daily snapshot 命中时，platformMetrics 由 applyDailySnapshot 从 daily item 构建
    // makeDailyItem 的 active_users=10，totalActiveUsers = sum of platformMetrics.active_users
    // 实测值为 10（daily item active_users 直接映射）
    expect(metrics.summaryCards.value[0]!.value).toBe(10)
  })
})
