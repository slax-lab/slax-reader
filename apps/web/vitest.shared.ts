// vitest.shared.ts
// vitest.config.ts 与 vitest.raw.config.ts 共享 plain object 配置
// 注意：@nuxt/test-utils 的 defineVitestConfig 返回 async function，不能直接 spread
// 因此把可共享部分抽成普通 object，由两份 config 各自 import 后 spread

import type { CoverageOptions } from 'vitest/node'
// CoverageOptions 由 vitest/node 导出，用于约束 thresholds 表的类型签名

/** 测试运行参数（dir/include/setup/environment 等），主跑与 raw 跑共用 */
export const sharedTestOptions = {
  dir: './tests',
  include: ['**/*.spec.ts'],
  setupFiles: ['./tests/setup/index.ts', './tests/setup/fork.ts'],
  environment: 'nuxt' as const,
  testTimeout: 10000,
  environmentOptions: {
    nuxt: {
      domEnvironment: 'happy-dom' as const,
      mock: {
        intersectionObserver: true,
        indexedDb: true
      }
    }
  },
  // tests/ 只剩 it.skip smoke 时 Vitest 默认 "No test files found" 退出非零
  passWithNoTests: true
}

/** 基座 exclude（主跑与 raw 跑都要剔除：类型定义 / 入口 / 布局 / 插件） */
export const sharedExcludeBase = ['app/**/*.d.ts', 'app/**/types.ts', 'app/app.vue', 'app/error.vue', 'app/layouts/**', 'app/plugins/**']

/**
 * e2e-only 推迟项 + 占位/纯导出文件
 *
 * **主跑 + raw 跑都 exclude**：以下文件都从 coverage 视图剔除，让 test:coverage
 * 报告不出现"白色（0%）/ 红色（< 50%）"噪声。
 *
 * vitest `include` 限制只跑 `**\/*.spec.ts`，所以这些源码文件本来就不会被 vitest
 * 主动"测试"；exclude 仅控制 coverage 报告的展示与阈值参与。
 *
 * ## 第一类：必须 e2e（真实浏览器才能测）
 *
 * Selection 链 / Custom Element / Twitter / Photoswipe / Selection API 等都依赖
 * happy-dom 不支持的浏览器 API；raw overall 也不该把它们计入分母——否则会被一组
 * 永远 0% 的文件持续拉低，失去"基线不退化"含义。
 *
 * 注意：以下 CEComponents 已被 processor specs 间接测到，**不**列入 exclude：
 *   - WechatVideoInfo.ce.vue（被 wechat-video.processor.spec 测，覆盖 90.9%）
 *   - UnsupportedVideo.ce.vue（被 video.processor.spec 测）
 *   - TweetFooterInfo.ce.vue（被 tweet.processor.spec 测，覆盖 60%）
 *
 * ## 第二类：占位 / 纯导出 / SSR 专属（无可测可执行代码）
 *
 * - 空模板存根：CollectionHeader / UserPageSkeleton
 * - 类型 / 聚合导出文件：Chat/type.ts、bookmark/type.ts、adapters/index.ts、processors/index.ts
 * - SSR 渲染专用：OgImage/Share.satori.vue（satori 服务端调用，运行时不在浏览器）
 *
 * ## 第三类：静态营销页 / OAuth 入口（e2e 冒烟）
 *
 * - pages/auth.vue / login.vue：OAuth 回调与入口
 * - pages/guide.vue / user.vue：静态营销 / 用户设置页
 * - pages/s/[id].vue：share 详情页（含 425 行 iframe + SW 链路）
 * - pages/[...slug].vue：404 fallback
 */
export const phase4ExcludeAdditions = [
  // === Selection 链 4 个 Custom Element（panel/menus/cell/input）—— 必须真实 Selection API
  'app/components/Article/Selection/ArticleSelectionPanel.ce.vue',
  'app/components/Article/Selection/ArticleSelectionMenus.ce.vue',
  'app/components/Article/Selection/ArticleCommentCell.ce.vue',
  'app/components/Article/Selection/ArticleCommentInput.ce.vue',

  // === CEComponents 3 个嵌入 Custom Element —— processor 链未触达，必须 e2e
  // PhotoSwiperDots：滚动指示器 ce，依赖 IntersectionObserver + scroll behavior
  'app/components/Article/CEComponents/PhotoSwiperDots.ce.vue',
  // TweetUserInfo / TweetQuoteInfo：Twitter 卡片，依赖远程图片 + 真实排版
  'app/components/Article/CEComponents/tweet/TweetUserInfo.ce.vue',
  'app/components/Article/CEComponents/tweet/TweetQuoteInfo.ce.vue',

  // === 占位 / 纯导出 / 类型文件（无可测可执行代码）
  'app/components/global/CollectionHeader.vue',
  'app/components/UserPageSkeleton.vue',
  'app/components/Chat/type.ts',
  'app/composables/bookmark/type.ts',
  'app/components/Article/Selection/adapters/index.ts',
  'app/components/Article/processors/index.ts',
  'app/components/OgImage/Share.satori.vue',

  // === 极简 wrapper / Nuxt #app 显式 import（vi.mock '#app' 会破坏 setupNuxt）
  // DwebI18nService.ts：1 行 useNuxtApp().$i18n.t 转发；'#app' import 不可 mock
  'app/components/Article/Selection/adapters/DwebI18nService.ts',

  // === happy-dom 不渲染 keyframe / 子节点动画 / Custom Element 模板
  // DotLoading.vue：4 个 dot keyframe 动画，happy-dom 不渲染 :nth-child + scale animation
  'app/components/DotLoading.vue',
  // ImagePreview.vue：Transition handleEnter / handleLeave / setTimeout 链不触发，e2e 覆盖
  'app/components/ImagePreview/ImagePreview.vue',
  // CEComponents 已被 processor specs 间接测到，剩余模板分支需真实 customElement
  'app/components/Article/CEComponents/UnsupportedVideo.ce.vue',
  'app/components/Article/CEComponents/tweet/TweetFooterInfo.ce.vue',

  // === 静态营销页 / OAuth 入口 / share 详情 / 404（e2e 冒烟）
  // 注意：vitest exclude 用 picomatch，方括号是字符类元字符，需要用 glob 通配（**/path/?...）规避
  'app/pages/auth.vue',
  'app/pages/login.vue',
  'app/pages/guide.vue',
  'app/pages/user.vue',
  // [id].vue / [...slug].vue：方括号在 picomatch 是字符类，escape 不可移植；
  // 改用通配模式 s/*.vue / *slug*.vue 让 glob 匹配文件名内的方括号
  'app/pages/s/*.vue',
  'app/pages/*slug*.vue'
]

/**
 * 单文件 / 目录级阈值表（主跑使用；raw 跑不带 thresholds 仅监控）
 * 第三期累积建立的全部门槛沿用，第四期会按 Sprint 进度增删
 */
export const sharedThresholdsByFile: NonNullable<CoverageOptions['thresholds']> = {
  // ===== utils 单文件 =====
  'app/utils/string.ts': {
    lines: 90,
    branches: 85,
    functions: 90,
    statements: 90
  },
  'app/utils/request.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/utils/environment.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/utils/modal.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/utils/userRelative.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/utils/zip.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/utils/channel.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/utils/analytics.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/utils/chatbot.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/utils/pwa.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // ===== composables =====
  'app/composables/useAuth.ts': {
    lines: 80,
    branches: 70,
    functions: 90,
    statements: 80
  },
  'app/composables/useBookmarkRelative.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/composables/useUserRelative.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/composables/useNotification.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/composables/bookmark/useBookmark.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/composables/bookmark/useCommon.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // ===== stores =====
  'app/stores/user.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // ===== middleware =====
  // 第四期 Sprint D.1（2026-05-26）：auth.global.ts 12 用例覆盖完整
  // 实测 100/93.75/100/100；阈值给定 80/70/85/80 留余量
  'app/middleware/auth.global.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // ===== pages =====
  'app/pages/bookmarks/[id].vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/pages/bookmarks/index.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // ===== components 单文件 =====
  'app/components/Article/Selection/adapters/DwebEnvironmentAdapter.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  // 第五期 Sprint A.1（2026-05-26）：modal.ts 26 用例覆盖完整
  // 实测 lines 88.18 / branches 70.05 / functions 100 / statements 88.14
  'app/components/Article/Selection/modal.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  // 第五期 Sprint A.2（2026-05-26）：DwebArticleSelection.ts 16 用例覆盖完整
  // 实测 lines 90 / branches 66.66 / functions 90.9 / statements 84.61
  // branches 66.66 略低于 70，给 60 留缓冲（getMarkPathItems 内 image/text 二分支 + null 早返多个）
  'app/components/Article/Selection/DwebArticleSelection.ts': {
    lines: 80,
    branches: 60,
    functions: 85,
    statements: 80
  },
  // 第五期 Sprint B.1（2026-05-26）：BookmarkArticle.vue 21 用例覆盖完整
  // 实测 lines 79.03 / branches 64.44 / functions 66.66 / statements 76.33
  // 该文件是 page-style 集成入口，jumpToHighLight / collection / handleDrawMark.share
  // 等多个分支需要更多桩配置才能跑到；阈值给 70/55/65/70 标定当前活路径覆盖
  'app/components/Article/BookmarkArticle.vue': {
    lines: 70,
    branches: 55,
    functions: 65,
    statements: 70
  },
  // 第五期 Sprint C.1（2026-05-26）：MarkdownText.vue 8 用例覆盖完整
  // 实测 lines 100 / branches 75 / functions 100 / statements 100
  'app/components/Markdown/MarkdownText.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  // 第五期 Sprint D.1（2026-05-26）：ImagePreview.vue 16 用例覆盖
  // 实测 lines 35.89 / branches 25.64 / functions 33.33 / statements 35.89
  // 大量分支锁在 Transition handleEnter / handleLeave / setTimeout 链，happy-dom 不触发 enter/leave
  // 阈值给 35/20/30/35 标定活路径覆盖；剩余 phase6 e2e
  'app/components/ImagePreview/ImagePreview.vue': {
    lines: 35,
    branches: 20,
    functions: 30,
    statements: 35
  },
  'app/components/Modal/index.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/Notification/UserNotification.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/Chat/ChatBot.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // sprint 5 batch 1
  'app/components/DotsMenu.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/OptionsBar.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/BookmarkList/TabsSidebar.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // sprint 5 batch 2
  'app/components/BookmarkList/SearchTopModal.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/BookmarkList/SearchHeader.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // sprint 5 batch 3
  'app/components/AppHeader.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/Modal/EditName.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/BookmarkList/AddUrlTopModal.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // sprint 5 batch 4
  'app/components/NavigateStyleButton.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/Modal/LoginModal.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/Modal/SnapshotStatusModal.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/Modal/Feedback.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // sprint 5 batch 5
  'app/components/AppFooter.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/GoogleLoginButton.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/AppleLoginButton.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/BookmarkList/TagsHeader.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // sprint 5 batch 6
  'app/components/Modal/EditTag.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/Notification/NotificationHeader.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/Tips/TopTips.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // sprint 5 batch 7（第四期 Sprint B.2：AILanguageTips functions 50→85，源码抽具名 onHover）
  'app/components/Tips/AILanguageTips.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/Notification/NotificationCell.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // sprint 5 batch 8（第四期 Sprint B.1：UserOperateIcon functions 70→85，KeepAlive deactivate 测试覆盖）
  'app/components/Toast/Toast.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/Layouts/SidebarLayout.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/BookmarkList/BookmarkHighlightCell.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/Chat/QuestionMessage.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/UserOperateIcon.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // sprint 5 batch 9
  'app/components/Layouts/BookmarksLayout.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/Layouts/DetailLayout.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/ThirdPartyImport/ImportProgressModal.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/CursorToast/CursorToast.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  // sprint 5 batch 10（第四期 Sprint B.3：Toast/index.ts + CursorToast/index.ts functions 70→85，dismissCleanup seam）
  'app/components/UserImportSection.vue': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/ImagePreview/index.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/Toast/index.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },
  'app/components/CursorToast/index.ts': {
    lines: 80,
    branches: 70,
    functions: 85,
    statements: 80
  },

  // ===== utils 目录级 =====
  // 注意：vitest thresholds 的目录通配 ('xxx/**') 是按 perFile 计算的——
  //      即 utils 下每个文件都必须满足 95/85/95/95，而不是聚合平均。
  //      该规则历史已存在（第二期收尾启用），所有 utils 文件均已治理到达标。
  //      composables / components 子目录因有未治理的文件（useArticle.ts 等），
  //      不能粗暴启用 perFile 通配阈值；改用 vitest.config.ts 顶层 global 阈值
  //      （65/55/65/65）兜底整体不退化。
  'app/utils/**': {
    lines: 95,
    branches: 85,
    functions: 95,
    statements: 95
  },

  // ===== pages 目录级（第四期 Sprint C.2 启用，实测后符合 70/60/70/70）=====
  // pages/** aggregate 实测：lines 78.7 / branches 67.22 / functions 73.58 / statements 77.25
  // 含 w/sw 废弃路径（单文件阈值 50/40/50/50 / 50/30/50/50 已豁免）
  // 注意：vitest 通配阈值 perFile，但 pages 下的 [...slug].vue 等文件目前 0% 会拖红——
  //      已通过维持单文件 w/sw 阈值降级 + 不为 [...slug] 等设阈值方式，整体 perFile 仍能过 70
  //      若新增页面 < 70%，需为该文件单独设阈值或纳入测试
  'app/pages/**': {
    lines: 70,
    branches: 60,
    functions: 70,
    statements: 70
  }
}

// ===== 以下为 fork 专属追加（原 fork 薄封装里的 fork-only 部分）=====

/** fork-only 文件单文件阈值表（Phase 2..N 增量灌入「实测值 − 5pt」）*/
export const forkThresholdsByFile: NonNullable<CoverageOptions['thresholds']> = {
  // Phase 2: 实测值 − 5pt（2026-05-27）
  // PlanCard.vue: lines 60.52 / branches 73.07 / funcs 63.63 / stmts 61.53
  'app/components/PlanCard.vue': {
    lines: 55,
    branches: 68,
    functions: 58,
    statements: 56
  },
  // useDashboardMetrics.ts: lines 78.66 / branches 47.36 / funcs 35 / stmts 74.68
  'app/composables/useDashboardMetrics.ts': {
    lines: 73,
    branches: 42,
    functions: 30,
    statements: 69
  },
  // Phase 4.1 Dashboard: 实测值 − 5pt（2026-05-27）
  // DashboardClient.vue: lines 56.6 / branches 54.05 / funcs 41.17 / stmts 55.17
  'app/components/Dashboard/DashboardClient.vue': {
    lines: 51,
    branches: 49,
    functions: 36,
    statements: 50
  },
  // Phase 4.3 PaymentModal: 实测值 − 5pt（2026-05-27）
  // PaymentModal.vue: lines 73.17 / branches 50 / funcs 76.92 / stmts 73.17
  'app/components/PaymentModal/PaymentModal.vue': {
    lines: 68,
    branches: 45,
    functions: 71,
    statements: 68
  },
  // InviteCodeModal.vue: lines 80.64 / branches 73.91 / funcs 72.22 / stmts 80.64 (Phase 4.4 re-measured)
  'app/components/PaymentModal/InviteCodeModal.vue': {
    lines: 75,
    branches: 68,
    functions: 67,
    statements: 75
  },
  // Phase 4.4: PlanPayment 实测值 − 5pt（2026-05-27）
  // PlanPayment.vue: lines 75.64 / branches 59.25 / funcs 71.42 / stmts 75
  'app/components/PlanPayment.vue': {
    lines: 70,
    branches: 54,
    functions: 66,
    statements: 70
  },
  // Phase 4.5 SubscriptionModal: 实测值 − 5pt（2026-05-27）
  // SubscriptionModal.vue: lines 64.86 / branches 66.66 / funcs 77.77 / stmts 64.86
  'app/components/SubscriptionModal/SubscriptionModal.vue': {
    lines: 59,
    branches: 61,
    functions: 72,
    statements: 59
  },
  // Phase 4.6 Collection/BookmarkCell: 100% coverage（template-only component）→ 95/95/95/95 保护
  'app/components/Collection/BookmarkCell.vue': {
    lines: 95,
    branches: 95,
    functions: 95,
    statements: 95
  },
  // Phase 4.8 ThirdPartyImport/ImportFailureCell: 82.14/76.47/60/82.14 → 77/71/55/77
  'app/components/ThirdPartyImport/ImportFailureCell.vue': {
    lines: 77,
    branches: 71,
    functions: 55,
    statements: 77
  },
  // Phase 4.9 global/ProIcon: 100/85.71/100/100 → 95/80/95/95
  'app/components/global/ProIcon.vue': {
    lines: 95,
    branches: 80,
    functions: 95,
    statements: 95
  },
  // HistorySection.vue: 66% lines / 54.54% functions — v8 counts <style lang="scss"> CSS rules as uncovered lines
  // JS logic coverage is ~84%; lower threshold to accept CSS artifact
  // functions 54.54% → threshold 49 (实测 − 5pt)
  'app/components/Dashboard/HistorySection.vue': {
    lines: 60,
    branches: 60,
    functions: 49,
    statements: 60
  }
}

/** fork coverage exclude（永久 + 渐进）*/
export const forkExcludeBase = [
  // === 永久 exclude ===
  'app/**/*.d.ts',
  'app/plugins/**',
  'app/service-worker/**',
  'server/**',
  // === 命令式弹窗 bootstrapper（直接调 createApp，vi.mock('vue') 会破坏 nuxt test env）===
  'app/components/SubscriptionModal/index.ts',
  // === 依赖 Nuxt 自动导入的具名导出（mockNuxtImport 无法拦截）===
  'app/composables/useTrackMetric.ts',
  // === pinia nuxt plugin 在 vitest 全局 API 注入前触发（skipHydrate / deferHydration 错误）===
  'app/components/global/CollectionHeader.vue',
  'app/components/Collection/OwnerSetting.vue',
  // === e2e-only：依赖真实浏览器 / Canvas / 无限滚动 / 复杂 DOM，happy-dom 无法覆盖 ===
  'app/components/Dashboard/HistoryLineChart.vue', // Chart.js canvas 渲染
  'app/components/ThirdPartyImport/ImportFailuresModal.vue', // 无限滚动 + 批量操作
  'app/components/ThirdPartyImport/ImportProgressModal.vue', // 无限滚动 + 复杂 DOM
  'app/components/Collection/CollectionModal/CancelCollectionModal.vue', // pinia skipHydrate
  'app/components/Collection/CollectionModal/RemoveCollectionModal.vue', // pinia skipHydrate
  'app/components/Collection/CollectionModal/index.ts', // createApp bootstrapper
  'app/components/Collection/CollectionModal/type.ts', // 纯类型文件，无可执行代码
  'app/components/Collection/StripePaySetting.vue', // 469 行 Stripe Connect 复杂表单
  // Note: PlanPayment.vue is at app/components/PlanPayment.vue (not PaymentModal/PlanPayment.vue)
  // It IS tested (75.64% coverage) — no exclude needed
  'app/components/GetSubscribeModal.vue', // pinia skipHydrate 问题
  // === 渐进 exclude（每个目录有第一个 spec 落地后从这里移除）===
  'app/middleware/**',
  'app/pages/**',
  'app/utils/**'
  // app/components/** 与 app/composables/** 始终不 exclude
]
