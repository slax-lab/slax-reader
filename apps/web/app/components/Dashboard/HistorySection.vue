<template>
  <div class="history-section">
    <div class="history-section__header">
      <span class="section-tag section-tag--gold">历史数据</span>

      <div class="history-section__controls">
        <div class="history-section__ranges" role="group" aria-label="历史区间选择">
          <button
            v-for="option in rangeOptions"
            :key="option.days"
            class="history-section__range-btn"
            :class="{
              'is-active': activeMode === 'preset' && selectedRange === option.days && pendingRange !== option.days,
              'is-pending': pendingRange === option.days,
              'is-dimmed': isBusy && pendingRange !== option.days
            }"
            :disabled="isBusy && pendingRange !== option.days"
            type="button"
            @click="selectRange(option.days)"
          >
            <span v-if="pendingRange === option.days" class="history-section__range-spinner" aria-hidden="true"></span>
            <template v-else>{{ option.label }}</template>
          </button>
        </div>

        <div class="history-section__custom" :class="{ 'is-loading': customPending }">
          <div class="history-section__custom-inputs">
            <DatePicker ref="startPickerRef" v-model="customStart" :disabled="customPending" @open="endPickerRef?.close()" />
            <span class="history-section__custom-sep">→</span>
            <DatePicker ref="endPickerRef" v-model="customEnd" :disabled="customPending" @open="startPickerRef?.close()" />
          </div>
          <span v-if="customPending" class="history-section__range-spinner history-section__custom-spinner" aria-hidden="true"></span>
          <button v-else-if="showCustomApply" type="button" class="history-section__custom-apply" @click="applyCustomRange">
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
              <path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" />
            </svg>
          </button>
        </div>
        <Transition name="hs-error">
          <span v-if="validationError" class="history-section__error">{{ validationError }}</span>
        </Transition>
      </div>
    </div>

    <div class="history-section__charts" v-if="activeRange.labels.length">
      <HistoryLineChart
        v-for="chart in activeRange.charts"
        :key="chart.key"
        :eyebrow="chart.eyebrow"
        :title="chart.title"
        :description="chart.description"
        :labels="activeRange.labels"
        :raw-labels="activeRange.rawLabels"
        :series="chart.series"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import DatePicker from './DatePicker.vue'
import HistoryLineChart from './HistoryLineChart.vue'

import type { HistoryRangeKey } from '~/composables/useHistoryMetrics'
import { useHistoryMetrics } from '~/composables/useHistoryMetrics'

const { rangeOptions, selectedRange, activeMode, activeRange, loadRange, loadCustomRange } = useHistoryMetrics()

const pendingRange = ref<HistoryRangeKey | null>(null)
const customPending = ref(false)
const customStart = ref('')
const customEnd = ref('')
const lastAppliedKey = ref('')
const validationError = ref('')
const startPickerRef = ref<{ close: () => void } | null>(null)
const endPickerRef = ref<{ close: () => void } | null>(null)

let errorTimer: ReturnType<typeof setTimeout> | null = null

const showValidationError = (msg: string) => {
  validationError.value = msg
  if (errorTimer) clearTimeout(errorTimer)
  errorTimer = setTimeout(() => {
    validationError.value = ''
    errorTimer = null
  }, 3000)
}

const isBusy = computed(() => pendingRange.value !== null || customPending.value)

const currentCustomKey = computed(() => (customStart.value && customEnd.value ? `${customStart.value}|${customEnd.value}` : ''))

const showCustomApply = computed(() => !!currentCustomKey.value && (currentCustomKey.value !== lastAppliedKey.value || activeMode.value !== 'custom'))

const selectRange = async (days: HistoryRangeKey) => {
  if (isBusy.value || (days === selectedRange.value && activeMode.value === 'preset')) return
  pendingRange.value = days
  try {
    await loadRange(days)
    selectedRange.value = days
    activeMode.value = 'preset'
  } catch {
    // revert: selectedRange stays unchanged, pendingRange clears
  } finally {
    pendingRange.value = null
  }
}

const applyCustomRange = async () => {
  if (customPending.value || !customStart.value || !customEnd.value) return
  if (customStart.value > customEnd.value) {
    showValidationError('开始日期不能晚于结束日期')
    return
  }
  customPending.value = true
  try {
    await loadCustomRange(customStart.value, customEnd.value)
    activeMode.value = 'custom'
    lastAppliedKey.value = currentCustomKey.value
  } catch {
    // activeMode stays unchanged — stays 'preset' or retains last custom
  } finally {
    customPending.value = false
  }
}

onMounted(() => {
  loadRange(selectedRange.value).catch(() => {})
})

onUnmounted(() => {
  if (errorTimer) clearTimeout(errorTimer)
})
</script>

<style lang="scss" scoped>
.history-section {
  --style: rounded-24px px-20px py-18px flex flex-col gap-18px;
  background: rgba(var(--slax-overlay-white-rgb), 0.68); /* glassmorphism bg; rgba needed for opacity */
  border: 1px solid rgba(220, 228, 232, 0.9); /* cold-grey border — no exact upstream token; inline acceptable */
  box-shadow:
    0 8px 32px rgba(var(--slax-modal-overlay-rgb), 0.06),
    0 0 0 1px rgba(var(--slax-overlay-white-rgb), 0.85) inset,
    0 1px 0 rgba(var(--slax-overlay-white-rgb), 1) inset;
  backdrop-filter: blur(18px);
  -webkit-backdrop-filter: blur(18px);
}

.history-section__header {
  --style: flex items-center gap-14px flex-wrap;
}

.section-tag {
  --style: rounded-full px-14px py-5px text-(15px) font-700 tracking-[0.02em] shrink-0;
}

.section-tag--gold {
  color: #c47f10; /* gold amber — no upstream token available for this brand color */
  background: rgba(var(--slax-chart-gold-rgb), 0.1);
  border: 1px solid rgba(var(--slax-chart-gold-rgb), 0.2);
  -webkit-text-stroke: 0.4px rgba(var(--slax-chart-gold-dark-rgb), 0.45);
  box-shadow:
    0 3px 10px rgba(var(--slax-chart-gold-rgb), 0.14),
    inset 0 1px 0 rgba(var(--slax-overlay-white-rgb), 0.6);
}

.history-section__controls {
  --style: flex flex-wrap items-center gap-8px;
}

.history-section__ranges {
  --style: flex flex-wrap gap-8px;
}

.history-section__range-btn {
  --style: 'inline-flex items-center justify-center min-w-52px rounded-full px-14px py-6px text-(12px) text-chart-axis font-700 transition-all duration-200';
  background: rgba(var(--slax-modal-overlay-rgb), 0.04); /* subtle dark bg; rgba needed for opacity */
  border: 1px solid rgba(var(--slax-modal-overlay-rgb), 0.08);

  &.is-active,
  &.is-pending {
    background: linear-gradient(135deg, var(--slax-chart-primary) 0%, #2fc6a4 100%); /* chart-primary gradient; #2fc6a4 is a fixed lighter shade for gradient end */
    border-color: var(--slax-chart-primary);
    color: #ffffff; /* white on accent bg */
    box-shadow: 0 6px 14px rgba(var(--slax-chart-primary-rgb), 0.22); /* chart-primary shadow; rgba needed for opacity */
  }

  &.is-dimmed {
    opacity: 0.38;
    cursor: not-allowed;
  }

  &:disabled {
    pointer-events: none;
  }
}

.history-section__range-spinner {
  display: inline-block;
  width: 12px;
  height: 12px;
  border: 2px solid rgba(255, 255, 255, 0.4); /* white with alpha on accent bg */
  border-top-color: #ffffff; /* white spinner on accent bg */
  border-radius: 50%;
  animation: range-spin 0.7s linear infinite;
}

@keyframes range-spin {
  to {
    transform: rotate(360deg);
  }
}

.history-section__custom {
  display: flex;
  align-items: center;
  gap: 8px;
  border-radius: 14px;
  border: 1px solid rgba(var(--slax-overlay-white-rgb), 0.6); /* glassmorphism border; rgba needed for opacity */
  background: rgba(var(--slax-overlay-white-rgb), 0.5);
  box-shadow: inset 0 1px 0 rgba(var(--slax-overlay-white-rgb), 0.8);
  padding: 6px 12px;
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  transition: opacity 0.15s;

  &.is-loading {
    opacity: 0.6;
  }
}

.history-section__custom-inputs {
  --style: flex items-center gap-8px;
}

.history-section__custom-sep {
  font-size: 12px;
  color: var(--slax-text-light);
  font-weight: 500;
  flex-shrink: 0;
}

.history-section__custom-spinner {
  border-color: rgba(var(--slax-chart-primary-rgb), 0.3); /* chart-primary with alpha */
  border-top-color: var(--slax-chart-primary);
  flex-shrink: 0;
}

.history-section__custom-apply {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 8px;
  border: none;
  background: var(--slax-chart-primary);
  color: #ffffff; /* white icon on accent bg */
  cursor: pointer;
  flex-shrink: 0;
  box-shadow: 0 3px 8px rgba(var(--slax-chart-primary-rgb), 0.35); /* chart-primary shadow; rgba needed for opacity */
  transition:
    background 0.15s,
    box-shadow 0.15s;

  &:hover {
    background: var(--slax-chart-primary-hover); /* chart CTA hover 深变体，见 fork.tokens.css */
    box-shadow: 0 4px 12px rgba(var(--slax-chart-primary-rgb), 0.45);
  }
}

.history-section__charts {
  --style: 'grid grid-cols-1 gap-10px md:grid-cols-2 xl:grid-cols-4';
}

.history-section__error {
  display: inline-flex;
  align-items: center;
  padding: 5px 12px;
  border-radius: 10px;
  font-size: 12px;
  font-weight: 600;
  color: var(--slax-danger);
  background: var(--slax-danger-bg);
  border: 1px solid rgba(220, 38, 38, 0.15); /* danger border; rgba needed for opacity */
  white-space: nowrap;
}

.hs-error-enter-active,
.hs-error-leave-active {
  transition:
    opacity 0.2s,
    transform 0.2s;
}

.hs-error-enter-from,
.hs-error-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}
</style>
