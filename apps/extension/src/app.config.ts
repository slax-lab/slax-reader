import { LocalStorageKey } from '@commons/frontend-types/const'
import { googleAnalytics4 } from '@wxt-dev/analytics/providers/google-analytics-4'

const isProduction = process.env.SLAX_ENV === 'production'
const isOffscreen = typeof location !== 'undefined' && location.pathname.endsWith('/offscreen.html')

const memoryItem = <T>(fallback: T) => ({
  getValue: async () => fallback,
  setValue: async (_value: T | undefined): Promise<void> => {}
})

const analyticsEnabled = (() => {
  if (isOffscreen || !(globalThis as typeof globalThis & { chrome?: { storage?: unknown } }).chrome?.storage) {
    return memoryItem(true)
  }

  return storage.defineItem(LocalStorageKey.ANALYTICS_ENABLED, { fallback: true })
})()

export default defineAppConfig({
  analytics: {
    enabled: analyticsEnabled,
    userId: isOffscreen ? memoryItem('offscreen') : undefined,
    userProperties: isOffscreen ? memoryItem<Record<string, string>>({}) : undefined,
    debug: !isProduction,
    providers: isOffscreen
      ? []
      : [
          googleAnalytics4({
            apiSecret: process.env.GOOGLE_ANALYTICS_API_SECRET + '',
            measurementId: process.env.GOOGLE_ANALYTICS_MEASUREMENT_ID + ''
          })
        ]
  }
})
