<template>
  <Transition name="update-notice">
    <aside v-if="visible" ref="noticeElement" class="update-notice" :class="{ 'is-outdated': isOutdated }" :style="noticeStyle" role="status" aria-live="polite" aria-atomic="true">
      <div class="notice-icon" aria-hidden="true"><AppIcon name="rss.refresh" :size="18" /></div>
      <div class="notice-content">
        <p class="title">{{ isOutdated ? t('common.tips.update_notice.outdated_title') : t('common.tips.update_notice.available_title') }}</p>
        <p class="message">{{ isOutdated ? t('common.tips.update_notice.outdated_message') : t('common.tips.update_notice.available_message') }}</p>
        <button class="refresh-button" type="button" @click="refresh">{{ t('common.tips.update_notice.refresh') }}</button>
      </div>
      <button class="close-button" type="button" :aria-label="t('common.tips.update_notice.close')" @click="dismiss">
        <AppIcon name="rss.close" :size="18" />
      </button>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import AppIcon from '~/components/AppIcon.vue'

import { useUpdateNotice } from '~/composables/useUpdateNotice'

// Space kept between this notice and an in-app-browser tip that occupies the same corner.
const STACK_GAP_PX = 8

const { t } = useI18n()
const route = useRoute()
const { state, visible, dismiss } = useUpdateNotice()

const isOutdated = computed(() => state.value.kind === 'outdated')
const stackTop = ref<number | null>(null)
const noticeStyle = computed(() => (stackTop.value === null ? {} : { top: `${stackTop.value}px` }))

const refresh = () => {
  reloadNuxtApp({ path: route.fullPath, persistState: false, force: true })
}

// The in-app-browser tip is rendered beside this notice in the same layout; while it is shown, sit below it.
const noticeElement = ref<HTMLElement | null>(null)
let observer: MutationObserver | null = null
let frame = 0
const measure = () => {
  frame = 0
  const tip = noticeElement.value?.parentElement?.querySelector(':scope > .in-app-browser-tip')
  const rect = tip?.getBoundingClientRect()
  stackTop.value = rect && rect.height > 0 ? Math.round(rect.bottom + STACK_GAP_PX) : null
}
const scheduleMeasure = () => {
  if (!frame) frame = requestAnimationFrame(measure)
}
const stopObserving = () => {
  observer?.disconnect()
  observer = null
  if (frame) cancelAnimationFrame(frame)
  frame = 0
  window.removeEventListener('resize', scheduleMeasure)
}

watch(visible, async isVisible => {
  stopObserving()
  stackTop.value = null
  if (!isVisible) return
  await nextTick()
  const parent = noticeElement.value?.parentElement
  if (!parent) return
  measure()
  if (typeof MutationObserver !== 'undefined') {
    observer = new MutationObserver(scheduleMeasure)
    observer.observe(parent, { childList: true })
  }
  window.addEventListener('resize', scheduleMeasure)
}, { immediate: true })

onBeforeUnmount(stopObserving)
</script>

<style lang="scss" scoped>
.update-notice {
  position: fixed;
  z-index: 1000;
  top: calc(10px + env(safe-area-inset-top, 0px));
  right: calc(12px + env(safe-area-inset-right, 0px));
  display: flex;
  align-items: flex-start;
  gap: 10px;
  width: min(360px, calc(100vw - 24px));
  padding: 14px 6px 14px 16px;
  box-sizing: border-box;
  color: var(--slax-text);
  font-family: var(--slax-font-sans);
  background: var(--slax-surface-solid);
  border: 1px solid color-mix(in srgb, var(--slax-accent) 18%, var(--slax-border-strong));
  border-radius: calc(var(--slax-radius) + 2px);
  box-shadow: var(--slax-shadow-modal), inset 0 1px 0 var(--slax-inset-hi);
  transition: top var(--slax-dur-normal) var(--slax-ease-spring);
}

@supports (backdrop-filter: blur(1px)) {
  .update-notice { background: var(--slax-surface); backdrop-filter: var(--slax-blur); }
}

.notice-icon { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 32px; height: 32px; color: var(--slax-accent); background: var(--slax-accent-bg); border: 1px solid color-mix(in srgb, var(--slax-accent) 18%, transparent); border-radius: 10px; box-shadow: inset 0 1px 0 var(--slax-inset-hi); }
.notice-content { flex: 1; min-width: 0; padding-top: 1px; }
.title, .message { margin: 0; overflow-wrap: anywhere; }
.title { font-size: var(--slax-fs-meta); font-weight: 650; line-height: 1.3; letter-spacing: -0.01em; }
.message { margin-top: 4px; color: var(--slax-text-muted); font-size: var(--slax-fs-aux); line-height: 1.45; }
.refresh-button { display: inline-flex; align-items: center; justify-content: center; min-height: 32px; margin-top: 10px; padding: 0 14px; color: var(--slax-btn-text); font: inherit; font-size: var(--slax-fs-aux); font-weight: 600; line-height: 1; cursor: pointer; background: var(--slax-accent); border: 1px solid var(--slax-accent); border-radius: var(--slax-radius-sm); }
.refresh-button:hover { background: color-mix(in srgb, var(--slax-accent) 88%, var(--slax-text)); }
.refresh-button:focus-visible, .close-button:focus-visible { outline: 2px solid var(--slax-accent); outline-offset: 2px; }
.close-button { display: inline-flex; flex: 0 0 auto; align-items: center; justify-content: center; width: 44px; height: 44px; margin: -10px 0 0; padding: 0; color: var(--slax-text-muted); line-height: 1; cursor: pointer; background: transparent; border: 0; border-radius: 50%; }
.close-button:hover { color: var(--slax-text); background: var(--slax-accent-bg); }
.close-button:active { color: var(--slax-accent); background: var(--slax-selection); }

.update-notice-enter-active, .update-notice-leave-active { transition: opacity var(--slax-dur-normal) var(--slax-ease-spring), transform var(--slax-dur-normal) var(--slax-ease-spring); }
.update-notice-enter-from, .update-notice-leave-to { opacity: 0; transform: translate3d(0, -10px, 0); }

@media (max-width: 767px) {
  .update-notice { left: calc(12px + env(safe-area-inset-left, 0px)); width: auto; }
}

@media (prefers-reduced-motion: reduce) {
  .update-notice, .update-notice-enter-active, .update-notice-leave-active { transition: none; }
  .update-notice-enter-from, .update-notice-leave-to { transform: none; }
}
</style>
