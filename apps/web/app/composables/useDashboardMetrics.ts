import {
  buildDashboardMetricsDailyQuery,
  getDashboardMetricsDailyEndDay,
  getDashboardMetricsDailyPlatformValue,
  useDashboardMetricsDailySource
} from './useDashboardMetricsDailySource'
import type { DashboardMetricsQuery, OverallMetrics, PlatformMetric } from '@slax-reader/contracts/interface'
import { RESTMethodPath } from '@slax-reader/contracts/const'

const DEFAULT_QUERY: DashboardMetricsQuery = {
  start_time: '2026-01-01 00:00:00',
  end_time: '2027-01-01 00:00:00'
}

const PLATFORM_ORDER = ['web', 'ios', 'android', 'extension', 'desktop', 'unknown']
const PLATFORM_LABELS: Record<string, string> = {
  web: 'Web',
  ios: 'iOS',
  android: 'Android',
  extension: '扩展插件',
  desktop: 'Desktop',
  unknown: '未知'
}

type SummaryCard = {
  key: string
  title: string
  value: number
  displayValue?: string
  description?: string
}

const getOverallMetrics = async (query: DashboardMetricsQuery): Promise<OverallMetrics> => {
  const response = await request().post<OverallMetrics>({
    url: RESTMethodPath.DASHBOARD_METRICS_OVERALL,
    body: query
  })

  if (!response) {
    throw new Error('Dashboard overall metrics are unavailable.')
  }

  return response
}

const getPlatformMetrics = async (query: DashboardMetricsQuery): Promise<PlatformMetric[]> => {
  const response = await request().post<PlatformMetric[]>({
    url: RESTMethodPath.DASHBOARD_METRICS_PLATFORM,
    body: query
  })

  if (!response) {
    throw new Error('Dashboard platform metrics are unavailable.')
  }

  return response
}

const normalizePlatform = (platform: string | null) => {
  return platform || 'unknown'
}

export const useDashboardMetrics = () => {
  const query = ref<DashboardMetricsQuery>({ ...DEFAULT_QUERY })
  const loading = ref(true)
  const errorMessage = ref('')
  const overallMetrics = ref<OverallMetrics | null>(null)
  const platformMetrics = ref<PlatformMetric[]>([])
  const { dailyRecords, loading: dailyLoading, errorMessage: dailyErrorMessage, load: loadDailyMetrics } = useDashboardMetricsDailySource()

  const totalActiveUsers = computed(() => {
    return platformMetrics.value.reduce((sum, item) => sum + item.active_users, 0)
  })

  const totalNewUsers = computed(() => {
    return platformMetrics.value.reduce((sum, item) => sum + item.new_users, 0)
  })

  const maxActiveUsers = computed(() => {
    return Math.max(...platformMetrics.value.map(item => item.active_users), 0)
  })

  const orderedPlatformMetrics = computed(() => {
    return [...platformMetrics.value].sort((left, right) => {
      const leftIndex = PLATFORM_ORDER.indexOf(normalizePlatform(left.platform))
      const rightIndex = PLATFORM_ORDER.indexOf(normalizePlatform(right.platform))
      return (leftIndex === -1 ? PLATFORM_ORDER.length : leftIndex) - (rightIndex === -1 ? PLATFORM_ORDER.length : rightIndex)
    })
  })

  const platformChartItems = computed(() => {
    const maxValue = maxActiveUsers.value || 1
    const total = totalActiveUsers.value || 1

    return orderedPlatformMetrics.value.map(item => {
      const key = normalizePlatform(item.platform)
      return {
        key,
        label: PLATFORM_LABELS[key] ?? '未知',
        newUsers: item.new_users,
        activeUsers: item.active_users,
        newUsersPercent: Math.max((item.new_users / maxValue) * 100, 4),
        activeUsersPercent: Math.max((item.active_users / maxValue) * 100, 6),
        activeShare: item.active_users / total
      }
    })
  })

  const topPlatform = computed(() => {
    return [...platformChartItems.value].sort((left, right) => right.activeUsers - left.activeUsers)[0] || null
  })

  const summaryCards = computed<SummaryCard[]>(() => {
    if (!overallMetrics.value) {
      return []
    }

    return [
      { key: 'active_users', title: '活跃用户数', value: overallMetrics.value.active_users },
      { key: 'new_users', title: '新用户数', value: totalNewUsers.value },
      { key: 'activated_users', title: '新用户激活数', value: overallMetrics.value.activated_users },
      { key: 'new_bookmarks', title: '新增书签数', value: overallMetrics.value.new_bookmarks },
      { key: 'bookmark_users', title: '新增书签用户数', value: overallMetrics.value.bookmark_users },
      { key: 'archive_users', title: '归档书签用户数', value: overallMetrics.value.archive_users },
      {
        key: 'ai_power_users',
        title: 'AI 用户数',
        value: overallMetrics.value.ai_power_users,
        displayValue: `${overallMetrics.value.ai_power_users} / ${overallMetrics.value.overview_users} / ${overallMetrics.value.summary_users}`,
        description:
          '当日使用了 AI 功能的用户数，这三个细分指标按顺序分别是：\n· Chat：当日对话轮数 ≥ 2 的用户数。\n· Overview：当日使用该功能次数 ≥ 1 的用户数。\n· Outline：当日使用该功能次数 ≥ 1 的用户数。'
      },
      { key: 'new_subscriptions', title: '新增 Pro 订阅用户数', value: overallMetrics.value.new_subscriptions }
    ]
  })

  const applyDailySnapshot = (dailyQuery: DashboardMetricsQuery) => {
    const records = dailyRecords.value
    if (!records.length) {
      return false
    }

    const expectedDay = getDashboardMetricsDailyEndDay(dailyQuery)
    const latest = records[records.length - 1]
    if (!latest || latest.day !== expectedDay) {
      return false
    }

    overallMetrics.value = {
      active_users: latest.active_users,
      new_bookmarks: latest.new_bookmarks,
      bookmark_users: latest.bookmark_users,
      new_subscriptions: latest.new_subscriptions,
      archive_users: latest.archive_users,
      activated_users: latest.activated_users,
      ai_power_users: latest.ai_power_users,
      overview_users: latest.overview_users ?? 0,
      summary_users: latest.summary_users ?? 0
    }

    platformMetrics.value = [
      { platform: 'web', new_users: getDashboardMetricsDailyPlatformValue(latest, 'web', 'new'), active_users: getDashboardMetricsDailyPlatformValue(latest, 'web', 'active') },
      { platform: 'ios', new_users: getDashboardMetricsDailyPlatformValue(latest, 'ios', 'new'), active_users: getDashboardMetricsDailyPlatformValue(latest, 'ios', 'active') },
      {
        platform: 'android',
        new_users: getDashboardMetricsDailyPlatformValue(latest, 'android', 'new'),
        active_users: getDashboardMetricsDailyPlatformValue(latest, 'android', 'active')
      },
      {
        platform: 'extension',
        new_users: getDashboardMetricsDailyPlatformValue(latest, 'extension', 'new'),
        active_users: getDashboardMetricsDailyPlatformValue(latest, 'extension', 'active')
      }
    ]

    return true
  }

  const applyFallbackMetrics = async () => {
    const [overall, platform] = await Promise.all([getOverallMetrics(query.value), getPlatformMetrics(query.value)])
    overallMetrics.value = overall
    platformMetrics.value = platform
  }

  const load = async () => {
    loading.value = true
    errorMessage.value = ''

    try {
      const dailyQuery = buildDashboardMetricsDailyQuery(1, new Date())
      await loadDailyMetrics(dailyQuery)
      const didUseDailySnapshot = applyDailySnapshot(dailyQuery)

      if (!didUseDailySnapshot) {
        await applyFallbackMetrics()
      }
    } catch (error) {
      try {
        await applyFallbackMetrics()
      } catch (fallbackError) {
        errorMessage.value = dailyErrorMessage.value || `${fallbackError || error}`
      }
    } finally {
      loading.value = loading.value || dailyLoading.value
      loading.value = false
    }
  }

  return {
    query,
    loading,
    errorMessage,
    overallMetrics,
    platformMetrics,
    summaryCards,
    platformChartItems,
    topPlatform,
    totalActiveUsers,
    totalNewUsers,
    load
  }
}
