<template>
  <div class="dashboard-client">
    <div class="dashboard-shell">
      <template v-if="loading">
        <div class="dashboard-loading">
          <div class="i-svg-spinners:90-ring dashboard-loading__spinner"></div>
          <span>数据加载中…</span>
        </div>
      </template>

      <template v-else>
        <div class="dashboard-body">
          <Transition name="opacity" mode="out-in">
            <div class="dashboard-state dashboard-state--error" v-if="errorMessage">
              <span>{{ errorMessage }}</span>
              <button @click="load">重试</button>
            </div>

            <div v-else class="dashboard-content">
              <section class="dashboard-panel" data-testid="dashboard-today-panel">
                <section class="metrics-banner" v-if="summaryCards.length">
                  <span class="section-tag section-tag--emerald">今日数据</span>
                  <div class="metrics-banner__grid">
                    <div class="metrics-banner__item" v-for="card in summaryCards" :key="card.key">
                      <div class="metrics-banner__label-row">
                        <span class="metrics-banner__label">{{ card.title }}</span>
                        <button
                          v-if="card.description"
                          :ref="el => setDescBtnRef(card.key, el as HTMLElement | null)"
                          type="button"
                          class="metrics-banner__desc-btn"
                          @click.stop="toggleDescription(card.key)"
                        >
                          ?
                        </button>
                      </div>
                      <strong class="metrics-banner__value" :class="{ 'metrics-banner__value--multi': card.displayValue }">{{
                        card.displayValue ?? formatNumber(card.value)
                      }}</strong>
                    </div>
                  </div>
                  <Teleport to="body">
                    <div v-if="activeDescription" class="metrics-banner__desc-bubble-floating" :style="bubbleStyle" @click.stop>
                      {{ activeDescription }}
                    </div>
                  </Teleport>
                </section>
              </section>

              <section class="dashboard-panel dashboard-panel--history" data-testid="dashboard-history-panel">
                <HistorySection />
              </section>

              <section class="dashboard-panel" data-testid="dashboard-kind-stats-panel">
                <KindStatsSection />
              </section>

              <div class="dashboard-brand">
                <NuxtLink to="/bookmarks" class="dashboard-brand__logo-link" target="_blank" rel="noopener noreferrer">
                  <img class="dashboard-brand__logo" src="/icon.png" alt="Slax Reader logo" />
                </NuxtLink>
              </div>
            </div>
          </Transition>
        </div>
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import HistorySection from './HistorySection.vue'
import KindStatsSection from './KindStatsSection.vue'

import { useDashboardMetrics } from '~/composables/useDashboardMetrics'

const { loading, errorMessage, summaryCards, load } = useDashboardMetrics()

const openDescriptionKey = ref<string | null>(null)
const descBtnRefs = new Map<string, HTMLElement>()
const bubbleStyle = ref<Record<string, string>>({})

const BUBBLE_WIDTH = 320

const setDescBtnRef = (key: string, el: HTMLElement | null) => {
  if (el) {
    descBtnRefs.set(key, el)
  } else {
    descBtnRefs.delete(key)
  }
}

const activeDescription = computed(() => {
  if (!openDescriptionKey.value) return ''
  const card = summaryCards.value.find(item => item.key === openDescriptionKey.value)
  return card?.description ?? ''
})

const updateBubblePosition = () => {
  if (!openDescriptionKey.value) return
  const btn = descBtnRefs.get(openDescriptionKey.value)
  if (!btn) return
  const rect = btn.getBoundingClientRect()
  const viewportPadding = 12
  const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - BUBBLE_WIDTH - viewportPadding))
  bubbleStyle.value = {
    position: 'fixed',
    top: `${rect.bottom + 8}px`,
    left: `${left}px`,
    width: `${BUBBLE_WIDTH}px`,
    zIndex: '9999'
  }
}

const toggleDescription = async (key: string) => {
  openDescriptionKey.value = openDescriptionKey.value === key ? null : key
  if (openDescriptionKey.value) {
    await nextTick()
    updateBubblePosition()
  }
}

const handleDocumentClick = () => {
  openDescriptionKey.value = null
}

const handleReposition = () => {
  updateBubblePosition()
}

onMounted(() => {
  load()
  document.addEventListener('click', handleDocumentClick)
  window.addEventListener('scroll', handleReposition, true)
  window.addEventListener('resize', handleReposition)
})

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick)
  window.removeEventListener('scroll', handleReposition, true)
  window.removeEventListener('resize', handleReposition)
})

const formatNumber = (value: number) => {
  return new Intl.NumberFormat('en-US').format(value)
}
</script>

<style lang="scss" scoped>
.dashboard-client {
  --style: w-full;
}

.dashboard-shell {
  --style: 'max-w-1600px px-20px pb-24px md:px-32px';
  margin-left: auto;
  margin-right: auto;
}

.dashboard-loading {
  --style: min-h-[70vh] flex flex-col items-center justify-center gap-18px text-(16px) text-chart-axis font-500;
}

.dashboard-loading__spinner {
  --style: text-64px color-chart-primary;
}

.dashboard-body {
  --style: mt-0;
}

.dashboard-content {
  --style: mt-18px flex flex-col gap-18px;
}

.dashboard-panel {
  --style: flex flex-col gap-10px;
}

.dashboard-panel--history {
  --style: pt-6px;
}

.dashboard-state {
  --style: mt-20px rounded-24px px-24px py-40px flex flex-col items-center gap-12px text-(14px) text-chart-axis font-500;
  background: rgba(var(--slax-overlay-white-rgb), 0.75);
  border: 1px solid rgba(var(--slax-overlay-white-rgb), 0.65);
  box-shadow: 0 8px 32px rgba(var(--slax-modal-overlay-rgb), 0.06);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
}

.dashboard-state--error {
  button {
    --style: mt-4px rounded-full bg-chart-primary px-16px py-8px text-(13px) text-white font-600;
  }
}

.metrics-banner {
  --style: rounded-24px px-20px py-18px flex items-center gap-20px;
  background: rgba(var(--slax-overlay-white-rgb), 0.68);
  border: 1px solid rgba(220, 228, 232, 0.9); /* cold-grey border — no exact upstream token; inline acceptable */
  box-shadow:
    0 8px 32px rgba(var(--slax-modal-overlay-rgb), 0.06),
    0 0 0 1px rgba(var(--slax-overlay-white-rgb), 0.85) inset,
    0 1px 0 rgba(var(--slax-overlay-white-rgb), 1) inset;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.metrics-banner__grid {
  --style: 'flex-1 min-w-0 grid grid-cols-2 gap-x-16px gap-y-14px sm:grid-cols-4 xl:grid-cols-8';
}

.metrics-banner__item {
  --style: flex flex-col gap-6px min-w-0;
}

.metrics-banner__label-row {
  --style: relative flex items-center gap-6px;
}

.metrics-banner__label {
  --style: text-(11px) text-chart-axis uppercase tracking-[0.1em] font-600;
}

.metrics-banner__desc-btn {
  --style: inline-flex h-16px w-16px shrink-0 items-center justify-center rounded-full border-none text-(10px) text-white font-700 leading-none cursor-pointer;
  background: var(--slax-text-light);
  transition: background 0.15s ease;

  &:hover {
    background: var(--slax-text-muted);
  }
}

.metrics-banner__value {
  --style: text-(26px) text-txt leading-none font-700;
}

.metrics-banner__value--multi {
  font-size: 16px;
  letter-spacing: -0.01em;
}

.section-tag {
  --style: shrink-0 rounded-full px-14px py-5px text-(15px) font-700 tracking-[0.02em];
  align-self: center;
}

.section-tag--emerald {
  color: var(--slax-chart-primary);
  background: rgba(var(--slax-chart-primary-rgb), 0.1); /* chart-primary tinted bg; rgba needed for cross-theme opacity */
  border: 1px solid rgba(var(--slax-chart-primary-rgb), 0.2);
  -webkit-text-stroke: 0.4px rgba(var(--slax-chart-primary-rgb), 0.5);
  box-shadow:
    0 3px 10px rgba(var(--slax-chart-primary-rgb), 0.15),
    inset 0 1px 0 rgba(var(--slax-overlay-white-rgb), 0.6);
}

.dashboard-brand {
  --style: flex items-center justify-center gap-12px pt-8px pb-28px;
}

.dashboard-brand__logo-link {
  --style: inline-flex shrink-0 rounded-10px;
  box-shadow: 0 8px 20px rgba(var(--slax-chart-primary-rgb), 0.18); /* chart-primary glow; rgba needed for opacity */
  transition: opacity 0.15s ease;

  &:hover {
    opacity: 0.8;
  }
}

.dashboard-brand__logo {
  --style: h-32px w-32px block rounded-10px;
}
</style>

<style lang="scss" scoped>
:global(.metrics-banner__desc-bubble-floating) {
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.55;
  color: rgba(var(--slax-overlay-white-rgb), 0.92); /* white with alpha — tooltip on dark overlay */
  background: rgba(var(--slax-modal-overlay-rgb), 0.88); /* dark overlay background */
  box-shadow: 0 8px 24px rgba(var(--slax-modal-overlay-rgb), 0.22);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  white-space: pre-line;
}
</style>
