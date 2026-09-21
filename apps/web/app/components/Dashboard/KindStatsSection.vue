<template>
  <div class="kind-stats">
    <!-- 访问数据：总人数/人次(②) + 访问最多的文章(①) -->
    <section class="kind-card">
      <div class="kind-card__header">
        <span class="section-tag section-tag--blue">访问数据</span>
        <div class="kind-toggle" role="group" aria-label="访问统计区间">
          <button
            v-for="option in PERIODS"
            :key="option.key"
            type="button"
            class="kind-toggle__btn"
            :class="{ 'is-active': visitPeriod === option.key }"
            :disabled="visitLoading || topLoading"
            @click="changeVisitPeriod(option.key)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div v-if="visitError" class="kind-card__error">
        <span>{{ visitError }}</span>
        <button type="button" @click="reloadVisit">重试</button>
      </div>

      <template v-else>
        <div class="kind-kpis">
          <div class="kind-kpi">
            <span class="kind-kpi__label">访问次数</span>
            <strong class="kind-kpi__value">{{ formatNumber(visitOverview?.total_visits ?? 0) }}</strong>
          </div>
          <div class="kind-kpi">
            <span class="kind-kpi__label">访问人数</span>
            <strong class="kind-kpi__value">{{ formatNumber(visitOverview?.unique_visitors ?? 0) }}</strong>
          </div>
          <div class="kind-kpi">
            <span class="kind-kpi__label">访客数量</span>
            <strong class="kind-kpi__value">{{ formatNumber(visitOverview?.guest_visitors ?? 0) }}</strong>
          </div>
        </div>

        <div class="kind-table-wrap">
          <span class="kind-subtitle">访问最多的文章</span>
          <div v-if="topLoading" class="kind-card__placeholder">加载中…</div>
          <div v-else-if="!topArticles.length" class="kind-card__placeholder">暂无数据</div>
          <table v-else class="kind-table">
            <thead>
              <tr>
                <th class="is-num">#</th>
                <th>文章</th>
                <th class="is-num">访客人数</th>
                <th class="is-num">访客次数</th>
                <th class="is-num">用户人数</th>
                <th class="is-num">用户次数</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="(item, index) in topArticles" :key="item.uuid">
                <td class="is-num kind-table__rank">{{ index + 1 }}</td>
                <td class="kind-table__title">
                  <a :href="item.link" target="_blank" rel="noopener noreferrer" :title="item.title">{{ item.title }}</a>
                </td>
                <td class="is-num is-strong">{{ formatNumber(item.guest_uv) }}</td>
                <td class="is-num">{{ formatNumber(item.guest_visits) }}</td>
                <td class="is-num is-strong">{{ formatNumber(item.member_uv) }}</td>
                <td class="is-num">{{ formatNumber(item.member_visits) }}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </template>
    </section>

    <!-- 新增书签每个 step 的成功率(③) -->
    <section class="kind-card">
      <div class="kind-card__header">
        <span class="section-tag section-tag--violet">书签处理各阶段数据</span>
        <div class="kind-toggle" role="group" aria-label="书签步骤区间">
          <button
            v-for="option in PERIODS"
            :key="option.key"
            type="button"
            class="kind-toggle__btn"
            :class="{ 'is-active': stepPeriod === option.key }"
            :disabled="stepLoading"
            @click="changeStepPeriod(option.key)"
          >
            {{ option.label }}
          </button>
        </div>
      </div>

      <div v-if="stepError" class="kind-card__error">
        <span>{{ stepError }}</span>
        <button type="button" @click="reloadStep">重试</button>
      </div>

      <template v-else>
        <div v-if="stepLoading" class="kind-card__placeholder">加载中…</div>
        <div v-else-if="!stepFunnel" class="kind-card__placeholder">暂无数据</div>
        <template v-else>
          <ol class="funnel">
            <!-- 入口：发起收藏 -->
            <li class="fstage fstage--entry">
              <div class="fstage__rail">
                <span class="fstage__node">1</span>
              </div>
              <div class="fstage__body">
                <div class="fstage__top">
                  <span class="fstage__name">{{ stepLabel('bookmark_add') }}</span>
                </div>
                <div class="fstage__metrics">
                  <span class="fstage__count">{{ formatNumber(entryBookmarks) }}</span>
                  <span class="fstage__unit">书签</span>
                  <span class="fstage__muted"
                    >· {{ formatNumber(stepFunnel.entry.attempts) }} 次发起 · {{ formatNumber(stepFunnel.entry.users) }} 人<span v-if="stepFunnel.entry.failed" class="fstage__warn"> · {{ formatNumber(stepFunnel.entry.failed) }} 次发起失败</span><span v-if="preCheckFailed" class="fstage__warn"> · {{ formatNumber(preCheckFailed) }} 次前置失败</span></span
                  >
                </div>
                <div class="fbar">
                  <div class="fbar__fill fbar__fill--entry" :style="{ width: '100%' }"></div>
                </div>
              </div>
            </li>

            <!-- 后续阶段 -->
            <li v-for="(stage, index) in funnelStages" :key="stage.key" class="fstage">
              <div class="fstage__rail">
                <span class="fstage__node">{{ index + 2 }}</span>
              </div>
              <div class="fstage__body">
                <div class="fstage__top">
                  <span class="fstage__name">{{ stage.label }}</span>
                </div>
                <div class="fstage__metrics">
                  <span class="fstage__count">{{ formatNumber(stage.bookmarks) }}</span>
                  <span class="fstage__unit">书签</span>
                  <span class="fstage__muted">· {{ formatNumber(stage.success) }}/{{ formatNumber(stage.attempts) }} 次成功<span v-if="stage.failed" class="fstage__warn"> · {{ formatNumber(stage.failed) }} 次失败</span></span>
                </div>
                <div class="fbar">
                  <div class="fbar__fill" :class="rateClass(stage.successRate)" :style="{ width: `${Math.max(stage.widthPercent, 2)}%` }"></div>
                </div>

                <!-- 多源阶段（内容抓取）展开各来源 -->
                <ul v-if="stage.sources.length" class="fsources">
                  <li v-for="src in stage.sources" :key="src.step_name" class="fsource">
                    <span class="fsource__name">{{ src.label }}</span>
                    <div class="fsource__track">
                      <div class="fsource__fill" :style="{ width: `${Math.max(src.sharePercent, 2)}%` }"></div>
                    </div>
                    <span class="fsource__count">{{ formatNumber(src.bookmarks) }}</span>
                  </li>
                </ul>
              </div>
            </li>
          </ol>

          <!-- Metadata 阶段：并行步骤，卡片网格展示 -->
          <div v-if="stepFunnel.metadata.length" class="kind-meta-wrap">
            <span class="kind-subtitle">Metadata 阶段 · 入库后并行处理</span>
            <div class="meta-grid">
              <div v-for="item in stepFunnel.metadata" :key="item.step_name" class="meta-card">
                <div class="meta-card__top">
                  <span class="meta-card__name">{{ stepLabel(item.step_name) }}</span>
                </div>
                <div class="meta-card__bar">
                  <div class="meta-card__fill" :class="rateClass(item.success_rate)" :style="{ width: `${clampRate(item.success_rate)}%` }"></div>
                </div>
                <span class="meta-card__detail">{{ formatNumber(item.success) }} / {{ formatNumber(item.attempts) }} 次<span v-if="item.failed" class="fstage__warn"> · {{ formatNumber(item.failed) }} 失败</span> · {{ formatNumber(item.bookmarks) }} 书签</span>
              </div>
            </div>
          </div>
        </template>
      </template>
    </section>
  </div>
</template>

<script setup lang="ts">
import type { KindStatsPeriod } from '~/composables/useDashboardKindStats'
import { useDashboardKindStats } from '~/composables/useDashboardKindStats'

const PERIODS: { key: KindStatsPeriod; label: string }[] = [
  { key: 'day', label: '当日' },
  { key: 'week', label: '本周' },
  { key: 'month', label: '本月' }
]

const {
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
} = useDashboardKindStats()

const visitPeriod = ref<KindStatsPeriod>('day')
const stepPeriod = ref<KindStatsPeriod>('day')

const reloadVisit = () => {
  loadVisitOverview(visitPeriod.value)
  loadTopArticles(visitPeriod.value)
}

const reloadStep = () => loadBookmarkSteps(stepPeriod.value)

const changeVisitPeriod = (period: KindStatsPeriod) => {
  if (visitPeriod.value === period) return
  visitPeriod.value = period
  reloadVisit()
}

const changeStepPeriod = (period: KindStatsPeriod) => {
  if (stepPeriod.value === period) return
  stepPeriod.value = period
  reloadStep()
}

const formatNumber = (value: number) => new Intl.NumberFormat('en-US').format(value)
const formatPct1 = (value: number) => `${(value ?? 0).toFixed(1)}%`
const clampRate = (value: number) => Math.min(Math.max(value ?? 0, 0), 100)
const rateClass = (value: number) => {
  if (value >= 95) return 'is-good'
  if (value >= 80) return 'is-warn'
  return 'is-bad'
}
const rateTextClass = (value: number) => {
  if (value >= 95) return 'rate-text--good'
  if (value >= 80) return 'rate-text--warn'
  return 'rate-text--bad'
}

const entryBookmarks = computed(() => {
  const e = stepFunnel.value?.entry
  if (!e) return 0
  return e.bookmarks > 0 ? e.bookmarks : e.attempts
})

// 漏斗阶段分组：把后端扁平的 funnel steps 归并成可读的处理阶段
const FUNNEL_STAGES: { key: string; label: string; steps: string[] }[] = [
  { key: 'workflow', label: '创建工作流', steps: ['workflow_creation', 'import_parse_workflow_creation'] },
  { key: 'fetching', label: '内容抓取', steps: ['inline_content', 'dajiala_fetching', 'fetching', 'twitter_fetching', 'xiaohongshu_fetching', 'weibo_fetching', 'reddit_fetching', 'zyte_fetching'] },
  { key: 'parsing', label: '内容解析', steps: ['parsing'] },
  { key: 'complete', label: '完成入库', steps: ['complete'] }
]

type FunnelStageView = {
  key: string
  label: string
  bookmarks: number
  attempts: number
  success: number
  failed: number
  successRate: number
  convPercent: number // 相对发起收藏的留存占比
  widthPercent: number
  sources: { step_name: string; label: string; bookmarks: number; attempts: number; success: number; failed: number; success_rate: number; sharePercent: number }[]
}

const funnelStages = computed<FunnelStageView[]>(() => {
  const f = stepFunnel.value
  if (!f) return []

  const byName = new Map(f.funnel.map(step => [step.step_name, step]))
  const entry = entryBookmarks.value || 0

  const stages: FunnelStageView[] = []
  for (const stage of FUNNEL_STAGES) {
    const matched = stage.steps.map(name => byName.get(name)).filter((s): s is NonNullable<typeof s> => !!s && (s.attempts > 0 || s.bookmarks > 0))
    if (!matched.length) continue

    const bookmarks = matched.reduce((sum, s) => sum + s.bookmarks, 0)
    const attempts = matched.reduce((sum, s) => sum + s.attempts, 0)
    const success = matched.reduce((sum, s) => sum + s.success, 0)
    const failed = matched.reduce((sum, s) => sum + (s.failed ?? 0), 0)
    const successRate = attempts ? (success / attempts) * 100 : 0
    const stageMax = matched.reduce((m, s) => Math.max(m, s.bookmarks), 0) || 1

    stages.push({
      key: stage.key,
      label: stage.label,
      bookmarks,
      attempts,
      success,
      failed,
      successRate,
      convPercent: entry ? (bookmarks / entry) * 100 : 0,
      widthPercent: entry ? Math.min((bookmarks / entry) * 100, 100) : 0,
      // 仅多源阶段（内容抓取）展开子项，按书签数降序，条宽相对本阶段最大源
      sources:
        stage.key === 'fetching'
          ? matched
              .map(s => ({ step_name: s.step_name, label: stepLabel(s.step_name), bookmarks: s.bookmarks, attempts: s.attempts, success: s.success, failed: s.failed ?? 0, success_rate: s.success_rate, sharePercent: (s.bookmarks / stageMax) * 100 }))
              .sort((a, b) => b.bookmarks - a.bookmarks)
          : []
    })
  }
  return stages
})

const STEP_LABELS: Record<string, string> = {
  bookmark_add: '发起收藏',
  pre_check: '前置校验',
  workflow_creation: '创建工作流',
  import_parse_workflow_creation: '创建导入解析工作流',
  inline_content: '内联内容抓取',
  twitter_fetching: 'Twitter 抓取',
  xiaohongshu_fetching: '小红书抓取',
  weibo_fetching: '微博抓取',
  reddit_fetching: 'Reddit 抓取',
  dajiala_fetching: '公众号抓取',
  zyte_fetching: 'Zyte 抓取',
  fetching: '网页抓取',
  parsing: '内容解析',
  complete: '完成入库',
  embedding: '向量化（搜索）',
  generate_overview_and_tags: '生成概述与标签',
  post_processing: '后处理',
  stuck_retry: '卡住重试',
  content_validation_run: '内容校验·执行',
  content_validation: '内容校验·质量'
}
const stepLabel = (name: string) => STEP_LABELS[name] ?? name

// 前置校验失败：发生在「发起收藏」之前(URL 非法等)，未计入 entry，单独在入口行补充展示
const preCheckFailed = computed(() => {
  const s = stepFunnel.value?.funnel.find(item => item.step_name === 'pre_check')
  return s ? s.attempts : 0
})

watch(topError, value => {
  if (value && !visitError.value) visitError.value = value
})

onMounted(() => {
  reloadVisit()
  reloadStep()
})
</script>

<style lang="scss" scoped>
.kind-stats {
  --style: flex flex-col gap-18px;
}

.kind-card {
  --style: rounded-24px px-20px py-18px flex flex-col gap-16px;
  background: rgba(var(--slax-overlay-white-rgb), 0.68);
  border: 1px solid rgba(220, 228, 232, 0.9);
  box-shadow:
    0 8px 32px rgba(var(--slax-modal-overlay-rgb), 0.06),
    0 0 0 1px rgba(var(--slax-overlay-white-rgb), 0.85) inset;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.kind-card__header {
  --style: flex items-center justify-between gap-12px flex-wrap;
}

.kind-card__error {
  --style: flex items-center gap-12px text-(13px) text-chart-axis font-500;

  button {
    --style: rounded-full bg-chart-primary px-14px py-6px text-(12px) text-white font-600 cursor-pointer border-none;
  }
}

.kind-card__placeholder {
  --style: py-24px text-center text-(13px) text-chart-axis font-500;
}

.section-tag {
  --style: shrink-0 rounded-full px-14px py-5px text-(15px) font-700 tracking-[0.02em];
}

.section-tag--blue {
  color: #2563eb;
  background: rgba(37, 99, 235, 0.1);
  border: 1px solid rgba(37, 99, 235, 0.2);
}

.section-tag--violet {
  color: #7c3aed;
  background: rgba(124, 58, 237, 0.1);
  border: 1px solid rgba(124, 58, 237, 0.2);
}

.kind-toggle {
  --style: inline-flex items-center gap-2px rounded-full p-3px;
  background: rgba(var(--slax-modal-overlay-rgb), 0.05);
}

.kind-toggle__btn {
  --style: rounded-full px-14px py-5px text-(13px) text-chart-axis font-600 cursor-pointer border-none bg-transparent;
  transition: all 0.15s ease;

  &:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  &.is-active {
    --style: text-white;
    background: var(--slax-chart-primary);
  }
}

.kind-kpis {
  --style: 'grid grid-cols-2 gap-x-16px gap-y-14px sm:grid-cols-3';
}

.kind-kpi {
  --style: flex flex-col gap-6px min-w-0;
}

.kind-kpi__label {
  --style: text-(11px) text-chart-axis uppercase tracking-[0.1em] font-600;
}

.kind-kpi__value {
  --style: text-(26px) text-txt leading-none font-700;
}

.kind-subtitle {
  --style: block mb-10px text-(13px) text-txt font-700;
}

.kind-table-wrap {
  --style: flex flex-col;
}

.kind-table {
  --style: w-full text-(13px) text-txt;
  border-collapse: collapse;

  th {
    --style: py-8px px-8px text-left text-(11px) text-chart-axis uppercase tracking-[0.06em] font-600;
    border-bottom: 1px solid rgba(220, 228, 232, 0.9);
  }

  td {
    --style: py-9px px-8px font-500;
    border-bottom: 1px solid rgba(220, 228, 232, 0.5);
  }

  .is-num {
    --style: text-right tabular-nums;
  }

  .is-strong {
    --style: font-700;
  }
}

.kind-table__rank {
  --style: w-32px text-chart-axis;
}

.kind-table__title {
  --style: max-w-360px;

  a {
    --style: block truncate text-chart-primary font-600 no-underline;

    &:hover {
      text-decoration: underline;
    }
  }
}

.kind-meta-wrap {
  --style: mt-18px;
}

/* ── 处理漏斗（时间轴） ── */
.funnel {
  --style: relative flex flex-col list-none p-0 m-0;
}

.fstage {
  --style: relative flex gap-14px;
}

.fstage__rail {
  --style: relative shrink-0 w-28px flex justify-center;
}

.fstage__rail::before {
  content: '';
  --style: absolute top-0 bottom-0 left-1/2 w-2px;
  transform: translateX(-50%);
  background: rgba(203, 213, 220, 0.85);
}

.fstage:first-child .fstage__rail::before {
  --style: top-13px;
}

.fstage:last-child .fstage__rail::before {
  bottom: calc(100% - 13px);
}

.fstage__node {
  --style: relative z-1 inline-flex items-center justify-center w-26px h-26px rounded-full text-(12px) text-white font-700;
  background: var(--slax-chart-primary);
  box-shadow: 0 0 0 4px rgba(var(--slax-overlay-white-rgb), 0.9);
}

.fstage--entry .fstage__node {
  background: #7c3aed;
}

.fstage__body {
  --style: flex-1 min-w-0 flex flex-col gap-6px pb-20px;
}

.fstage:last-child .fstage__body {
  --style: pb-2px;
}

.fstage__top {
  --style: flex items-center gap-8px flex-wrap;
}

.fstage__name {
  --style: text-(14px) text-txt font-700;
}

.fstage__retention {
  --style: ml-auto text-(13px) text-txt font-700 tabular-nums;
}

.fstage__pill {
  --style: shrink-0 rounded-full px-9px py-2px text-(11px) font-600 tabular-nums;
}

.fstage__metrics {
  --style: flex items-baseline gap-5px;
}

.fstage__count {
  --style: text-(20px) text-txt font-700 tabular-nums leading-none;
}

.fstage__unit {
  --style: text-(12px) text-chart-axis font-600;
}

.fstage__muted {
  --style: text-(11px) text-chart-axis font-500 tabular-nums;
}

.fstage__warn {
  --style: font-600;
  color: #dc2626;
}

.fbar {
  --style: relative h-8px rounded-full overflow-hidden mt-2px;
  background: rgba(var(--slax-modal-overlay-rgb), 0.07);
}

.fbar__fill {
  --style: absolute left-0 top-0 h-full rounded-full;
  transition: width 0.4s ease;

  &.is-good {
    background: linear-gradient(90deg, #34d399, #16a34a);
  }
  &.is-warn {
    background: linear-gradient(90deg, #fbbf24, #f59e0b);
  }
  &.is-bad {
    background: linear-gradient(90deg, #f87171, #dc2626);
  }
}

.fbar__fill--entry {
  background: linear-gradient(90deg, #a78bfa, #7c3aed) !important;
}

/* 抓取来源子项 */
.fsources {
  --style: mt-8px flex flex-col gap-2px list-none p-0 m-0 rounded-12px px-12px py-6px;
  background: rgba(var(--slax-modal-overlay-rgb), 0.03);
}

.fsource {
  --style: flex items-center gap-10px py-3px;
}

.fsource__name {
  --style: w-92px shrink-0 text-(12px) text-txt font-600 truncate;
}

.fsource__track {
  --style: relative flex-1 h-5px rounded-full overflow-hidden;
  background: rgba(var(--slax-modal-overlay-rgb), 0.07);
}

.fsource__fill {
  --style: absolute left-0 top-0 h-full rounded-full;
  background: rgba(22, 185, 152, 0.55);
  transition: width 0.4s ease;
}

.fsource__count {
  --style: w-44px shrink-0 text-right text-(12px) text-txt font-600 tabular-nums;
}

.fsource__rate {
  --style: w-52px shrink-0 text-right text-(11px) font-600 tabular-nums bg-transparent;
}

.rate-text--good {
  color: #16a34a;
  background: rgba(22, 163, 74, 0.1);
}

.rate-text--warn {
  color: #d97706;
  background: rgba(245, 158, 11, 0.12);
}

.rate-text--bad {
  color: #dc2626;
  background: rgba(220, 38, 38, 0.1);
}

/* fsource__rate 复用配色但不要背景块 */
.fsource__rate.rate-text--good,
.fsource__rate.rate-text--warn,
.fsource__rate.rate-text--bad {
  background: transparent;
}

/* ── Metadata 卡片网格 ── */
.meta-grid {
  --style: 'grid grid-cols-1 gap-10px sm:grid-cols-2';
}

.meta-card {
  --style: flex flex-col gap-8px rounded-14px px-14px py-12px;
  background: rgba(var(--slax-overlay-white-rgb), 0.5);
  border: 1px solid rgba(220, 228, 232, 0.8);
}

.meta-card__top {
  --style: flex items-center justify-between gap-8px;
}

.meta-card__name {
  --style: text-(13px) text-txt font-700;
}

.meta-card__pct {
  --style: shrink-0 rounded-full px-8px py-1px text-(11px) font-700 tabular-nums;
}

.meta-card__bar {
  --style: relative h-6px rounded-full overflow-hidden;
  background: rgba(var(--slax-modal-overlay-rgb), 0.07);
}

.meta-card__fill {
  --style: absolute left-0 top-0 h-full rounded-full;
  transition: width 0.4s ease;

  &.is-good {
    background: #16a34a;
  }
  &.is-warn {
    background: #f59e0b;
  }
  &.is-bad {
    background: #dc2626;
  }
}

.meta-card__detail {
  --style: text-(11px) text-chart-axis font-500 tabular-nums;
}
</style>
