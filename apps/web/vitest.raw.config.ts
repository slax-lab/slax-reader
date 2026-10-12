import { forkExcludeBase, phase4ExcludeAdditions, sharedExcludeBase, sharedTestOptions } from './vitest.shared.ts'
import { defineVitestConfig } from '@nuxt/test-utils/config'

// raw 跑不带 thresholds，纯监控覆盖率；reportsDirectory 独立 coverage-raw
export default defineVitestConfig({
  test: {
    ...sharedTestOptions,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['app/**/*.{ts,vue}'],
      exclude: [...sharedExcludeBase, ...phase4ExcludeAdditions, ...forkExcludeBase],
      reportsDirectory: 'coverage-raw'
    }
  }
})
