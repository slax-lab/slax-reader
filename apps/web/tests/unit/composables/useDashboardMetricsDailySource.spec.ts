import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { describe, expect, it, vi } from 'vitest'

// fetchDashboardMetricsDaily calls request() (Nuxt auto-import) — mock via mockNuxtImport
const { requestMock } = vi.hoisted(() => ({
  requestMock: vi.fn(() => ({ post: vi.fn().mockResolvedValue(null) }))
}))
mockNuxtImport('request', () => requestMock)

// useDashboardMetricsDailySource exports pure functions — no other auto-imports needed

describe('useDashboardMetricsDailySource — pure functions', () => {
  describe('buildDashboardMetricsDailyQuery', () => {
    it('returns start_time and end_time strings', async () => {
      const { buildDashboardMetricsDailyQuery } = await import('~~/app/composables/useDashboardMetricsDailySource')
      const query = buildDashboardMetricsDailyQuery(7, new Date('2026-01-10T12:00:00'))
      expect(query.start_time).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
      expect(query.end_time).toMatch(/^\d{4}-\d{2}-\d{2} 23:59:59$/)
    })

    it('end_time date matches the provided endDate', async () => {
      const { buildDashboardMetricsDailyQuery } = await import('~~/app/composables/useDashboardMetricsDailySource')
      const query = buildDashboardMetricsDailyQuery(7, new Date('2026-01-10T12:00:00'))
      expect(query.end_time.startsWith('2026-01-10')).toBe(true)
    })

    it('start_time is (days-1) days before end_time', async () => {
      const { buildDashboardMetricsDailyQuery } = await import('~~/app/composables/useDashboardMetricsDailySource')
      const query = buildDashboardMetricsDailyQuery(7, new Date('2026-01-10T12:00:00'))
      // 7 days window: start = Jan 4, end = Jan 10
      expect(query.start_time.startsWith('2026-01-04')).toBe(true)
    })
  })

  describe('getDashboardMetricsDailyEndDay', () => {
    it('extracts date from end_time', async () => {
      const { getDashboardMetricsDailyEndDay } = await import('~~/app/composables/useDashboardMetricsDailySource')
      const result = getDashboardMetricsDailyEndDay({ start_time: '2026-01-01 00:00:00', end_time: '2026-01-10 23:59:59' })
      expect(result).toBe('2026-01-10')
    })

    it('returns empty string for invalid end_time', async () => {
      const { getDashboardMetricsDailyEndDay } = await import('~~/app/composables/useDashboardMetricsDailySource')
      const result = getDashboardMetricsDailyEndDay({ start_time: '', end_time: 'invalid' })
      expect(result).toBe('')
    })
  })

  describe('getDashboardMetricsDailyWindow', () => {
    it('returns last N items from array', async () => {
      const { getDashboardMetricsDailyWindow } = await import('~~/app/composables/useDashboardMetricsDailySource')
      const items = [1, 2, 3, 4, 5].map(i => ({ day: `2026-01-0${i}` }) as any)
      const result = getDashboardMetricsDailyWindow(items, 3)
      expect(result.length).toBe(3)
      expect(result[0]!.day).toBe('2026-01-03')
    })

    it('returns all items when days >= array length', async () => {
      const { getDashboardMetricsDailyWindow } = await import('~~/app/composables/useDashboardMetricsDailySource')
      const items = [{ day: '2026-01-01' }, { day: '2026-01-02' }] as any[]
      expect(getDashboardMetricsDailyWindow(items, 10).length).toBe(2)
    })
  })

  describe('fetchDashboardMetricsDaily', () => {
    it('throws when request returns null', async () => {
      requestMock.mockReturnValue({ post: vi.fn().mockResolvedValue(null) })
      const { fetchDashboardMetricsDaily } = await import('~~/app/composables/useDashboardMetricsDailySource')
      await expect(fetchDashboardMetricsDaily({ start_time: '', end_time: '' })).rejects.toThrow('Dashboard daily metrics are unavailable.')
    })

    it('returns normalized data when request succeeds', async () => {
      const item = {
        day: '2026-01-01',
        active_users: 10,
        new_users_extension: null,
        active_users_extension: null,
        overview_users: null,
        summary_users: null
      }
      requestMock.mockReturnValue({ post: vi.fn().mockResolvedValue([item]) })
      const { fetchDashboardMetricsDaily } = await import('~~/app/composables/useDashboardMetricsDailySource')
      const { data } = await fetchDashboardMetricsDaily({ start_time: '', end_time: '' })
      expect(data[0]!.new_users_extension).toBe(0) // null → 0 via normalizeDailyMetric
      expect(data[0]!.overview_users).toBe(0)
    })
  })

  describe('getDashboardMetricsDailyLabel', () => {
    it('returns month/date for days < 365', async () => {
      const { getDashboardMetricsDailyLabel } = await import('~~/app/composables/useDashboardMetricsDailySource')
      expect(getDashboardMetricsDailyLabel('2026-01-05', 30)).toBe('01/05')
    })

    it('returns YY/MM for days === 365', async () => {
      const { getDashboardMetricsDailyLabel } = await import('~~/app/composables/useDashboardMetricsDailySource')
      expect(getDashboardMetricsDailyLabel('2026-01-05', 365)).toBe('26/01')
    })

    it('returns raw day string for invalid format', async () => {
      const { getDashboardMetricsDailyLabel } = await import('~~/app/composables/useDashboardMetricsDailySource')
      expect(getDashboardMetricsDailyLabel('invalid', 30)).toBe('invalid')
    })
  })

  describe('bucketDashboardMetricsDaily', () => {
    const makeItem = (day: string) => ({
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

    it('returns items unchanged when count <= bucketCount', async () => {
      const { bucketDashboardMetricsDaily } = await import('~~/app/composables/useDashboardMetricsDailySource')
      const items = [makeItem('2026-01-01'), makeItem('2026-01-02')]
      expect(bucketDashboardMetricsDaily(items as any, 5).length).toBe(2)
    })

    it('buckets items when count > bucketCount', async () => {
      const { bucketDashboardMetricsDaily } = await import('~~/app/composables/useDashboardMetricsDailySource')
      const items = Array.from({ length: 10 }, (_, i) => makeItem(`2026-01-${String(i + 1).padStart(2, '0')}`))
      const result = bucketDashboardMetricsDaily(items as any, 3)
      expect(result.length).toBe(3)
    })
  })

  describe('getDashboardMetricsDailyPlatformValue', () => {
    const item = {
      active_users_web: 10,
      active_users_ios: 5,
      active_users_android: 3,
      active_users_extension: 2,
      new_users_web: 8,
      new_users_ios: 4,
      new_users_android: 2,
      new_users_extension: 1
    }

    it('returns active_users_web for web/active', async () => {
      const { getDashboardMetricsDailyPlatformValue } = await import('~~/app/composables/useDashboardMetricsDailySource')
      expect(getDashboardMetricsDailyPlatformValue(item as any, 'web', 'active')).toBe(10)
    })

    it('returns new_users_ios for ios/new', async () => {
      const { getDashboardMetricsDailyPlatformValue } = await import('~~/app/composables/useDashboardMetricsDailySource')
      expect(getDashboardMetricsDailyPlatformValue(item as any, 'ios', 'new')).toBe(4)
    })

    it('returns active_users_android for android/active', async () => {
      const { getDashboardMetricsDailyPlatformValue } = await import('~~/app/composables/useDashboardMetricsDailySource')
      expect(getDashboardMetricsDailyPlatformValue(item as any, 'android', 'active')).toBe(3)
    })

    it('returns new_users_extension for extension/new', async () => {
      const { getDashboardMetricsDailyPlatformValue } = await import('~~/app/composables/useDashboardMetricsDailySource')
      expect(getDashboardMetricsDailyPlatformValue(item as any, 'extension', 'new')).toBe(1)
    })

    it('returns active_users_extension for extension/active', async () => {
      const { getDashboardMetricsDailyPlatformValue } = await import('~~/app/composables/useDashboardMetricsDailySource')
      expect(getDashboardMetricsDailyPlatformValue(item as any, 'extension', 'active')).toBe(2)
    })
  })

  describe('getDashboardMetricsDailyTotalNewUsers', () => {
    it('returns sum of new users across all platforms', async () => {
      const { getDashboardMetricsDailyTotalNewUsers } = await import('~~/app/composables/useDashboardMetricsDailySource')
      const item = { new_users_web: 8, new_users_ios: 4, new_users_android: 2, new_users_extension: 1 }
      expect(getDashboardMetricsDailyTotalNewUsers(item as any)).toBe(15)
    })
  })
})
