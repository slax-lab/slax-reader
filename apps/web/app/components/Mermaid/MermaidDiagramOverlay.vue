<template>
  <Teleport to="body">
    <div
      class="mermaid-overlay"
      role="dialog"
      aria-modal="true"
      :aria-label="$t('component.mermaid_diagram_overlay.aria_label')"
      @click.self="close"
      @wheel.prevent="onWheel"
    >
      <div class="mermaid-overlay-toolbar">
        <button class="mermaid-overlay-btn" :title="$t('component.mermaid_diagram_overlay.zoom_out')" :aria-label="$t('component.mermaid_diagram_overlay.zoom_out')" @click="zoomBy(1 / ZOOM_STEP)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M5 12h14" /></svg>
        </button>
        <span class="mermaid-overlay-scale">{{ scalePercent }}</span>
        <button class="mermaid-overlay-btn" :title="$t('component.mermaid_diagram_overlay.zoom_in')" :aria-label="$t('component.mermaid_diagram_overlay.zoom_in')" @click="zoomBy(ZOOM_STEP)">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M12 5v14M5 12h14" /></svg>
        </button>
        <button class="mermaid-overlay-reset" @click="resetView">{{ $t('component.mermaid_diagram_overlay.reset') }}</button>
        <span class="mermaid-overlay-hint">{{ $t('component.mermaid_diagram_overlay.hint') }}</span>
        <button class="mermaid-overlay-btn" :title="$t('component.mermaid_diagram_overlay.close')" :aria-label="$t('component.mermaid_diagram_overlay.close')" @click="close">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>

      <div
        ref="canvas"
        class="mermaid-overlay-canvas"
        :class="{ 'mermaid-overlay-canvas--unsized': hasNoSize }"
        :style="canvasStyle"
        v-html="svg"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @click.stop
      />
    </div>
  </Teleport>
</template>

<script lang="ts" setup>
import { computed, onMounted, onUnmounted, ref } from 'vue'

const ZOOM_STEP = 1.25
const MIN_SCALE = 0.1
const MAX_SCALE = 8
// Keeps a fitted diagram clear of the toolbar and the window edges.
const FIT_MARGIN = 96

defineProps<{
  svg: string
}>()

const emits = defineEmits<{ close: [] }>()

const canvas = ref<HTMLDivElement>()
const diagramSize = ref({ width: 0, height: 0 })
const fitScale = ref(1)
const scale = ref(1)
const offset = ref({ x: 0, y: 0 })

let dragOrigin: { x: number; y: number; offsetX: number; offsetY: number } | null = null

const hasNoSize = computed(() => diagramSize.value.width <= 0 || diagramSize.value.height <= 0)
const scalePercent = computed(() => `${Math.round(scale.value * 100)}%`)

const canvasStyle = computed(() => {
  const pan = `translate(-50%, -50%) translate(${offset.value.x}px, ${offset.value.y}px)`
  if (hasNoSize.value) {
    return { transform: `${pan} scale(${scale.value})` }
  }
  return { width: `${diagramSize.value.width * scale.value}px`, height: `${diagramSize.value.height * scale.value}px`, transform: pan }
})

const clampScale = (value: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, value))

// SVG attributes are case-sensitive (viewBox), but an svg string may have been
// parsed or serialized by an HTML parser that lowercases them.
const readAttribute = (element: Element | null | undefined, name: string) =>
  element?.getAttribute(name) ?? element?.getAttribute(name.toLowerCase()) ?? ''

// The rendered svg carries its own coordinate system in viewBox while its
// width/height attributes are percentages, so viewBox is the natural size.
const readDiagramSize = () => {
  const svgElement = canvas.value?.querySelector('svg')
  const viewBox = readAttribute(svgElement, 'viewBox')
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(Number)
  if (viewBox.length === 4 && (viewBox[2] ?? 0) > 0 && (viewBox[3] ?? 0) > 0) {
    return { width: viewBox[2]!, height: viewBox[3]! }
  }

  const width = Number.parseFloat(readAttribute(svgElement, 'width'))
  const height = Number.parseFloat(readAttribute(svgElement, 'height'))
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { width, height }
  }

  const rect = svgElement?.getBoundingClientRect()
  return { width: rect?.width ?? 0, height: rect?.height ?? 0 }
}

const computeFitScale = (size: { width: number; height: number }) => {
  if (size.width <= 0 || size.height <= 0) {
    return 1
  }

  const availableWidth = window.innerWidth - FIT_MARGIN
  const availableHeight = window.innerHeight - FIT_MARGIN
  if (availableWidth <= 0 || availableHeight <= 0) {
    return 1
  }

  return clampScale(Math.min(1, availableWidth / size.width, availableHeight / size.height))
}

const zoomBy = (factor: number) => {
  const next = clampScale(scale.value * factor)
  if (next === scale.value) {
    return
  }

  // Zooming grows the diagram around the viewport centre, so the pan offset
  // travels with the content instead of drifting away from it.
  const ratio = next / scale.value
  offset.value = { x: offset.value.x * ratio, y: offset.value.y * ratio }
  scale.value = next
}

const resetView = () => {
  scale.value = fitScale.value
  offset.value = { x: 0, y: 0 }
}

const onWheel = (event: WheelEvent) => {
  zoomBy(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP)
}

const setPointerCapture = (target: EventTarget | null, pointerId: number, capture: boolean) => {
  if (!(target instanceof HTMLElement)) {
    return
  }

  try {
    if (capture) {
      target.setPointerCapture(pointerId)
    } else {
      target.releasePointerCapture(pointerId)
    }
  } catch {
    // Pointer capture can be unsupported or rejected for an inactive pointer;
    // dragging still follows moves that stay inside the diagram.
  }
}

const onPointerDown = (event: PointerEvent) => {
  dragOrigin = { x: event.clientX, y: event.clientY, offsetX: offset.value.x, offsetY: offset.value.y }
  setPointerCapture(event.currentTarget, event.pointerId, true)
}

const onPointerMove = (event: PointerEvent) => {
  if (!dragOrigin) {
    return
  }
  offset.value = { x: dragOrigin.offsetX + event.clientX - dragOrigin.x, y: dragOrigin.offsetY + event.clientY - dragOrigin.y }
}

const onPointerUp = (event: PointerEvent) => {
  if (!dragOrigin) {
    return
  }

  dragOrigin = null
  setPointerCapture(event.currentTarget, event.pointerId, false)
}

const close = () => {
  emits('close')
}

const onKeyDown = (event: KeyboardEvent) => {
  if (event.key === 'Escape') {
    close()
  }
}

onMounted(() => {
  diagramSize.value = readDiagramSize()
  fitScale.value = computeFitScale(diagramSize.value)
  scale.value = fitScale.value
  window.addEventListener('keydown', onKeyDown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
})
</script>

<style lang="scss" scoped>
.mermaid-overlay {
  --style: 'fixed inset-0 z-200 overflow-hidden bg-black bg-opacity-80';
  touch-action: none;

  .mermaid-overlay-toolbar {
    --style: 'absolute top-0 left-0 right-0 z-2 h-48px flex items-center gap-8px px-16px text-#fff';
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.55), transparent);
  }

  .mermaid-overlay-btn {
    --style: 'w-28px h-28px flex-center rounded-4px cursor-pointer text-#fff transition-colors duration-fast';
    background: none;
    border: none;

    &:hover {
      background: rgba(255, 255, 255, 0.15);
    }
  }

  .mermaid-overlay-reset {
    --style: 'h-28px px-10px rounded-4px cursor-pointer text-#fff transition-colors duration-fast';
    background: none;
    border: none;
    font-size: 12px;

    &:hover {
      background: rgba(255, 255, 255, 0.15);
    }
  }

  .mermaid-overlay-scale {
    --style: 'min-w-40px text-center text-#fff';
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }

  .mermaid-overlay-hint {
    --style: 'ml-auto text-#ffffff99';
    font-size: 12px;
  }

  .mermaid-overlay-canvas {
    position: absolute;
    left: 50%;
    top: 50%;
    touch-action: none;
    user-select: none;
    cursor: grab;
    transition:
      width var(--slax-dur-fast) ease-out,
      height var(--slax-dur-fast) ease-out;

    &:active {
      cursor: grabbing;
    }

    :deep(svg) {
      display: block;
      width: 100% !important;
      height: 100% !important;
      max-width: none !important;
      border-radius: var(--slax-radius-sm);
      background: var(--slax-surface-solid);
    }
  }

  // Without a usable viewBox the diagram keeps its own intrinsic sizing and
  // zoom falls back to a transform.
  .mermaid-overlay-canvas--unsized {
    :deep(svg) {
      width: auto !important;
      height: auto !important;
      max-width: 100% !important;
    }
  }
}
</style>
