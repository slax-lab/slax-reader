import { forkExcludeBase, forkThresholdsByFile, phase4ExcludeAdditions, sharedExcludeBase, sharedTestOptions, sharedThresholdsByFile } from './vitest.shared.ts'
import { defineVitestConfig } from '@nuxt/test-utils/config'

// 全局 thresholds 70/60/70/70
// 前提：e2e-only 文件已加入 exclude，exclude 后整体覆盖率达标
export default defineVitestConfig({
  test: {
    ...sharedTestOptions,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json-summary'],
      include: ['app/**/*.{ts,vue}'],
      exclude: [...sharedExcludeBase, ...phase4ExcludeAdditions, ...forkExcludeBase],
      thresholds: {
        lines: 70,
        branches: 60,
        functions: 70,
        statements: 70,
        ...sharedThresholdsByFile,
        ...forkThresholdsByFile
      }
    }
  }
})
