import { beforeEach, describe, expect, it, vi } from 'vitest'

// fetchDashboardMetricsDaily is imported by useHistoryMetrics from useDashboardMetricsDailySource.
const { fetchDailyMock } = vi.hoisted(() => ({ fetchDailyMock: vi.fn() }))

vi.mock('~~/app/composables/useDashboardMetricsDailySource', () => ({
  fetchDashboardMetricsDaily: fetchDailyMock,
  buildDashboardMetricsDailyQuery: vi.fn(() => ({ start_time: '2026-01-01 00:00:00', end_time: '2026-01-10 23:59:59' })),
  getDashboardMetricsDailyLabel: vi.fn((day: string) => day),
  getDashboardMetricsDailyWindow: vi.fn((items: unknown[]) => items),
  getDashboardMetricsDailyEndDay: vi.fn(() => '2026-01-10')
}))

const makeDailyItem = (day: string) => ({
  day,
  active_users: 10,
  active_users_web: 5,
  active_users_ios: 2,
  active_users_android: 2,
  active_users_extension: 1,
  new_users_web: 3,
  new_users_ios: 1,
  new_users_android: 1,
  new_users_extension: 0,
  activated_users: 2,
  new_bookmarks: 20,
  bookmark_users: 8,
  archive_users: 3,
  ai_power_users: 4,
  overview_users: 2,
  summary_users: 1,
  new_subscriptions: 1
})

describe('useHistoryMetrics', () => {
  beforeEach(() => {
    vi.resetModules()
    fetchDailyMock.mockReset()
  })

  it('initial state: loading=false, errorMessage empty, selectedRange=7', async () => {
    const { useHistoryMetrics } = await import('~~/app/composables/useHistoryMetrics')
    const { loading, errorMessage, selectedRange } = useHistoryMetrics()
    expect(loading.value).toBe(false)
    expect(errorMessage.value).toBe('')
    expect(selectedRange.value).toBe(7)
  })

  it('loadRange fetches data and populates activeRange', async () => {
    fetchDailyMock.mockResolvedValue({ data: [makeDailyItem('2026-01-01'), makeDailyItem('2026-01-02')] })
    const { useHistoryMetrics } = await import('~~/app/composables/useHistoryMetrics')
    const { loadRange, activeRange } = useHistoryMetrics()
    await loadRange(7)
    expect(activeRange.value.charts.length).toBeGreaterThan(0)
    expect(activeRange.value.labels.length).toBe(2)
  })

  it('loadRange sets errorMessage on fetch failure', async () => {
    fetchDailyMock.mockRejectedValue(new Error('network error'))
    const { useHistoryMetrics } = await import('~~/app/composables/useHistoryMetrics')
    const { loadRange, errorMessage } = useHistoryMetrics()
    await loadRange(7)
    expect(errorMessage.value).toContain('network error')
  })

  it('loadRange skips fetch if range already cached', async () => {
    fetchDailyMock.mockResolvedValue({ data: [makeDailyItem('2026-01-01')] })
    const { useHistoryMetrics } = await import('~~/app/composables/useHistoryMetrics')
    const { loadRange } = useHistoryMetrics()
    await loadRange(7)
    await loadRange(7)
    expect(fetchDailyMock).toHaveBeenCalledTimes(1)
  })

  it('activeRange returns empty dataset when no cache', async () => {
    const { useHistoryMetrics } = await import('~~/app/composables/useHistoryMetrics')
    const { activeRange, selectedRange } = useHistoryMetrics()
    selectedRange.value = 30
    expect(activeRange.value.charts).toEqual([])
    expect(activeRange.value.labels).toEqual([])
  })

  it('rangeOptions contains 4 preset ranges', async () => {
    const { useHistoryMetrics } = await import('~~/app/composables/useHistoryMetrics')
    const { rangeOptions } = useHistoryMetrics()
    expect(rangeOptions.value.length).toBe(4)
    expect(rangeOptions.value.map(o => o.days)).toEqual([7, 30, 90, 365])
  })

  it('loadCustomRange populates customDataset so activeRange reflects it when activeMode=custom', async () => {
    fetchDailyMock.mockResolvedValue({ data: [makeDailyItem('2026-01-01'), makeDailyItem('2026-01-02')] })
    const { useHistoryMetrics } = await import('~~/app/composables/useHistoryMetrics')
    const { loadCustomRange, activeMode, activeRange } = useHistoryMetrics()
    await loadCustomRange('2026-01-01', '2026-01-02')
    // loadCustomRange only sets customDataset; caller (HistorySection) sets activeMode='custom'
    activeMode.value = 'custom'
    expect(activeRange.value.labels.length).toBe(2)
  })

  it('loadRange with empty data returns empty dataset (buildDataset early return)', async () => {
    fetchDailyMock.mockResolvedValue({ data: [] })
    const { useHistoryMetrics } = await import('~~/app/composables/useHistoryMetrics')
    const { loadRange, activeRange } = useHistoryMetrics()
    await loadRange(7)
    // buildDataset returns { days, labels: [], rawLabels: [], charts: [] } for empty items
    expect(activeRange.value.labels).toEqual([])
    expect(activeRange.value.charts).toEqual([])
  })
})
