import { buildDashboardMetricsDailyQuery, fetchDashboardMetricsDaily, getDashboardMetricsDailyLabel } from './useDashboardMetricsDailySource'
import type { DashboardMetricsDailyItem, DashboardMetricsQuery } from '@commons/contracts/interface'

export type HistoryRangeKey = 7 | 30 | 90 | 365

export type HistorySeries = {
  key: string
  label: string
  color: string
  values: number[]
}

export type HistoryChart = {
  key: string
  eyebrow: string
  title: string
  description: string
  series: HistorySeries[]
}

export type HistoryRangeDataset = {
  days: number
  labels: string[]
  rawLabels: string[]
  charts: HistoryChart[]
}

const ACTIVE_PLATFORM_SERIES = [
  { key: 'web', label: 'Web', color: '#16b998', value: (item: DashboardMetricsDailyItem) => item.active_users_web },
  { key: 'ios', label: 'iOS', color: '#4f8cff', value: (item: DashboardMetricsDailyItem) => item.active_users_ios },
  { key: 'android', label: 'Android', color: '#f0b457', value: (item: DashboardMetricsDailyItem) => item.active_users_android },
  { key: 'extension', label: '扩展插件', color: '#111827', value: (item: DashboardMetricsDailyItem) => item.active_users_extension }
] as const

const NEW_PLATFORM_SERIES = [
  { key: 'web', label: 'Web', color: '#16b998', value: (item: DashboardMetricsDailyItem) => item.new_users_web },
  { key: 'ios', label: 'iOS', color: '#4f8cff', value: (item: DashboardMetricsDailyItem) => item.new_users_ios },
  { key: 'android', label: 'Android', color: '#f0b457', value: (item: DashboardMetricsDailyItem) => item.new_users_android }
] as const

const SUBSCRIPTION_SOURCE_SERIES = [
  { key: 'stripe', label: 'Stripe', color: '#635bff', value: (item: DashboardMetricsDailyItem) => item.new_subscriptions_stripe ?? 0 },
  { key: 'apple_iap', label: 'Apple IAP', color: '#111827', value: (item: DashboardMetricsDailyItem) => item.new_subscriptions_apple_iap ?? 0 },
  { key: 'trial', label: 'Free Trial', color: '#16b998', value: (item: DashboardMetricsDailyItem) => item.new_subscriptions_trial ?? 0 },
  { key: 'blogger_trial', label: 'Blogger', color: '#f0b457', value: (item: DashboardMetricsDailyItem) => item.new_subscriptions_blogger_trial ?? 0 }
] as const

const createSeries = (
  items: DashboardMetricsDailyItem[],
  configs: ReadonlyArray<{
    key: string
    label: string
    color: string
    value: (item: DashboardMetricsDailyItem) => number
  }>
) => {
  return configs.map(config => ({
    key: config.key,
    label: config.label,
    color: config.color,
    values: items.map(item => config.value(item))
  }))
}

const createSeriesWithTotal = (
  items: DashboardMetricsDailyItem[],
  configs: ReadonlyArray<{
    key: string
    label: string
    color: string
    value: (item: DashboardMetricsDailyItem) => number
  }>,
  totalValue?: (item: DashboardMetricsDailyItem) => number
): HistorySeries[] => {
  const base = createSeries(items, configs)
  const total: HistorySeries = {
    key: 'total',
    label: '总数',
    color: '#667085',
    values: items.map(item => (totalValue ? totalValue(item) : configs.reduce((sum, config) => sum + config.value(item), 0)))
  }
  return [total, ...base]
}

const createSingleSeries = (
  items: DashboardMetricsDailyItem[],
  options: {
    key: string
    label: string
    color: string
    value: (item: DashboardMetricsDailyItem) => number
  }
): HistorySeries[] => {
  return [
    {
      key: options.key,
      label: options.label,
      color: options.color,
      values: items.map(item => options.value(item))
    }
  ]
}

const buildDataset = (items: DashboardMetricsDailyItem[], days: number): HistoryRangeDataset => {
  if (!items.length) {
    return { days, labels: [], rawLabels: [], charts: [] }
  }

  const labels = items.map(item => getDashboardMetricsDailyLabel(item.day, days))
  const rawLabels = items.map(item => item.day)

  const charts: HistoryChart[] = [
    {
      key: 'active-users-platform',
      eyebrow: '增长',
      title: '活跃用户数',
      description: '当日至少有过一次以下行为的用户数：打开或刷新 Web 客户端，或将 App 切换到前台（即有"心跳"上报），按平台细分展示。',
      series: createSeriesWithTotal(items, ACTIVE_PLATFORM_SERIES, item => item.active_users)
    },
    {
      key: 'new-users-platform',
      eyebrow: '获客',
      title: '新用户数',
      description: '当日完成注册的新用户数，按平台细分展示。',
      series: createSeriesWithTotal(items, NEW_PLATFORM_SERIES)
    },
    {
      key: 'activated-users',
      eyebrow: '质量',
      title: '新用户激活数',
      description: '在注册后 24 小时内完成首次收藏的用户数，按收藏时间统计。',
      series: createSingleSeries(items, { key: 'activated-users', label: '新用户激活数', color: '#06b6d4', value: item => item.activated_users })
    },
    {
      key: 'new-bookmarks',
      eyebrow: '深度使用',
      title: '新增书签数',
      description: '当日用户新收藏的书签总数。',
      series: createSingleSeries(items, { key: 'new-bookmarks', label: '新增书签数', color: '#8b5cf6', value: item => item.new_bookmarks })
    },
    {
      key: 'bookmark-users',
      eyebrow: '深度使用',
      title: '新增书签用户数',
      description: '当日至少新增 1 个书签的用户数。',
      series: createSingleSeries(items, { key: 'bookmark-users', label: '新增书签用户数', color: '#111827', value: item => item.bookmark_users })
    },
    {
      key: 'archive-users',
      eyebrow: '质量',
      title: '归档书签用户数',
      description: '当日至少将 1 个书签归档的用户数。',
      series: createSingleSeries(items, { key: 'archive-users', label: '归档书签用户数', color: '#ec4899', value: item => item.archive_users })
    },
    {
      key: 'ai-power-users',
      eyebrow: 'AI',
      title: 'AI 用户数',
      description:
        '当日使用了 AI 功能的用户数，这三个细分指标按顺序分别是：\n· Chat：当日对话轮数 ≥ 2 的用户数。\n· Overview：当日使用该功能次数 ≥ 1 的用户数。\n· Outline：当日使用该功能次数 ≥ 1 的用户数。',
      series: createSeries(items, [
        { key: 'ai-chat', label: 'Chat', color: '#7c3aed', value: item => item.ai_power_users },
        { key: 'ai-overview', label: 'Overview', color: '#0ea5e9', value: item => item.overview_users ?? 0 },
        { key: 'ai-summary', label: 'Outline', color: '#f59e0b', value: item => item.summary_users ?? 0 }
      ])
    },
    {
      key: 'new-subscriptions',
      eyebrow: '互动',
      title: '新增 Pro 订阅用户数',
      description:
        '当日完成 Pro 订阅（含首次订阅、过期后恢复订阅）的用户数，不含退款，按来源细分展示。总数为非失败订阅合计（历史数据无来源细分，仅有总数）。注：订阅≠支付，比如 iOS 用户在订阅的次月才会扣款。',
      series: createSeriesWithTotal(items, SUBSCRIPTION_SOURCE_SERIES, item => item.new_subscriptions)
    },
    {
      key: 'subscription-failed',
      eyebrow: '互动',
      title: 'Stripe支付失败',
      description: '当日 Stripe 扣款失败的次数（charge.failed 回调）。可用于观察续费流失风险。',
      series: createSingleSeries(items, {
        key: 'subscription-failed',
        label: '续费失败次数',
        color: '#ef4444',
        value: item => item.subscription_failed ?? 0
      })
    }
  ]

  return { days, labels, rawLabels, charts }
}

const getToday = (): Date => {
  const d = new Date()
  d.setHours(23, 59, 59, 0)
  return d
}

export const useHistoryMetrics = () => {
  const selectedRange = ref<HistoryRangeKey>(7)
  const activeMode = ref<'preset' | 'custom'>('preset')
  const loading = ref(false)
  const errorMessage = ref('')

  // Per-range cache: once fetched, reused on range switch-back
  const rangeCache = ref<Partial<Record<HistoryRangeKey, HistoryRangeDataset>>>({})
  const customDataset = ref<HistoryRangeDataset | null>(null)

  const rangeOptions = computed(() => [
    { days: 7 as const, label: '7 天' },
    { days: 30 as const, label: '30 天' },
    { days: 90 as const, label: '90 天' },
    { days: 365 as const, label: '365 天' }
  ])

  const activeRange = computed<HistoryRangeDataset>(() => {
    if (activeMode.value === 'custom' && customDataset.value) {
      return customDataset.value
    }
    return rangeCache.value[selectedRange.value] ?? { days: selectedRange.value, labels: [], rawLabels: [], charts: [] }
  })

  const loadRange = async (days: HistoryRangeKey) => {
    if (rangeCache.value[days]) return

    loading.value = true
    errorMessage.value = ''

    try {
      const query = buildDashboardMetricsDailyQuery(days, getToday())
      const { data } = await fetchDashboardMetricsDaily(query)
      rangeCache.value = { ...rangeCache.value, [days]: buildDataset(data, days) }
    } catch (error) {
      errorMessage.value = `${error}`
    } finally {
      loading.value = false
    }
  }

  const loadCustomRange = async (startDate: string, endDate: string) => {
    const query: DashboardMetricsQuery = {
      start_time: `${startDate} 00:00:00`,
      end_time: `${endDate} 23:59:59`
    }
    const diffDays = Math.max(Math.round((new Date(endDate).getTime() - new Date(startDate).getTime()) / 86400000) + 1, 1)
    const { data } = await fetchDashboardMetricsDaily(query)
    customDataset.value = buildDataset(data, diffDays)
  }

  watch(selectedRange, days => {
    loadRange(days).catch(() => {})
  })

  return {
    rangeOptions,
    selectedRange,
    activeMode,
    activeRange,
    loading,
    errorMessage,
    loadRange,
    loadCustomRange
  }
}
