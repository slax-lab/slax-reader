<template>
  <Transition name="in-app-browser-tip" @after-leave="resetAfterLeave">
    <aside
      v-if="isVisible"
      ref="tipElement"
      class="in-app-browser-tip"
      :class="{ 'is-dragging': isDragging, 'is-dismissing': isDismissing }"
      :style="tipStyle"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerCancel"
      @lostpointercapture="onPointerCancel"
    >
      <span class="drag-handle" aria-hidden="true" />
      <div class="tip-icon" aria-hidden="true"><AppIcon name="rss.external" :size="18" /></div>
      <div class="tip-content">
        <p class="title">{{ t('common.tips.in_app_browser.title') }}</p>
        <p class="message">
          <span class="message-visual" aria-hidden="true">
            <span>{{ t('common.tips.in_app_browser.message_before') }}</span>
            <AppIcon class="menu-icon" name="snapshot.more" :size="16" />
            <span>{{ t('common.tips.in_app_browser.message_after') }}</span>
          </span>
          <span class="sr-only">{{ t('common.tips.in_app_browser.message_accessible') }}</span>
        </p>
      </div>
      <button class="close-button" type="button" :aria-label="t('common.tips.in_app_browser.close')" @click="dismiss">
        <AppIcon name="rss.close" :size="18" />
      </button>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import AppIcon from '~/components/AppIcon.vue'

import { isSlaxReaderApp } from '~/utils/environment'
import { isInAppBrowser } from '~/utils/inAppBrowser'
import { isInAppBrowserTipCoolingDown, recordInAppBrowserTipManualClose } from '~/utils/inAppBrowserTipState'

const PROTOCOL_ROUTES = new Set(['/privacy', '/terms', '/how-do-i-delete-my-account', '/delete-account-notice'])
const DRAG_ACTIVATION_THRESHOLD = 4
const DISMISS_THRESHOLD_RATIO = 0.4
const DISMISS_ANIMATION_MS = 220

const route = useRoute()
const { t } = useI18n()
const tipElement = ref<HTMLElement | null>(null)
const isVisible = ref(false)
const isDragging = ref(false)
const isDismissing = ref(false)
const dragOffset = ref(0)
let dismissTimer: ReturnType<typeof setTimeout> | undefined
let pointerState: { id: number; startX: number; startY: number; dragging: boolean; committed: boolean } | null = null

const tipStyle = computed(() => {
  if (dragOffset.value === 0 && !isDragging.value && !isDismissing.value) return {}
  return { transform: `translate3d(0, ${dragOffset.value}px, 0)` }
})

const isExcludedRoute = (path: string): boolean => {
  const normalizedPath = path.toLowerCase().replace(/\/+$/, '') || '/'
  if (PROTOCOL_ROUTES.has(normalizedPath)) return true
  if (/^\/(?:auth|x\/ext-bridge|rss)(?:\/|$)/.test(normalizedPath)) return true
  if (/^\/bookmarks\/[^/]+(?:\/|$)/.test(normalizedPath)) return true
  if (/^\/c\/[^/]+\/[^/]+(?:\/|$)/.test(normalizedPath)) return true
  if (/^\/[^/]+-reader(?:\/|$)/.test(normalizedPath)) return true
  return false
}

const isStandalonePwa = (): boolean => {
  if (typeof window === 'undefined') return false
  if (window.matchMedia?.('(display-mode: standalone)').matches) return true
  return 'standalone' in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone)
}

const evaluateVisibility = (): void => {
  if (isDismissing.value) return
  if (dismissTimer) {
    clearTimeout(dismissTimer)
    dismissTimer = undefined
  }
  pointerState = null
  isVisible.value = false
  isDismissing.value = false
  isDragging.value = false
  dragOffset.value = 0
  if (typeof window === 'undefined' || isExcludedRoute(route.path)) return
  if (isSlaxReaderApp() || isStandalonePwa() || isInAppBrowserTipCoolingDown()) return
  isVisible.value = isInAppBrowser(navigator.userAgent)
}

const commitManualClose = (): void => {
  if (pointerState?.committed) return
  if (pointerState) pointerState.committed = true
  recordInAppBrowserTipManualClose()
}

const finishDismiss = (): void => {
  if (!isDismissing.value) return
  if (dismissTimer) clearTimeout(dismissTimer)
  dismissTimer = undefined
  isVisible.value = false
  isDragging.value = false
  isDismissing.value = false
  pointerState = null
}

const resetAfterLeave = (): void => {
  dragOffset.value = 0
}

const animateDismiss = (): void => {
  isDismissing.value = true
  isDragging.value = false
  const height = tipElement.value?.getBoundingClientRect().height ?? 112
  dragOffset.value = -(height + 32)
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    finishDismiss()
  } else {
    dismissTimer = setTimeout(finishDismiss, DISMISS_ANIMATION_MS)
  }
}

const dismiss = (): void => {
  if (isDismissing.value) return
  commitManualClose()
  animateDismiss()
}

const resetPointer = (): void => {
  isDragging.value = false
  dragOffset.value = 0
  pointerState = null
}

const onPointerDown = (event: PointerEvent): void => {
  if (event.isPrimary === false || event.button !== 0 || isDismissing.value) return
  const target = event.target as HTMLElement | null
  if (target?.closest('button, a, input, textarea, select, [role="button"]')) return
  pointerState = { id: event.pointerId, startX: event.clientX, startY: event.clientY, dragging: false, committed: false }
  try {
    tipElement.value?.setPointerCapture(event.pointerId)
  } catch {
    // Some older WebViews do not expose pointer capture.
  }
}

const onPointerMove = (event: PointerEvent): void => {
  if (!pointerState || event.pointerId !== pointerState.id || isDismissing.value) return
  const deltaX = event.clientX - pointerState.startX
  const deltaY = event.clientY - pointerState.startY
  if (!pointerState.dragging) {
    if (Math.abs(deltaY) < DRAG_ACTIVATION_THRESHOLD || Math.abs(deltaY) < Math.abs(deltaX)) return
    pointerState.dragging = true
    isDragging.value = true
  }
  if (event.cancelable) event.preventDefault()
  dragOffset.value = deltaY <= 0 ? deltaY : deltaY * 0.18
}

const onPointerUp = (event: PointerEvent): void => {
  if (!pointerState || event.pointerId !== pointerState.id) return
  const height = tipElement.value?.getBoundingClientRect().height ?? 112
  if (pointerState.dragging && dragOffset.value < -height * DISMISS_THRESHOLD_RATIO) {
    commitManualClose()
    animateDismiss()
    return
  }
  resetPointer()
}

const onPointerCancel = (event: PointerEvent): void => {
  if (isDismissing.value) return
  if (!pointerState || event.pointerId !== pointerState.id) return
  resetPointer()
}

onMounted(evaluateVisibility)
onBeforeUnmount(() => {
  if (dismissTimer) clearTimeout(dismissTimer)
})
watch(() => route.path, evaluateVisibility)
</script>

<style lang="scss" scoped>
.in-app-browser-tip {
  position: fixed;
  z-index: 80;
  top: calc(10px + env(safe-area-inset-top, 0px));
  right: calc(12px + env(safe-area-inset-right, 0px));
  left: calc(12px + env(safe-area-inset-left, 0px));
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: auto;
  max-width: min(420px, calc(100vw - 24px));
  margin-inline: auto;
  padding: 18px 8px 12px 20px;
  box-sizing: border-box;
  color: var(--slax-text);
  font-family: var(--slax-font-sans);
  background: var(--slax-surface-solid);
  border: 1px solid color-mix(in srgb, var(--slax-accent) 18%, var(--slax-border-strong));
  border-radius: calc(var(--slax-radius) + 2px);
  box-shadow: var(--slax-shadow-modal), inset 0 1px 0 var(--slax-inset-hi);
  user-select: none;
  touch-action: none;
  will-change: transform;
  cursor: grab;
  transition: transform var(--slax-dur-normal) var(--slax-ease-spring), box-shadow var(--slax-dur-fast) ease;
}

.in-app-browser-tip::before {
  position: absolute;
  inset: 12px auto 12px 8px;
  width: 3px;
  content: '';
  background: linear-gradient(
    to bottom,
    transparent,
    color-mix(in srgb, var(--slax-accent) 72%, transparent) 18%,
    var(--slax-accent) 50%,
    color-mix(in srgb, var(--slax-accent) 72%, transparent) 82%,
    transparent
  );
  border-radius: 999px;
  opacity: 0.86;
  box-shadow: 0 0 10px color-mix(in srgb, var(--slax-accent) 18%, transparent);
}

@supports (backdrop-filter: blur(1px)) {
  .in-app-browser-tip { background: var(--slax-surface); backdrop-filter: var(--slax-blur); }
}
.in-app-browser-tip.is-dragging { cursor: grabbing; transition: none; }
.in-app-browser-tip.is-dismissing { pointer-events: none; }
.drag-handle { position: absolute; top: 7px; left: 50%; width: 30px; height: 3px; background: var(--slax-border-strong); border-radius: 999px; transform: translateX(-50%); }
.tip-icon { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 32px; height: 32px; margin-top: 1px; color: var(--slax-accent); background: var(--slax-accent-bg); border: 1px solid color-mix(in srgb, var(--slax-accent) 18%, transparent); border-radius: 10px; box-shadow: inset 0 1px 0 var(--slax-inset-hi); }
.tip-content { flex: 1; min-width: 0; padding-top: 1px; }
.title, .message { margin: 0; overflow-wrap: anywhere; }
.title { font-size: var(--slax-fs-meta); font-weight: 650; line-height: 1.3; letter-spacing: -0.01em; }
.message { margin-top: 4px; color: var(--slax-text-muted); font-size: var(--slax-fs-aux); line-height: 1.45; }
.message-visual { display: inline; }
.menu-icon { display: inline-block; margin-inline: 0.18em; vertical-align: -0.18em; color: var(--slax-text); }
.sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }
.close-button { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 44px; height: 44px; margin: -6px -2px 0 0; padding: 0; color: var(--slax-text-muted); line-height: 1; cursor: pointer; background: transparent; border: 0; border-radius: 50%; }
.close-button:hover { color: var(--slax-text); background: var(--slax-accent-bg); }
.close-button:active { color: var(--slax-accent); background: var(--slax-selection); }
.close-button:focus-visible { outline: 2px solid var(--slax-accent); outline-offset: 2px; }
.in-app-browser-tip-enter-active, .in-app-browser-tip-leave-active { transition: opacity var(--slax-dur-normal) var(--slax-ease-spring), transform var(--slax-dur-normal) var(--slax-ease-spring); }
.in-app-browser-tip-enter-from, .in-app-browser-tip-leave-to { opacity: 0; transform: translate3d(0, -10px, 0); }
@media (prefers-reduced-motion: reduce) { .in-app-browser-tip, .in-app-browser-tip-enter-active, .in-app-browser-tip-leave-active { transition: none; } }
</style>
