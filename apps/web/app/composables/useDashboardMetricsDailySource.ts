import type { DashboardMetricsDailyItem, DashboardMetricsQuery } from '@commons/types/interface'
import { RESTMethodPath } from '@commons/types-pro'

const DASHBOARD_DAILY_RANGE_DAYS = 365
const PLATFORM_KEYS = ['web', 'ios', 'android', 'extension'] as const

const round = (value: number) => Math.round(value)

const pad = (value: number) => `${value}`.padStart(2, '0')

const formatDay = (date: Date) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

const formatDateTime = (date: Date, endOfDay = false) => {
  return `${formatDay(date)} ${endOfDay ? '23:59:59' : '00:00:00'}`
}

const parseDateTime = (value: string) => {
  const normalized = value.replace(' ', 'T')
  const parsed = new Date(normalized)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

const createRangeStart = (endDate: Date, days: number) => {
  const start = new Date(endDate)
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  return start
}

const normalizeDailyMetric = (item: DashboardMetricsDailyItem): DashboardMetricsDailyItem => {
  return {
    ...item,
    new_users_extension: item.new_users_extension ?? 0,
    active_users_extension: item.active_users_extension ?? 0,
    overview_users: item.overview_users ?? 0,
    summary_users: item.summary_users ?? 0,
    new_subscriptions_stripe: item.new_subscriptions_stripe ?? 0,
    new_subscriptions_apple_iap: item.new_subscriptions_apple_iap ?? 0,
    new_subscriptions_trial: item.new_subscriptions_trial ?? 0,
    new_subscriptions_blogger_trial: item.new_subscriptions_blogger_trial ?? 0,
    subscription_failed: item.subscription_failed ?? 0
  }
}

export const fetchDashboardMetricsDaily = async (query: DashboardMetricsQuery) => {
  const response = await request().post<DashboardMetricsDailyItem[]>({
    url: RESTMethodPath.DASHBOARD_METRICS_DAILY,
    body: query
  })

  if (!response) {
    throw new Error('Dashboard daily metrics are unavailable.')
  }

  return {
    data: response.map(normalizeDailyMetric)
  }
}

export const buildDashboardMetricsDailyQuery = (days = DASHBOARD_DAILY_RANGE_DAYS, endDate = new Date()): DashboardMetricsQuery => {
  const safeEndDate = new Date(endDate)
  safeEndDate.setHours(23, 59, 59, 0)

  return {
    start_time: formatDateTime(createRangeStart(safeEndDate, days)),
    end_time: formatDateTime(safeEndDate, true)
  }
}

export const getDashboardMetricsDailyEndDay = (query: DashboardMetricsQuery) => {
  const endDate = parseDateTime(query.end_time)
  return endDate ? formatDay(endDate) : ''
}

export const getDashboardMetricsDailyWindow = (items: DashboardMetricsDailyItem[], days: number) => {
  return items.slice(Math.max(items.length - days, 0))
}

export const getDashboardMetricsDailyLabel = (day: string, days: number) => {
  const [year, month, date] = day.split('-')
  if (!year || !month || !date) {
    return day
  }

  if (days === 365) {
    return `${year.slice(2)}/${month}`
  }

  return `${month}/${date}`
}

export const bucketDashboardMetricsDaily = (items: DashboardMetricsDailyItem[], bucketCount: number) => {
  if (items.length <= bucketCount) {
    return items
  }

  return Array.from({ length: bucketCount }, (_, index) => {
    const start = Math.floor((index * items.length) / bucketCount)
    const end = Math.floor(((index + 1) * items.length) / bucketCount)
    const chunk = items.slice(start, Math.max(end, start + 1))
    const last = chunk.length ? chunk[chunk.length - 1] : undefined

    if (!last) {
      return items[Math.min(start, items.length - 1)]
    }

    return {
      day: last.day,
      new_users_ios: round(chunk.reduce((sum, item) => sum + item.new_users_ios, 0) / chunk.length),
      new_users_android: round(chunk.reduce((sum, item) => sum + item.new_users_android, 0) / chunk.length),
      new_users_web: round(chunk.reduce((sum, item) => sum + item.new_users_web, 0) / chunk.length),
      new_users_extension: round(chunk.reduce((sum, item) => sum + (item.new_users_extension ?? 0), 0) / chunk.length),
      active_users_ios: round(chunk.reduce((sum, item) => sum + item.active_users_ios, 0) / chunk.length),
      active_users_android: round(chunk.reduce((sum, item) => sum + item.active_users_android, 0) / chunk.length),
      active_users_web: round(chunk.reduce((sum, item) => sum + item.active_users_web, 0) / chunk.length),
      active_users_extension: round(chunk.reduce((sum, item) => sum + item.active_users_extension, 0) / chunk.length),
      new_bookmarks: round(chunk.reduce((sum, item) => sum + item.new_bookmarks, 0) / chunk.length),
      bookmark_users: round(chunk.reduce((sum, item) => sum + item.bookmark_users, 0) / chunk.length),
      new_subscriptions: round(chunk.reduce((sum, item) => sum + item.new_subscriptions, 0) / chunk.length),
      new_subscriptions_stripe: round(chunk.reduce((sum, item) => sum + (item.new_subscriptions_stripe ?? 0), 0) / chunk.length),
      new_subscriptions_apple_iap: round(chunk.reduce((sum, item) => sum + (item.new_subscriptions_apple_iap ?? 0), 0) / chunk.length),
      new_subscriptions_trial: round(chunk.reduce((sum, item) => sum + (item.new_subscriptions_trial ?? 0), 0) / chunk.length),
      new_subscriptions_blogger_trial: round(chunk.reduce((sum, item) => sum + (item.new_subscriptions_blogger_trial ?? 0), 0) / chunk.length),
      subscription_failed: round(chunk.reduce((sum, item) => sum + (item.subscription_failed ?? 0), 0) / chunk.length),
      archive_users: round(chunk.reduce((sum, item) => sum + item.archive_users, 0) / chunk.length),
      activated_users: round(chunk.reduce((sum, item) => sum + item.activated_users, 0) / chunk.length),
      ai_power_users: round(chunk.reduce((sum, item) => sum + item.ai_power_users, 0) / chunk.length),
      overview_users: round(chunk.reduce((sum, item) => sum + (item.overview_users ?? 0), 0) / chunk.length),
      summary_users: round(chunk.reduce((sum, item) => sum + (item.summary_users ?? 0), 0) / chunk.length)
    }
  })
}

export const getDashboardMetricsDailyPlatformValue = (item: DashboardMetricsDailyItem, key: (typeof PLATFORM_KEYS)[number], metric: 'active' | 'new') => {
  if (metric === 'active') {
    switch (key) {
      case 'web':
        return item.active_users_web
      case 'ios':
        return item.active_users_ios
      case 'android':
        return item.active_users_android
      case 'extension':
        return item.active_users_extension
    }
  }

  switch (key) {
    case 'web':
      return item.new_users_web
    case 'ios':
      return item.new_users_ios
    case 'android':
      return item.new_users_android
    case 'extension':
      return item.new_users_extension ?? 0
  }
}

export const getDashboardMetricsDailyTotalActiveUsers = (item: DashboardMetricsDailyItem) => {
  return PLATFORM_KEYS.reduce((sum, key) => sum + getDashboardMetricsDailyPlatformValue(item, key, 'active'), 0)
}

export const getDashboardMetricsDailyTotalNewUsers = (item: DashboardMetricsDailyItem) => {
  return PLATFORM_KEYS.reduce((sum, key) => sum + getDashboardMetricsDailyPlatformValue(item, key, 'new'), 0)
}

export const useDashboardMetricsDailySource = () => {
  const dailyRecords = useState<DashboardMetricsDailyItem[]>('dashboard-metrics-daily-records', () => [])
  const dailyQuery = useState<DashboardMetricsQuery>('dashboard-metrics-daily-query', () => buildDashboardMetricsDailyQuery())
  const loading = useState<boolean>('dashboard-metrics-daily-loading', () => false)
  const errorMessage = useState<string>('dashboard-metrics-daily-error', () => '')
  const loadedQueryKey = useState<string>('dashboard-metrics-daily-query-key', () => '')

  const load = async (query = buildDashboardMetricsDailyQuery()) => {
    const startDate = parseDateTime(query.start_time)
    const endDate = parseDateTime(query.end_time)

    if (!startDate || !endDate || startDate > endDate) {
      throw new Error('Dashboard daily metrics query is invalid.')
    }

    const queryKey = `${query.start_time}__${query.end_time}`
    if (!loading.value && loadedQueryKey.value === queryKey && dailyRecords.value.length > 0) {
      dailyQuery.value = query
      return dailyRecords.value
    }

    loading.value = true
    errorMessage.value = ''

    try {
      const response = await fetchDashboardMetricsDaily(query)
      dailyRecords.value = response.data.map(normalizeDailyMetric)
      dailyQuery.value = query
      loadedQueryKey.value = queryKey
      return dailyRecords.value
    } catch (error) {
      errorMessage.value = `${error}`
      throw error
    } finally {
      loading.value = false
    }
  }

  return {
    dailyRecords,
    dailyQuery,
    loading,
    errorMessage,
    load
  }
}
