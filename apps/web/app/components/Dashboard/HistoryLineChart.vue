<template>
  <div ref="cardEl" class="history-line-chart" :class="{ 'is-active': isCardActive }" @click="handleCardClick">
    <div class="history-line-chart__header">
      <div class="history-line-chart__heading">
        <div class="history-line-chart__title-row">
          <h3 class="history-line-chart__title">{{ title }}</h3>
          <button v-if="description" type="button" class="history-line-chart__desc-btn" @click.stop="showDescription = !showDescription">?</button>
          <div v-if="showDescription" class="history-line-chart__desc-bubble" @click.stop>{{ description }}</div>
        </div>
      </div>
      <button type="button" class="history-line-chart__icon-btn history-line-chart__expand-btn" :aria-label="`放大查看 ${title}`" @click="isExpanded = true">
        <svg class="history-line-chart__icon" viewBox="0 0 20 20" aria-hidden="true">
          <path d="M7.5 3.5H4a.5.5 0 0 0-.5.5v3.5" />
          <path d="M12.5 3.5H16a.5.5 0 0 1 .5.5v3.5" />
          <path d="M3.5 12.5V16a.5.5 0 0 0 .5.5h3.5" />
          <path d="M16.5 12.5V16a.5.5 0 0 1-.5.5h-3.5" />
        </svg>
      </button>
    </div>

    <div class="history-line-chart__legend" v-if="series.length > 1">
      <button
        v-for="item in series"
        :key="item.key"
        type="button"
        class="history-line-chart__legend-btn"
        :class="{ 'is-active': activeSeriesKey === item.key, 'is-dimmed': activeSeriesKey !== null && activeSeriesKey !== item.key }"
        :aria-pressed="activeSeriesKey === item.key"
        @click="toggleSeries(item.key)"
      >
        <i class="history-line-chart__legend-dot" :style="{ background: item.color }"></i>
        {{ item.label }}
      </button>
    </div>

    <div class="history-line-chart__spacer"></div>
    <div
      ref="canvasEl"
      class="history-line-chart__canvas"
      @mousemove="onCanvasMouseMove"
      @mouseleave="onCanvasMouseLeave"
      @touchstart.passive="onCanvasTouchStart"
      @touchmove.passive="onCanvasTouchMove"
      @touchend.passive="onCanvasTouchEnd"
    >
      <svg :viewBox="`0 0 ${canvasWidth} ${chartViewHeight}`" preserveAspectRatio="none" role="img" :aria-label="title">
        <g>
          <line
            v-for="step in gridSteps"
            :key="`grid-${step}`"
            x1="48"
            :x2="chartRight"
            :y1="chartBottom - chartHeight * step"
            :y2="chartBottom - chartHeight * step"
            class="history-line-chart__grid"
          />
        </g>

        <g>
          <text v-for="step in gridSteps" :key="`label-${step}`" x="8" :y="chartBottom - chartHeight * step + 4" class="history-line-chart__axis-label">
            {{ formatAxisValue(maxValue * step) }}
          </text>
        </g>

        <g>
          <text v-for="point in xAxisPoints" :key="point.index" :x="point.x" y="181" text-anchor="middle" class="history-line-chart__axis-label">
            {{ point.label }}
          </text>
        </g>

        <g v-for="item in seriesPaths" :key="item.key">
          <path :d="item.area" :fill="item.areaColor" class="history-line-chart__area" />
          <path :d="item.line" :stroke="item.color" class="history-line-chart__line" />
          <template v-if="labels.length < 90">
            <circle
              v-for="point in item.points"
              :key="`${item.key}-${point.index}`"
              :cx="point.x"
              :cy="point.y"
              :r="selectedPoint?.seriesKey === point.seriesKey && selectedPoint?.index === point.index ? activePointRadius : pointRadius"
              :fill="item.color"
              :stroke-width="selectedPoint?.seriesKey === point.seriesKey && selectedPoint?.index === point.index ? pointStrokeWidth + 0.6 : pointStrokeWidth"
              class="history-line-chart__point"
              :class="{ 'is-active': selectedPoint?.seriesKey === point.seriesKey && selectedPoint?.index === point.index }"
              :aria-label="`${point.seriesLabel} ${point.label} ${formatNumber(point.value)}`"
              role="button"
              tabindex="0"
              @click="togglePoint(point)"
              @keydown.enter.prevent="togglePoint(point)"
              @keydown.space.prevent="togglePoint(point)"
            />
          </template>
        </g>

        <line v-if="crosshairX !== null" :x1="crosshairX" :x2="crosshairX" :y1="chartTop" :y2="chartBottom" class="history-line-chart__crosshair" />

        <g v-if="hoverTooltipData && !selectedPoint" class="history-line-chart__hover-tip" :transform="`translate(${hoverTooltipData.x} ${hoverTooltipData.y})`">
          <rect :width="hoverTooltipData.width" :height="hoverTooltipData.height" rx="10" ry="10" class="history-line-chart__tooltip-card" />
          <text x="12" y="15" class="history-line-chart__hover-tip-date">{{ hoverTooltipData.label }}</text>
          <text v-if="hoverTooltipData.single" x="12" y="31" class="history-line-chart__tooltip-text">{{ formatNumber(hoverTooltipData.entries[0]?.value ?? 0) }}</text>
          <g v-else v-for="(entry, i) in hoverTooltipData.entries" :key="entry.label" :transform="`translate(0 ${22 + i * 17})`">
            <circle cx="14" cy="7" r="4" :fill="entry.color" />
            <text x="24" y="11" class="history-line-chart__tooltip-text">{{ entry.label }}: {{ formatNumber(entry.value) }}</text>
          </g>
        </g>

        <g v-if="selectedPoint" class="history-line-chart__tooltip" :transform="`translate(${tooltipPosition.x} ${tooltipPosition.y})`">
          <rect width="164" height="48" rx="12" ry="12" class="history-line-chart__tooltip-card" />
          <text x="14" y="19" class="history-line-chart__tooltip-title">
            {{ selectedPoint.seriesLabel }}
          </text>
          <text x="14" y="35" class="history-line-chart__tooltip-text">{{ selectedPoint.label }} · {{ formatNumber(selectedPoint.value) }}</text>
        </g>
      </svg>
    </div>

    <Teleport to="body">
      <div v-if="isExpanded" class="history-line-chart-modal" @click="closeExpanded">
        <div class="history-line-chart-modal__panel" role="dialog" aria-modal="true" :aria-label="title" @click.stop>
          <button type="button" class="history-line-chart__icon-btn history-line-chart-modal__close" aria-label="取消" @click="closeExpanded">
            <svg class="history-line-chart__icon" viewBox="0 0 20 20" aria-hidden="true">
              <path d="M5 5l10 10" />
              <path d="M15 5L5 15" />
            </svg>
          </button>

          <div class="history-line-chart history-line-chart--modal">
            <div class="history-line-chart__header">
              <div class="history-line-chart__heading">
                <div class="history-line-chart__eyebrow">{{ eyebrow }}</div>
                <div class="history-line-chart__title-row">
                  <h3 class="history-line-chart__title">{{ title }}</h3>
                  <button v-if="description" type="button" class="history-line-chart__desc-btn" @click.stop="showDescription = !showDescription">?</button>
                  <div v-if="showDescription" class="history-line-chart__desc-bubble" @click.stop>{{ description }}</div>
                </div>
              </div>
            </div>

            <div class="history-line-chart__legend" v-if="series.length > 1">
              <button
                v-for="item in series"
                :key="`modal-${item.key}`"
                type="button"
                class="history-line-chart__legend-btn"
                :class="{ 'is-active': modalActiveSeriesKey === item.key, 'is-dimmed': modalActiveSeriesKey !== null && modalActiveSeriesKey !== item.key }"
                :aria-pressed="modalActiveSeriesKey === item.key"
                @click="toggleModalSeries(item.key)"
              >
                <i class="history-line-chart__legend-dot" :style="{ background: item.color }"></i>
                {{ item.label }}
              </button>
            </div>

            <div class="history-line-chart__spacer"></div>
            <div
              ref="modalCanvasEl"
              class="history-line-chart__canvas history-line-chart__canvas--modal"
              @mousemove="onModalCanvasMouseMove"
              @mouseleave="onModalCanvasMouseLeave"
              @touchstart.passive="onModalCanvasTouchStart"
              @touchmove.passive="onModalCanvasTouchMove"
              @touchend.passive="onModalCanvasTouchEnd"
            >
              <svg :viewBox="`0 0 ${modalCanvasWidth} ${modalCanvasHeight}`" preserveAspectRatio="none" role="img" :aria-label="title">
                <g>
                  <line
                    v-for="step in gridSteps"
                    :key="`modal-grid-${step}`"
                    x1="48"
                    :x2="modalChartRight"
                    :y1="modalChartBottom - modalChartHeight * step"
                    :y2="modalChartBottom - modalChartHeight * step"
                    class="history-line-chart__grid"
                  />
                </g>

                <g>
                  <text v-for="step in gridSteps" :key="`modal-label-${step}`" x="8" :y="modalChartBottom - modalChartHeight * step + 4" class="history-line-chart__axis-label">
                    {{ formatAxisValue(modalMaxValue * step) }}
                  </text>
                </g>

                <g>
                  <text
                    v-for="point in modalXAxisPoints"
                    :key="`modal-x-${point.index}`"
                    :x="point.x"
                    :y="modalChartBottom + 24"
                    text-anchor="middle"
                    class="history-line-chart__axis-label"
                  >
                    {{ point.label }}
                  </text>
                </g>

                <g v-for="item in modalSeriesPaths" :key="`modal-${item.key}`">
                  <path :d="item.area" :fill="item.areaColor" class="history-line-chart__area" />
                  <path :d="item.line" :stroke="item.color" class="history-line-chart__line" />
                  <template v-if="labels.length < 90">
                    <circle
                      v-for="point in item.points"
                      :key="`modal-${item.key}-${point.index}`"
                      :cx="point.x"
                      :cy="point.y"
                      :r="modalSelectedPoint?.seriesKey === point.seriesKey && modalSelectedPoint?.index === point.index ? modalActivePointRadius : modalPointRadius"
                      :fill="item.color"
                      :stroke-width="modalSelectedPoint?.seriesKey === point.seriesKey && modalSelectedPoint?.index === point.index ? pointStrokeWidth + 0.6 : pointStrokeWidth"
                      class="history-line-chart__point"
                      :class="{ 'is-active': modalSelectedPoint?.seriesKey === point.seriesKey && modalSelectedPoint?.index === point.index }"
                      :aria-label="`${point.seriesLabel} ${point.label} ${formatNumber(point.value)}`"
                      role="button"
                      tabindex="0"
                      @click="toggleModalPoint(point)"
                      @keydown.enter.prevent="toggleModalPoint(point)"
                      @keydown.space.prevent="toggleModalPoint(point)"
                    />
                  </template>
                </g>

                <line v-if="modalCrosshairX !== null" :x1="modalCrosshairX" :x2="modalCrosshairX" :y1="chartTop" :y2="modalChartBottom" class="history-line-chart__crosshair" />

                <g
                  v-if="modalHoverTooltipData && !modalSelectedPoint"
                  class="history-line-chart__hover-tip"
                  :transform="`translate(${modalHoverTooltipData.x} ${modalHoverTooltipData.y})`"
                >
                  <rect :width="modalHoverTooltipData.width" :height="modalHoverTooltipData.height" rx="10" ry="10" class="history-line-chart__tooltip-card" />
                  <text x="12" y="15" class="history-line-chart__hover-tip-date">{{ modalHoverTooltipData.label }}</text>
                  <text v-if="modalHoverTooltipData.single" x="12" y="31" class="history-line-chart__tooltip-text">
                    {{ formatNumber(modalHoverTooltipData.entries[0]?.value ?? 0) }}
                  </text>
                  <g v-else v-for="(entry, i) in modalHoverTooltipData.entries" :key="entry.label" :transform="`translate(0 ${22 + i * 17})`">
                    <circle cx="14" cy="7" r="4" :fill="entry.color" />
                    <text x="24" y="11" class="history-line-chart__tooltip-text">{{ entry.label }}: {{ formatNumber(entry.value) }}</text>
                  </g>
                </g>

                <g v-if="modalSelectedPoint" class="history-line-chart__tooltip" :transform="`translate(${modalTooltipPosition.x} ${modalTooltipPosition.y})`">
                  <rect :width="modalTooltipWidth" :height="modalTooltipHeight" rx="12" ry="12" class="history-line-chart__tooltip-card" />
                  <text x="14" y="24" class="history-line-chart__tooltip-title">
                    {{ modalSelectedPoint.seriesLabel }}
                  </text>
                  <text x="14" y="42" class="history-line-chart__tooltip-text">{{ modalSelectedPoint.label }} · {{ formatNumber(modalSelectedPoint.value) }}</text>
                </g>
              </svg>
            </div>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { useChartHoverSync } from '~/composables/useChartHoverSync'
import type { HistorySeries } from '~/composables/useHistoryMetrics'

type HistoryPoint = {
  index: number
  x: number
  y: number
  value: number
  label: string
  seriesKey: string
  seriesLabel: string
}

type TooltipPoint = HistoryPoint

const props = defineProps<{
  eyebrow: string
  title: string
  description: string
  labels: string[]
  rawLabels?: string[]
  series: HistorySeries[]
}>()

const chartLeft = 48
const chartTop = 16
const chartBottom = 160
const chartHeight = chartBottom - chartTop
const chartViewHeight = 195
const gridSteps = [0, 0.25, 0.5, 0.75, 1]

const canvasEl = ref<HTMLElement | null>(null)
const modalCanvasEl = ref<HTMLElement | null>(null)
const canvasWidth = ref(720)
const modalCanvasWidth = ref(720)
const modalCanvasHeight = ref(260)

const chartRight = computed(() => Math.max(canvasWidth.value - 28, 200))
const chartWidth = computed(() => chartRight.value - chartLeft)
const modalChartRight = computed(() => Math.max(modalCanvasWidth.value - 28, 200))
const modalChartWidth = computed(() => modalChartRight.value - chartLeft)
const modalChartBottom = computed(() => Math.max(modalCanvasHeight.value - 60, chartTop + 10))
const modalChartHeight = computed(() => modalChartBottom.value - chartTop)
const tooltipWidth = 164
const tooltipHeight = 48
const modalTooltipWidth = 180
const modalTooltipHeight = 56

const labelsForWidth = (w: number) => {
  if (w >= 600) return 7
  if (w >= 400) return 5
  if (w >= 280) return 4
  return 3
}

const maxXAxisLabels = computed(() => labelsForWidth(canvasWidth.value))
const modalMaxXAxisLabels = computed(() => labelsForWidth(modalCanvasWidth.value))

const cardEl = ref<HTMLElement | null>(null)
const isCardActive = ref(false)
const isExpanded = ref(false)
const showDescription = ref(false)

const activateCard = () => {
  isCardActive.value = true
}

const handleCardClick = () => {
  activateCard()
  showDescription.value = false
}

const handleDocumentClick = (e: MouseEvent) => {
  if (cardEl.value && !cardEl.value.contains(e.target as Node)) {
    isCardActive.value = false
    showDescription.value = false
  }
}

let canvasObserver: ResizeObserver | null = null
const modalCanvasObserver = ref<ResizeObserver | null>(null)

onMounted(() => {
  document.addEventListener('click', handleDocumentClick)

  canvasObserver = new ResizeObserver(entries => {
    const w = entries[0]?.contentRect.width
    if (w && w > 0) canvasWidth.value = w
  })
  if (canvasEl.value) canvasObserver.observe(canvasEl.value)
})

onUnmounted(() => {
  document.removeEventListener('click', handleDocumentClick)
  canvasObserver?.disconnect()
  modalCanvasObserver.value?.disconnect()
})
const activeSeriesKey = ref<string | null>(null)
const selectedPoint = ref<TooltipPoint | null>(null)

const { sharedHoverIndex, setIndex: setHoverIndex, clearIndex: clearHoverIndex } = useChartHoverSync()
const hoverIndex = sharedHoverIndex

const modalActiveSeriesKey = ref<string | null>(null)
const modalSelectedPoint = ref<TooltipPoint | null>(null)
const modalHoverIndex = ref<number | null>(null)

const pointRadius = computed(() => {
  if (props.labels.length >= 300) {
    return 1.4
  }

  if (props.labels.length >= 90) {
    return 2.0
  }

  if (props.labels.length >= 30) {
    return 2.8
  }

  return 4.0
})

const activePointRadius = computed(() => {
  return pointRadius.value + 1
})

const modalPointRadius = computed(() => pointRadius.value * 1.1)
const modalActivePointRadius = computed(() => modalPointRadius.value + 0.6)

const pointStrokeWidth = computed(() => {
  if (props.labels.length >= 90) {
    return 0
  }

  if (props.labels.length >= 30) {
    return 1.8
  }

  return 2.0
})

const visibleSeries = computed(() => {
  if (activeSeriesKey.value === null) {
    return props.series
  }

  return props.series.filter(item => item.key === activeSeriesKey.value)
})

const modalVisibleSeries = computed(() => {
  if (modalActiveSeriesKey.value === null) {
    return props.series
  }

  return props.series.filter(item => item.key === modalActiveSeriesKey.value)
})

const snapToDiv4 = (rawMax: number) => {
  if (rawMax <= 0) return 4
  const magnitude = 10 ** Math.floor(Math.log10(rawMax))
  const rounded = Math.ceil(rawMax / magnitude) * magnitude
  return Math.ceil(rounded / 4) * 4
}

const maxValue = computed(() => {
  const values = visibleSeries.value.flatMap(item => item.values)
  return snapToDiv4(Math.max(...values, 0))
})

const modalMaxValue = computed(() => {
  const values = modalVisibleSeries.value.flatMap(item => item.values)
  return snapToDiv4(Math.max(...values, 0))
})

const xAxisPoints = computed(() => {
  const count = Math.max(props.labels.length - 1, 1)
  const interval = props.labels.length <= maxXAxisLabels.value ? 1 : Math.ceil(props.labels.length / maxXAxisLabels.value)

  return props.labels.map((label, index) => ({
    index,
    label: index === props.labels.length - 1 || index % interval === 0 ? label : '',
    x: chartLeft + chartWidth.value * (index / count)
  }))
})

const modalXAxisPoints = computed(() => {
  const count = Math.max(props.labels.length - 1, 1)
  const interval = props.labels.length <= modalMaxXAxisLabels.value ? 1 : Math.ceil(props.labels.length / modalMaxXAxisLabels.value)

  return props.labels.map((label, index) => ({
    index,
    label: index === props.labels.length - 1 || index % interval === 0 ? label : '',
    x: chartLeft + modalChartWidth.value * (index / count)
  }))
})

const toPointY = (value: number) => {
  return chartBottom - (value / maxValue.value) * chartHeight
}

const toModalPointY = (value: number) => {
  return modalChartBottom.value - (value / modalMaxValue.value) * modalChartHeight.value
}

const buildLinePath = (points: Array<{ x: number; y: number }>) => {
  return points.map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`).join(' ')
}

const buildAreaPath = (points: Array<{ x: number; y: number }>, bottom: number) => {
  const line = buildLinePath(points)
  const last = points[points.length - 1]
  const first = points[0]
  if (!last || !first) return line
  return `${line} L ${last.x} ${bottom} L ${first.x} ${bottom} Z`
}

const seriesPaths = computed(() => {
  return visibleSeries.value.map(item => {
    const points: HistoryPoint[] = item.values.map((value, index) => ({
      index,
      value,
      label: props.labels[index] || '',
      seriesKey: item.key,
      seriesLabel: item.label,
      x: xAxisPoints.value[index]?.x || chartLeft,
      y: toPointY(value)
    }))

    return {
      key: item.key,
      color: item.color,
      areaColor: `${item.color}20`,
      line: buildLinePath(points),
      area: buildAreaPath(points, chartBottom),
      points
    }
  })
})

const modalSeriesPaths = computed(() => {
  return modalVisibleSeries.value.map(item => {
    const points: HistoryPoint[] = item.values.map((value, index) => ({
      index,
      value,
      label: props.labels[index] || '',
      seriesKey: item.key,
      seriesLabel: item.label,
      x: modalXAxisPoints.value[index]?.x || chartLeft,
      y: toModalPointY(value)
    }))

    return {
      key: item.key,
      color: item.color,
      areaColor: `${item.color}20`,
      line: buildLinePath(points),
      area: buildAreaPath(points, modalChartBottom.value),
      points
    }
  })
})

const tooltipPosition = computed(() => {
  if (!selectedPoint.value) {
    return { x: chartLeft, y: chartTop }
  }

  const x = Math.min(Math.max(selectedPoint.value.x - tooltipWidth / 2, chartLeft), chartRight.value - tooltipWidth)
  const y = selectedPoint.value.y <= chartTop + tooltipHeight + 12 ? selectedPoint.value.y + 14 : selectedPoint.value.y - tooltipHeight - 10

  return {
    x,
    y: Math.min(Math.max(y, chartTop), chartBottom - tooltipHeight)
  }
})

const modalTooltipPosition = computed(() => {
  if (!modalSelectedPoint.value) {
    return { x: chartLeft, y: chartTop }
  }

  const x = Math.min(Math.max(modalSelectedPoint.value.x - modalTooltipWidth / 2, chartLeft), modalChartRight.value - modalTooltipWidth)
  const y = modalSelectedPoint.value.y <= chartTop + modalTooltipHeight + 12 ? modalSelectedPoint.value.y + 10 : modalSelectedPoint.value.y - modalTooltipHeight - 8

  return {
    x,
    y: Math.min(Math.max(y, chartTop), modalChartBottom.value - modalTooltipHeight)
  }
})

const crosshairX = computed(() => {
  if (hoverIndex.value === null) return null
  return xAxisPoints.value[hoverIndex.value]?.x ?? null
})

const modalCrosshairX = computed(() => {
  if (modalHoverIndex.value === null) return null
  return modalXAxisPoints.value[modalHoverIndex.value]?.x ?? null
})

const HOVER_TIP_W = 152
const HOVER_TIP_ROW_H = 17

const buildHoverTipEntries = (paths: typeof seriesPaths.value, idx: number) =>
  paths.map(item => ({
    color: item.color,
    label: props.series.find(s => s.key === item.key)?.label ?? '',
    value: props.series.find(s => s.key === item.key)?.values[idx] ?? 0
  }))

const formatTooltipDate = (idx: number) => {
  const raw = props.rawLabels?.[idx]
  return raw ? raw.replace(/-/g, '/') : (props.labels[idx] ?? '')
}

const hoverTooltipData = computed(() => {
  if (crosshairX.value === null || hoverIndex.value === null) return null
  const idx = hoverIndex.value
  const entries = buildHoverTipEntries(seriesPaths.value, idx)
  const height = entries.length === 1 ? 40 : 22 + entries.length * HOVER_TIP_ROW_H + 8
  const cx = crosshairX.value
  const x = Math.min(Math.max(cx - HOVER_TIP_W / 2, chartLeft), chartRight.value - HOVER_TIP_W)
  return { label: formatTooltipDate(idx), x, y: chartTop + 4, width: HOVER_TIP_W, height, entries, single: entries.length === 1 }
})

const modalHoverTooltipData = computed(() => {
  if (modalCrosshairX.value === null || modalHoverIndex.value === null) return null
  const idx = modalHoverIndex.value
  const entries = buildHoverTipEntries(modalSeriesPaths.value, idx)
  const height = entries.length === 1 ? 40 : 22 + entries.length * HOVER_TIP_ROW_H + 8
  const cx = modalCrosshairX.value
  const x = Math.min(Math.max(cx - HOVER_TIP_W / 2, chartLeft), modalChartRight.value - HOVER_TIP_W)
  return { label: formatTooltipDate(idx), x, y: chartTop + 4, width: HOVER_TIP_W, height, entries, single: entries.length === 1 }
})

const resolveDataIndex = (clientX: number, el: HTMLElement, axisPoints: Array<{ x: number }>, totalWidth: number) => {
  const rect = el.getBoundingClientRect()
  const relX = clientX - rect.left
  const svgX = (relX / rect.width) * totalWidth
  let nearest = 0
  let minDist = Infinity
  axisPoints.forEach((pt, i) => {
    const d = Math.abs(pt.x - svgX)
    if (d < minDist) {
      minDist = d
      nearest = i
    }
  })
  return nearest
}

const onCanvasMouseMove = (e: MouseEvent) => {
  if (!canvasEl.value || !xAxisPoints.value.length) return
  setHoverIndex(resolveDataIndex(e.clientX, canvasEl.value, xAxisPoints.value, canvasWidth.value))
}

const onCanvasMouseLeave = () => {
  clearHoverIndex()
}

const onCanvasTouchStart = (e: TouchEvent) => {
  if (!canvasEl.value || !xAxisPoints.value.length || !e.touches[0]) return
  setHoverIndex(resolveDataIndex(e.touches[0].clientX, canvasEl.value, xAxisPoints.value, canvasWidth.value))
}

const onCanvasTouchMove = (e: TouchEvent) => {
  if (!canvasEl.value || !xAxisPoints.value.length || !e.touches[0]) return
  setHoverIndex(resolveDataIndex(e.touches[0].clientX, canvasEl.value, xAxisPoints.value, canvasWidth.value))
}

const onCanvasTouchEnd = () => {
  clearHoverIndex()
}

const onModalCanvasMouseMove = (e: MouseEvent) => {
  if (!modalCanvasEl.value || !modalXAxisPoints.value.length) return
  modalHoverIndex.value = resolveDataIndex(e.clientX, modalCanvasEl.value, modalXAxisPoints.value, modalCanvasWidth.value)
}

const onModalCanvasMouseLeave = () => {
  modalHoverIndex.value = null
}

const onModalCanvasTouchStart = (e: TouchEvent) => {
  if (!modalCanvasEl.value || !modalXAxisPoints.value.length || !e.touches[0]) return
  modalHoverIndex.value = resolveDataIndex(e.touches[0].clientX, modalCanvasEl.value, modalXAxisPoints.value, modalCanvasWidth.value)
}

const onModalCanvasTouchMove = (e: TouchEvent) => {
  if (!modalCanvasEl.value || !modalXAxisPoints.value.length || !e.touches[0]) return
  modalHoverIndex.value = resolveDataIndex(e.touches[0].clientX, modalCanvasEl.value, modalXAxisPoints.value, modalCanvasWidth.value)
}

const onModalCanvasTouchEnd = () => {
  modalHoverIndex.value = null
}

const toggleSeries = (key: string) => {
  activeSeriesKey.value = activeSeriesKey.value === key ? null : key
}

const toggleModalSeries = (key: string) => {
  modalActiveSeriesKey.value = modalActiveSeriesKey.value === key ? null : key
}

const togglePoint = (point: TooltipPoint) => {
  selectedPoint.value = selectedPoint.value?.seriesKey === point.seriesKey && selectedPoint.value?.index === point.index ? null : point
}

const toggleModalPoint = (point: TooltipPoint) => {
  modalSelectedPoint.value = modalSelectedPoint.value?.seriesKey === point.seriesKey && modalSelectedPoint.value?.index === point.index ? null : point
}

const closeExpanded = () => {
  isExpanded.value = false
}

watch(visibleSeries, series => {
  if (!selectedPoint.value) {
    return
  }

  const stillVisible = series.some(item => item.key === selectedPoint.value?.seriesKey)
  if (!stillVisible) {
    selectedPoint.value = null
  }
})

watch(modalVisibleSeries, series => {
  if (!modalSelectedPoint.value) {
    return
  }

  const stillVisible = series.some(item => item.key === modalSelectedPoint.value?.seriesKey)
  if (!stillVisible) {
    modalSelectedPoint.value = null
  }
})

watch(isExpanded, async expanded => {
  if (!expanded) {
    selectedPoint.value = null
    modalSelectedPoint.value = null
    modalActiveSeriesKey.value = null
    modalCanvasObserver.value?.disconnect()
    modalCanvasObserver.value = null
    return
  }

  await nextTick()
  if (modalCanvasEl.value) {
    modalCanvasObserver.value = new ResizeObserver(entries => {
      const rect = entries[0]?.contentRect
      if (rect) {
        if (rect.width > 0) modalCanvasWidth.value = rect.width
        if (rect.height > 0) modalCanvasHeight.value = rect.height
      }
    })
    modalCanvasObserver.value.observe(modalCanvasEl.value)
  }
})

const formatAxisValue = (value: number) => {
  if (value >= 1_000_000) return `${Math.round(value / 1_000_000)}M`
  if (value >= 1000) return `${Math.round(value / 1000)}k`
  return `${Math.round(value)}`
}

const formatNumber = (value: number) => {
  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
    maximumFractionDigits: Number.isInteger(value) ? 0 : 2
  }).format(value)
}
</script>

<style lang="scss" scoped>
.history-line-chart {
  --style: px-4px py-8px flex flex-col;
}

.history-line-chart--modal {
  --style: rounded-28px px-28px py-24px;
  background: var(--slax-surface-solid);
  border: 1px solid rgba(var(--slax-chart-primary-rgb), 0.12); /* chart-primary border with opacity */
  box-shadow: 0 24px 80px rgba(15, 20, 25, 0.22);
}

.history-line-chart__header {
  --style: flex items-center justify-between gap-12px;
}

.history-line-chart__heading {
  --style: min-w-0 flex-1;
}

.history-line-chart__eyebrow {
  display: none;
}

.history-line-chart__title {
  --style: mt-0 mb-0 text-(18px) text-txt line-height-24px font-700;
}

.history-line-chart__title-row {
  --style: relative flex items-center gap-6px;
}

.history-line-chart__desc-btn {
  --style: inline-flex h-18px w-18px shrink-0 items-center justify-center rounded-full border-none text-(10px) text-white font-700 leading-none;
  background: var(--slax-text-light);
  transition: background 0.15s ease;

  &:hover {
    background: var(--slax-text-muted);
  }
}

.history-line-chart__desc-bubble {
  position: absolute;
  top: calc(100% + 8px);
  left: 0;
  z-index: 20;
  width: 320px;
  padding: 10px 12px;
  border-radius: 12px;
  font-size: 12px;
  line-height: 1.55;
  color: rgba(255, 255, 255, 0.9); /* white with alpha — tooltip on dark overlay */
  background: rgba(15, 20, 25, 0.88); /* dark overlay background */
  box-shadow: 0 8px 24px rgba(15, 20, 25, 0.22);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  white-space: pre-line;
}

.history-line-chart__legend {
  --style: mt-12px flex flex-wrap items-center justify-start gap-x-10px gap-y-4px;
}

.history-line-chart__legend-btn {
  --style: inline-flex items-center gap-6px whitespace-nowrap rounded-full border-none bg-transparent px-10px py-6px text-(11px) text-chart-axis font-600 transition-all
    duration-200;
}

.history-line-chart__legend-btn.is-active {
  color: var(--slax-text);
  background: rgba(255, 255, 255, 0.92); /* light surface bg with alpha */
  box-shadow: 0 4px 18px rgba(15, 20, 25, 0.08);
}

.history-line-chart__legend-btn.is-dimmed {
  opacity: 0.48;
}

.history-line-chart__legend-btn:hover {
  color: var(--slax-text);
}

.history-line-chart__legend-btn:focus-visible {
  outline: 2px solid rgba(var(--slax-chart-primary-rgb), 0.45); /* chart-primary focus ring; rgba needed for opacity */
  outline-offset: 2px;
}

.history-line-chart__legend-dot,
.history-line-chart__summary-dot {
  --style: inline-block h-8px w-8px rounded-full shrink-0;
}

.history-line-chart__metric {
  --style: flex flex-col items-end gap-2px shrink-0;

  strong {
    --style: text-(20px) text-txt line-height-none font-700;
  }

  span {
    --style: text-(11px) text-chart-axis font-600;
  }
}

.history-line-chart__spacer {
  flex: 1;
  min-height: 14px;
}

.history-line-chart__canvas {
  --style: h-195px w-full overflow-hidden rounded-18px;
  background: linear-gradient(180deg, rgba(var(--slax-chart-primary-rgb), 0.14) 0%, rgba(255, 255, 255, 0.1) 100%); /* chart-primary gradient bg; rgba needed for opacity */
  background-size: 200% 200%;
  animation: history-chart-glow 4s ease-in-out infinite alternate;
}

.history-line-chart__canvas svg {
  display: block;
  width: 100%;
  height: 100%;
}

.history-line-chart__canvas--modal {
  --style: h-[78vh];

  .history-line-chart__axis-label {
    font-size: 14px;
  }

  .history-line-chart__tooltip-title {
    font-size: 15px;
  }

  .history-line-chart__tooltip-text {
    font-size: 13px;
  }
}

.history-line-chart__crosshair {
  stroke: rgba(15, 20, 25, 0.22); /* dark crosshair stroke; rgba needed for opacity */
  stroke-width: 1;
  stroke-dasharray: 4 3;
  pointer-events: none;
}

.history-line-chart__hover-tip-date {
  fill: rgba(255, 255, 255, 0.65); /* white with alpha on dark tooltip */
  font-size: 10px;
  font-weight: 600;
}

.history-line-chart__grid {
  stroke: rgba(15, 20, 25, 0.08); /* dark grid stroke; rgba needed for opacity */
  stroke-width: 1;
  stroke-dasharray: 4 4;
}

.history-line-chart__axis-label {
  fill: var(--slax-chart-axis);
  font-size: 11px;
  font-weight: 600;
}

.history-line-chart__area {
  opacity: 1;
}

.history-line-chart__line {
  fill: none;
  stroke-width: 3;
  stroke-linecap: round;
  stroke-linejoin: round;
}

.history-line-chart__point {
  cursor: pointer;
  stroke: rgba(255, 255, 255, 0.9); /* white stroke with alpha for dot outline */
  transition:
    r 0.18s ease,
    stroke-width 0.18s ease,
    transform 0.18s ease;
}

.history-line-chart__point:hover,
.history-line-chart__point.is-active {
  stroke: rgba(15, 20, 25, 0.9); /* dark stroke with alpha for active state */
}

.history-line-chart__tooltip-card {
  fill: rgba(15, 20, 25, 0.9); /* dark tooltip background */
  stroke: rgba(255, 255, 255, 0.12); /* subtle white border */
  stroke-width: 1;
}

.history-line-chart__tooltip-title {
  fill: #ffffff; /* white text on dark tooltip */
  font-size: 11px;
  font-weight: 700;
}

.history-line-chart__tooltip-text {
  fill: rgba(255, 255, 255, 0.82); /* slightly muted white on dark tooltip */
  font-size: 10px;
  font-weight: 600;
}

.history-line-chart__expand-btn {
  opacity: 0;
  pointer-events: none;
  transition: opacity 0.18s ease;
  flex-shrink: 0;
}

.history-line-chart:hover .history-line-chart__expand-btn,
.history-line-chart.is-active .history-line-chart__expand-btn {
  opacity: 1;
  pointer-events: auto;
}

.history-line-chart__icon-btn {
  --style: inline-flex h-36px w-36px items-center justify-center rounded-13px border-none transition-all duration-200;
  background: rgba(15, 20, 25, 0.55); /* dark overlay bg; rgba needed for opacity */
  color: #ffffff; /* white icon on dark overlay */
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);

  &:hover {
    background: rgba(15, 20, 25, 0.72);
    box-shadow: 0 8px 24px rgba(15, 20, 25, 0.3);
  }
}

.history-line-chart__icon {
  display: block;
  width: 16px;
  height: 16px;
  color: currentColor;

  path {
    fill: none;
    stroke: currentColor;
    stroke-width: 2.2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
}

.history-line-chart-modal {
  position: fixed;
  inset: 0;
  z-index: 80;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 12px;
  background: rgba(15, 20, 25, 0.32); /* dark modal overlay; rgba needed for opacity */
}

.history-line-chart-modal__panel {
  position: relative;
  width: calc(100% - 24px);
}

.history-line-chart-modal__close {
  position: absolute;
  top: 18px;
  right: 18px;
  z-index: 1;
}

@keyframes history-chart-glow {
  0% {
    background-position: 0% 0%;
  }
  100% {
    background-position: 100% 100%;
  }
}

.history-line-chart__footer {
  --style: 'mt-12px grid grid-cols-1 gap-8px md:grid-cols-2 xl:grid-cols-3';
}

.history-line-chart__summary {
  --style: rounded-14px px-12px py-10px flex flex-col gap-4px;
  background: rgba(255, 255, 255, 0.7); /* glassmorphism bg; rgba needed for opacity */
  border: 1px solid rgba(255, 255, 255, 0.55);
}

.history-line-chart__summary-label {
  --style: flex items-center gap-6px text-(12px) text-chart-axis font-600;
}

.history-line-chart__summary strong {
  --style: text-(16px) text-txt font-700;
}

.history-line-chart__summary span {
  --style: text-(11px) text-chart-primary font-600;
}
</style>
