import type { BookmarkFunnel, DashboardMetricsQuery, TopArticleItem, VisitOverview } from '@commons/types/interface'
import { RESTMethodPath } from '@commons/types'

export type KindStatsPeriod = 'day' | 'week' | 'month'

const pad = (value: number) => `${value}`.padStart(2, '0')

const formatDateTime = (date: Date) => {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
}

export const buildKindStatsRange = (period: KindStatsPeriod, now = new Date()): DashboardMetricsQuery => {
  const start = new Date(now)
  start.setHours(0, 0, 0, 0)

  if (period === 'week') {
    const day = start.getDay() // 0=周日, 1=周一 ... 6=周六
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1))
  } else if (period === 'month') {
    start.setDate(1)
  }

  const end = new Date(start)
  if (period === 'day') {
    end.setDate(end.getDate() + 1)
  } else if (period === 'week') {
    end.setDate(end.getDate() + 7)
  } else {
    end.setMonth(end.getMonth() + 1)
  }

  return {
    start_time: formatDateTime(start),
    end_time: formatDateTime(end)
  }
}

const fetchVisitOverview = async (query: DashboardMetricsQuery): Promise<VisitOverview> => {
  const response = await request().post<VisitOverview>({
    url: RESTMethodPath.DASHBOARD_VISIT_OVERVIEW,
    body: query
  })
  if (!response) {
    throw new Error('Dashboard visit overview is unavailable.')
  }
  return response
}

const fetchTopArticles = async (query: DashboardMetricsQuery & { limit?: number }): Promise<TopArticleItem[]> => {
  const response = await request().post<TopArticleItem[]>({
    url: RESTMethodPath.DASHBOARD_TOP_ARTICLES,
    body: query
  })
  if (!response) {
    throw new Error('Dashboard top articles are unavailable.')
  }
  return response
}

const fetchBookmarkSteps = async (query: DashboardMetricsQuery): Promise<BookmarkFunnel> => {
  const response = await request().post<BookmarkFunnel>({
    url: RESTMethodPath.DASHBOARD_BOOKMARK_STEPS,
    body: query
  })
  if (!response) {
    throw new Error('Dashboard bookmark steps are unavailable.')
  }
  return response
}

export const useDashboardKindStats = () => {
  const visitOverview = ref<VisitOverview | null>(null)
  const topArticles = ref<TopArticleItem[]>([])
  const stepFunnel = ref<BookmarkFunnel | null>(null)

  const visitLoading = ref(false)
  const topLoading = ref(false)
  const stepLoading = ref(false)

  const visitError = ref('')
  const topError = ref('')
  const stepError = ref('')

  // 访问总人数/人次(需求②)
  const loadVisitOverview = async (period: KindStatsPeriod) => {
    visitLoading.value = true
    visitError.value = ''
    try {
      visitOverview.value = await fetchVisitOverview(buildKindStatsRange(period))
    } catch (error) {
      visitError.value = `${error}`
    } finally {
      visitLoading.value = false
    }
  }

  // 访问最多的文章(需求①)
  const loadTopArticles = async (period: KindStatsPeriod, limit = 20) => {
    topLoading.value = true
    topError.value = ''
    try {
      topArticles.value = await fetchTopArticles({ ...buildKindStatsRange(period), limit })
    } catch (error) {
      topError.value = `${error}`
    } finally {
      topLoading.value = false
    }
  }

  // 新增书签漏斗(需求③)
  const loadBookmarkSteps = async (period: KindStatsPeriod) => {
    stepLoading.value = true
    stepError.value = ''
    try {
      stepFunnel.value = await fetchBookmarkSteps(buildKindStatsRange(period))
    } catch (error) {
      stepError.value = `${error}`
    } finally {
      stepLoading.value = false
    }
  }

  return {
    visitOverview,
    topArticles,
    stepFunnel,
    visitLoading,
    topLoading,
    stepLoading,
    visitError,
    topError,
    stepError,
    loadVisitOverview,
    loadTopArticles,
    loadBookmarkSteps
  }
}
