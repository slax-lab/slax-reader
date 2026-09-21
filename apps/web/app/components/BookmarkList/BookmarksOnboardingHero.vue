<template>
  <!-- 全新用户三步引导 -->
  <div class="onboarding-hero">
    <button class="hero-skip-btn" type="button" @click="skip">{{ $t('page.bookmarks_onboarding.skip') }}</button>

    <template v-if="currentStep === 1">
      <h1 class="hero-title">{{ $t('page.bookmarks_onboarding.step1.title') }}</h1>

      <div class="browser-save-demo" :class="{ 'is-playing': isPlaying, 'is-clicked': isClicked }" aria-label="使用 Slax Reader 浏览器扩展收藏文章的动画示意">
        <div class="demo-browser-tabs" aria-hidden="true">
          <span class="demo-browser-tab is-active" />
          <span class="demo-browser-tab" />
        </div>
        <div class="browser-demo-shell">
          <div class="demo-address" aria-hidden="true">
            <svg class="demo-lock" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
              <rect x="5" y="11" width="14" height="10" rx="2" />
              <path d="M8 11V8a4 4 0 018 0v3" />
            </svg>
            <span class="demo-address-text">slax.com/articles/a-quiet-field-guide</span>
          </div>
          <div class="demo-extension-area" aria-hidden="true">
            <span class="demo-icon-slot demo-reader-icon">
              <img src="@images/icon-logo-bookmark.png" alt="" />
            </span>
            <span class="demo-icon-slot demo-puzzle">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M19.6 13.5c-.77 0-1.39-.62-1.39-1.39s.62-1.39 1.39-1.39c.43 0 .83.2 1.09.53V8.8c0-.83-.67-1.5-1.5-1.5h-3.02a2.73 2.73 0 00.13-.82 2.8 2.8 0 10-5.6 0c0 .28.04.55.13.82H7.8c-.83 0-1.5.67-1.5 1.5v2.95a2.73 2.73 0 00-.82-.13 2.8 2.8 0 000 5.6c.28 0 .55-.04.82-.13v2.1c0 .83.67 1.5 1.5 1.5h11.39c.83 0 1.5-.67 1.5-1.5v-6.22c-.26.33-.66.53-1.09.53z"
                />
              </svg>
            </span>
            <span class="demo-icon-slot demo-more">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="5" r="1.8" />
                <circle cx="12" cy="12" r="1.8" />
                <circle cx="12" cy="19" r="1.8" />
              </svg>
            </span>
          </div>
        </div>
        <div class="demo-toast" aria-hidden="true">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">
            <path d="M20 6L9 17l-5-5" />
          </svg>
          <span>{{ $t('page.bookmarks_onboarding.step1.toast') }}</span>
        </div>
        <div class="demo-cursor" aria-hidden="true">
          <svg viewBox="0 0 32 32" fill="none">
            <path d="M7 4l16.5 15.3-8.4 1.2-3.6 7.7L7 4z" fill="var(--slax-surface-solid)" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" />
          </svg>
        </div>
      </div>

      <p class="hero-setup-time">{{ $t('page.bookmarks_onboarding.step1.setupTime') }}</p>
      <button class="hero-install-btn" type="button" @click="install">
        {{ $t('page.bookmarks_onboarding.step1.install') }}
      </button>
    </template>

    <template v-else>
      <h1 class="hero-title">{{ currentStep === 2 ? $t('page.bookmarks_onboarding.step2.title') : $t('page.bookmarks_onboarding.step3.title') }}</h1>

      <div class="pin-card">
        <p class="pin-copy">{{ currentStep === 2 ? $t('page.bookmarks_onboarding.step2.copy') : $t('page.bookmarks_onboarding.step3.copy') }}</p>

        <div v-if="currentStep === 2" class="pin-illustration" aria-label="将 Slax Reader 扩展固定到浏览器工具栏的示意图">
          <div class="pin-browser-bar" aria-hidden="true">
            <div class="pin-address-pill" />
            <div class="pin-puzzle-anchor">
              <svg viewBox="0 0 24 24" fill="currentColor">
                <path
                  d="M19.6 13.5c-.77 0-1.39-.62-1.39-1.39s.62-1.39 1.39-1.39c.43 0 .83.2 1.09.53V8.8c0-.83-.67-1.5-1.5-1.5h-3.02a2.73 2.73 0 00.13-.82 2.8 2.8 0 10-5.6 0c0 .28.04.55.13.82H7.8c-.83 0-1.5.67-1.5 1.5v2.95a2.73 2.73 0 00-.82-.13 2.8 2.8 0 000 5.6c.28 0 .55-.04.82-.13v2.1c0 .83.67 1.5 1.5 1.5h11.39c.83 0 1.5-.67 1.5-1.5v-6.22c-.26.33-.66.53-1.09.53z"
                />
              </svg>
              <span class="pin-badge">1</span>
            </div>
          </div>
          <div class="pin-guide-line" aria-hidden="true" />
          <div class="pin-extension-menu" aria-hidden="true">
            <p class="pin-menu-title">{{ $t('page.bookmarks_onboarding.step2.extensionsMenu') }}</p>
            <div class="pin-extension-row">
              <span class="pin-reader-mark">
                <img src="@images/icon-logo-bookmark.png" alt="" />
              </span>
              <span class="pin-row-label">Slax Reader</span>
              <span class="pin-pin-icon">
                <svg viewBox="0 0 24 24">
                  <path d="M14.8 2.8l6.4 6.4-2.4 2.4-2.2-2.2-3.7 3.7.5 5.8-1.2 1.2-4.1-4.1-4.1 4.1-1.1-1.1 4.1-4.1-4.1-4.1 1.2-1.2 5.8.5 3.7-3.7-2.2-2.2 2.4-2.4z" />
                </svg>
                <span class="pin-badge">2</span>
              </span>
            </div>
          </div>
        </div>

        <button v-if="currentStep === 2" class="pin-confirm-btn" type="button" data-analytics-element="welcome_pin_cta" @click="confirmPinned">
          {{ $t('page.bookmarks_onboarding.step2.confirm') }}
        </button>

        <a v-else class="getting-started-button" :href="gettingStartedUrl" target="_blank" rel="noopener noreferrer" data-analytics-element="welcome_done_cta" @click="complete">
          <span>{{ $t('page.bookmarks_onboarding.step3.button') }}</span>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M5 12h14" />
            <path d="M13 6l6 6-6 6" />
          </svg>
        </a>
      </div>
    </template>
  </div>
</template>

<script setup lang="ts">
import { useExtensionDetection } from '~/composables/useExtensionDetection'
import { usePinnedDetection } from '~/composables/usePinnedDetection'

const emit = defineEmits<{ skip: []; complete: [] }>()

const pluginUrl = 'https://chromewebstore.google.com/detail/slax-reader/gdnhaajlomjkhahnmiijphnodkcfikfd?utm_source=web_onboarding'
const gettingStartedUrl = 'https://www.slax.com/blog/quick-save-with-the-slax-extension'

// computed 避免拿不到初始值
const { isInstalled } = useExtensionDetection()
const { isPinned } = usePinnedDetection()
const manualStep3 = ref(false)
const installPending = ref(false)
let installReturnTimer: ReturnType<typeof setTimeout> | undefined

const currentStep = computed<1 | 2 | 3>(() => {
  if (manualStep3.value) return 3
  if (!isInstalled.value) return 1
  if (!isPinned.value) return 2
  return 3
})

const checkInstallReturn = () => {
  if (!installPending.value || document.visibilityState !== 'visible') return

  if (installReturnTimer) clearTimeout(installReturnTimer)
  installReturnTimer = setTimeout(() => {
    installReturnTimer = undefined
    if (!installPending.value) return

    installPending.value = false
    // 新安装的扩展不会自动注入已打开的页面，刷新后才能创建 DOM 标记并进入步骤 2
    if (!isInstalled.value) window.location.reload()
  }, 300)
}
const install = () => {
  installPending.value = true
  window.open(pluginUrl)
}
const confirmPinned = () => (manualStep3.value = true)
const skip = () => emit('skip')
const complete = () => emit('complete')

// 步骤1 循环播放的收藏动画
const CURSOR_DELAY = 2000
const CURSOR_DURATION = 1000
const CLICK_DELAY = CURSOR_DELAY + CURSOR_DURATION
const CLICK_RING_DURATION = 720
const TOAST_DURATION = 420
const TOAST_HOLD = 1450
const LOOP_DELAY = CLICK_DELAY + CLICK_RING_DURATION + TOAST_DURATION + TOAST_HOLD

const isPlaying = ref(false)
const isClicked = ref(false)
const timers: ReturnType<typeof setTimeout>[] = []
let reducedMotionQuery: MediaQueryList | undefined

const clearTimers = () => {
  while (timers.length) clearTimeout(timers.pop())
}

const playDemoSequence = () => {
  clearTimers()
  isClicked.value = false
  isPlaying.value = false
  // 强制重排，确保下一帧重新触发动画
  requestAnimationFrame(() => {
    isPlaying.value = true
  })

  timers.push(
    setTimeout(() => {
      isClicked.value = true
      isPlaying.value = false
    }, CLICK_DELAY)
  )

  timers.push(setTimeout(playDemoSequence, LOOP_DELAY))
}

onMounted(() => {
  playDemoSequence()

  document.addEventListener('visibilitychange', checkInstallReturn)
  window.addEventListener('focus', checkInstallReturn)

  if (window.matchMedia) {
    reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)')
    reducedMotionQuery.addEventListener?.('change', playDemoSequence)
  }
})

onUnmounted(() => {
  clearTimers()
  if (installReturnTimer) clearTimeout(installReturnTimer)
  document.removeEventListener('visibilitychange', checkInstallReturn)
  window.removeEventListener('focus', checkInstallReturn)
  reducedMotionQuery?.removeEventListener?.('change', playDemoSequence)
})
</script>

<style lang="scss" scoped>
.onboarding-hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  text-align: center;
  padding: 96px 24px 64px;
  position: relative;
}

// fixed 相对视口定位
.hero-skip-btn {
  position: fixed;
  top: calc(var(--slax-header-height) + 36px);
  right: 72px;
  z-index: 60;
  border: none;
  background: transparent;
  color: var(--slax-text-light);
  font: inherit;
  font-size: 15px;
  cursor: pointer;
  opacity: 0.72;
  padding: 4px 8px;
  transition:
    color 160ms ease,
    opacity 160ms ease;

  &:hover {
    opacity: 1;
  }
}

.hero-title {
  margin: 0 0 40px;
  max-width: 660px;
  color: var(--slax-text);
  font-family: var(--slax-font-serif);
  font-size: clamp(20px, 2.5vw, 32px);
  font-weight: 500;
  line-height: 1.12;
  letter-spacing: 0;
}

.browser-save-demo {
  width: 100%;
  max-width: 760px;
  height: 140px;
  margin: 0 auto 8px;
  position: relative;
  --browser-base-bg: color-mix(in srgb, var(--slax-surface-solid) 72%, var(--slax-text-light) 12%);
  --browser-active-bg: color-mix(in srgb, var(--slax-surface-solid) 94%, var(--slax-bg));
  --browser-tab-bg: color-mix(in srgb, var(--slax-surface-solid) 66%, var(--slax-text-light) 18%);
  --browser-address-bg: color-mix(in srgb, var(--slax-surface-solid) 84%, var(--slax-text-light) 8%);
  --heartbeat-duration: 3s;
  --cursor-delay: 2s;
  --cursor-duration: 1s;
  --click-ring-duration: 720ms;
  --toast-delay: var(--click-ring-duration);
  --toast-duration: 420ms;
  --toast-hold: 1.45s;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 98px;
    border-radius: var(--slax-radius, 14px);
    background: var(--browser-base-bg);
    box-shadow:
      var(--slax-shadow-sm),
      inset 0 1px 0 var(--slax-inset-hi);
    backdrop-filter: blur(16px) saturate(150%);
    pointer-events: none;
  }

  &::after {
    content: '';
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 98px;
    border: 1px solid var(--slax-border);
    border-radius: var(--slax-radius, 14px);
    pointer-events: none;
    z-index: 5;
  }
}

.demo-browser-tabs {
  position: absolute;
  top: 6px;
  left: 24px;
  right: 24px;
  height: 28px;
  display: flex;
  align-items: flex-end;
  gap: 7px;
  pointer-events: none;
  z-index: 3;
}

.demo-browser-tab {
  width: 136px;
  height: 28px;
  border: 0;
  border-radius: 14px 14px 0 0;
  background: var(--browser-tab-bg);
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
  opacity: 0.68;
  position: relative;

  &.is-active {
    background: var(--browser-active-bg);
    opacity: 1;
    z-index: 1;
  }
}

.browser-demo-shell {
  position: absolute;
  top: 34px;
  left: 0;
  width: 100%;
  height: 66px;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 16px;
  border-radius: 0 0 var(--slax-radius, 14px) var(--slax-radius, 14px);
  overflow: visible;
  z-index: 1;

  &::before {
    content: '';
    position: absolute;
    inset: 0;
    border-radius: 0 0 var(--slax-radius, 14px) var(--slax-radius, 14px);
    background: var(--browser-active-bg);
    pointer-events: none;
    z-index: 0;
  }
}

.demo-address {
  min-width: 0;
  height: 38px;
  flex: 1;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 0 15px;
  border-radius: 999px;
  background: var(--browser-address-bg);
  color: var(--slax-text-light);
  font-size: 13px;
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
  position: relative;
  z-index: 1;
}

.demo-address-text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.demo-lock {
  width: 14px;
  height: 14px;
  color: var(--slax-text-light);
  flex-shrink: 0;
}

.demo-extension-area {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  position: relative;
  z-index: 1;
}

.demo-icon-slot {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 10px;
  color: var(--slax-text-muted);
  position: relative;
}

.demo-reader-icon {
  isolation: isolate;

  &::before {
    content: '';
    position: absolute;
    inset: -5px;
    border-radius: 50%;
    background: radial-gradient(circle, color-mix(in srgb, var(--slax-accent) 24%, transparent) 0%, transparent 70%);
    filter: blur(4px);
    opacity: 0;
    transform: scale(0.86);
    pointer-events: none;
    z-index: 0;
  }

  &::after {
    content: '';
    position: absolute;
    inset: -5px;
    border: 2px solid color-mix(in srgb, var(--slax-accent) 74%, transparent);
    border-radius: 50%;
    opacity: 0;
    pointer-events: none;
    transform: scale(0.78);
    z-index: 0;
  }

  img {
    width: 24px;
    height: 24px;
    display: block;
    position: relative;
    z-index: 1;
  }
}

.demo-reader-icon,
.demo-reader-icon::before,
.demo-reader-icon::after,
.demo-reader-icon img,
.demo-cursor,
.demo-toast {
  transition:
    opacity 180ms ease,
    transform 180ms ease,
    box-shadow 180ms ease;
}

.demo-puzzle svg {
  width: 22px;
  height: 22px;
}

.demo-more svg {
  width: 18px;
  height: 18px;
}

.demo-cursor {
  --cursor-start-x: 82px;
  --cursor-start-y: -2px;
  --cursor-target-x: 96px;
  --cursor-target-y: -46px;
  position: absolute;
  top: 108px;
  right: 216px;
  width: 30px;
  height: 30px;
  color: var(--slax-text);
  filter: drop-shadow(0 4px 10px color-mix(in srgb, var(--slax-text) 16%, transparent));
  opacity: 0;
  pointer-events: none;
  transform-origin: 6px 6px;
  z-index: 6;

  svg {
    width: 100%;
    height: 100%;
    display: block;
  }
}

.demo-toast {
  position: absolute;
  top: 49px;
  right: 158px;
  min-width: 94px;
  height: 36px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--slax-border);
  border-radius: 999px;
  background: var(--slax-surface-solid);
  box-shadow:
    var(--slax-shadow-warm),
    inset 0 1px 0 var(--slax-inset-hi);
  color: var(--slax-accent);
  font-size: 13px;
  font-weight: 500;
  padding: 0 14px;
  opacity: 0;
  transform: translateX(-12px) scale(0.96);
  z-index: 4;

  svg {
    width: 14px;
    height: 14px;
    flex-shrink: 0;
  }
}

.browser-save-demo.is-playing {
  .demo-reader-icon::before {
    animation: onboardingHeroHeartbeatHalo var(--heartbeat-duration) ease-in-out 1 both;
  }

  .demo-reader-icon img {
    animation: onboardingHeroHeartbeat var(--heartbeat-duration) ease-in-out 1 both;
  }

  .demo-cursor {
    animation: onboardingHeroCursor var(--cursor-duration) cubic-bezier(0.2, 0.75, 0.2, 1) 1 forwards;
    animation-delay: var(--cursor-delay);
  }
}

.browser-save-demo.is-clicked {
  .demo-reader-icon::before {
    animation: none;
    opacity: 0;
    transform: scale(0.92);
  }

  .demo-reader-icon::after {
    animation: onboardingHeroClickRing var(--click-ring-duration) ease-out 1 both;
  }

  .demo-reader-icon img {
    animation: none;
    transform: scale(1);
  }

  .demo-cursor {
    animation: none;
    opacity: 0;
    transform: translate(var(--cursor-target-x), var(--cursor-target-y)) rotate(-8deg) scale(1);
  }

  .demo-toast {
    animation: onboardingHeroToast var(--toast-duration) ease-out 1 both;
    animation-delay: var(--toast-delay);
  }
}

@keyframes onboardingHeroHeartbeat {
  0%,
  33.333%,
  66.666%,
  100% {
    transform: scale(1);
  }

  16.666%,
  50%,
  83.333% {
    transform: scale(1.055);
  }
}

@keyframes onboardingHeroHeartbeatHalo {
  0%,
  33.333%,
  66.666%,
  100% {
    opacity: 0.05;
    transform: scale(0.86);
  }

  16.666%,
  50%,
  83.333% {
    opacity: 0.2;
    transform: scale(1.06);
  }
}

@keyframes onboardingHeroClickRing {
  0% {
    opacity: 0.84;
    transform: scale(0.78);
  }

  62% {
    opacity: 0.34;
  }

  100% {
    opacity: 0;
    transform: scale(1.18);
  }
}

@keyframes onboardingHeroCursor {
  0%,
  16% {
    opacity: 1;
    transform: translate(var(--cursor-start-x), var(--cursor-start-y)) rotate(-8deg) scale(0.95);
  }

  54% {
    opacity: 1;
    transform: translate(var(--cursor-target-x), var(--cursor-target-y)) rotate(-8deg) scale(1);
  }

  60% {
    opacity: 1;
    transform: translate(var(--cursor-target-x), var(--cursor-target-y)) rotate(-8deg) scale(0.86);
  }

  74% {
    opacity: 1;
    transform: translate(var(--cursor-target-x), var(--cursor-target-y)) rotate(-8deg) scale(1);
  }

  100% {
    opacity: 0;
    transform: translate(var(--cursor-target-x), var(--cursor-target-y)) rotate(-8deg) scale(1);
  }
}

@keyframes onboardingHeroToast {
  0% {
    opacity: 0;
    transform: translateX(-12px) scale(0.96);
  }

  100% {
    opacity: 1;
    transform: translateX(0) scale(1);
  }
}

.hero-setup-time {
  margin: 8px 0 0;
  color: var(--slax-text-light);
  font-size: 14px;
  line-height: 1.6;
}

.hero-install-btn {
  margin-top: 24px;
  min-width: 196px;
  height: 48px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: 999px;
  background: var(--slax-accent);
  box-shadow: var(--slax-shadow-warm);
  color: var(--slax-btn-text);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  padding: 0 28px;
  transition:
    opacity 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;

  &:hover {
    opacity: 0.92;
  }

  &:active {
    transform: translateY(1px) scale(0.99);
  }
}

.pin-card {
  width: min(100%, 920px);
  margin-top: 0;
  padding: 32px 0 0;
  position: relative;

  &::before {
    content: '';
    position: absolute;
    top: 0;
    left: 50%;
    width: min(100%, 650px);
    height: 1px;
    background: var(--slax-border);
    transform: translateX(-50%);
  }
}

.pin-copy {
  margin: 0 auto;
  width: min(100%, 650px);
  color: var(--slax-text-light);
  font-size: 14px;
  line-height: 1.7;
  text-align: center;
}

.pin-illustration {
  width: min(100%, 650px);
  min-height: 286px;
  margin: 26px auto 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--slax-border);
  border-radius: 16px;
  background: var(--slax-surface);
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
  position: relative;
  overflow: hidden;

  &::before {
    content: '';
    position: absolute;
    top: 36px;
    left: 40px;
    right: 40px;
    height: 64px;
    border: 1px solid var(--slax-border);
    border-radius: 16px;
    background: var(--slax-surface);
    box-shadow:
      var(--slax-shadow-sm),
      inset 0 1px 0 var(--slax-inset-hi);
  }
}

.pin-browser-bar {
  position: absolute;
  top: 52px;
  left: 56px;
  right: 56px;
  height: 32px;
  display: flex;
  align-items: center;
  gap: 16px;
  z-index: 1;
}

.pin-address-pill {
  height: 32px;
  flex: 1;
  border: 1px solid var(--slax-border);
  border-radius: 999px;
  background: var(--slax-surface-solid);
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
}

.pin-puzzle-anchor {
  width: 34px;
  height: 34px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: var(--slax-text-muted);
  position: relative;
  flex: 0 0 34px;

  svg {
    width: 23px;
    height: 23px;
  }
}

.pin-badge {
  width: 28px;
  height: 28px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1.5px solid color-mix(in srgb, var(--slax-accent) 78%, transparent);
  border-radius: 50%;
  background: var(--slax-surface-solid);
  color: var(--slax-accent);
  font-size: 14px;
  font-weight: 700;
  line-height: 1;
  box-shadow:
    0 2px 6px color-mix(in srgb, var(--slax-accent) 12%, transparent),
    inset 0 1px 0 var(--slax-inset-hi);
}

.pin-puzzle-anchor .pin-badge {
  position: absolute;
  top: -11px;
  right: -8px;
}

.pin-guide-line {
  position: absolute;
  top: 104px;
  right: 86px;
  width: 1px;
  height: 34px;
  background: repeating-linear-gradient(to bottom, color-mix(in srgb, var(--slax-accent) 64%, transparent) 0 5px, transparent 5px 10px);
}

.pin-extension-menu {
  position: absolute;
  top: 124px;
  right: 40px;
  width: 242px;
  padding: 14px 9px 12px;
  border: 1px solid var(--slax-border);
  border-radius: 14px;
  background: var(--slax-surface-solid);
  box-shadow:
    var(--slax-shadow-sm),
    inset 0 1px 0 var(--slax-inset-hi);
}

.pin-menu-title {
  margin: 0 0 8px;
  color: var(--slax-text-light);
  font-size: 14px;
  line-height: 1.4;
  text-align: left;
  padding: 0 10px;
}

.pin-extension-row {
  min-height: 48px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 10px;
  border-radius: 8px;
  background: var(--slax-accent-bg);
  color: var(--slax-text);
  position: relative;
}

.pin-reader-mark {
  width: 26px;
  height: 26px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex: 0 0 26px;

  img {
    width: 100%;
    height: 100%;
    display: block;
    object-fit: contain;
  }
}

.pin-row-label {
  min-width: 0;
  flex: 1;
  color: var(--slax-text);
  font-size: 16px;
  line-height: 1.2;
  text-align: left;
  white-space: nowrap;
}

.pin-pin-icon {
  width: 24px;
  height: 24px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  color: #2f6ff4;
  flex: 0 0 24px;
  position: relative;

  svg {
    width: 20px;
    height: 20px;
    fill: currentColor;
  }

  .pin-badge {
    position: absolute;
    top: -24px;
    right: -22px;
  }
}

.pin-confirm-btn {
  margin: 24px auto 0;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm, 10px);
  background: transparent;
  color: var(--slax-accent);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  padding: 0 18px;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease,
    transform 150ms ease;

  &:hover {
    border-color: var(--slax-accent-soft, var(--slax-accent));
    transform: translateY(-1px);
  }

  &:active {
    transform: scale(0.98);
  }
}

.getting-started-button {
  margin: 34px auto 0;
  min-height: 44px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm, 10px);
  background: transparent;
  color: var(--slax-accent);
  cursor: pointer;
  font: inherit;
  font-size: 14px;
  font-weight: 500;
  line-height: 1;
  padding: 0 18px;
  text-decoration: none;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease,
    transform 150ms ease;

  &:hover {
    border-color: var(--slax-accent-soft, var(--slax-accent));
    transform: translateY(-1px);
  }

  &:active {
    transform: scale(0.98);
  }

  svg {
    width: 18px;
    height: 18px;
    flex-shrink: 0;
  }
}

@media (prefers-reduced-motion: reduce) {
  .browser-save-demo.is-playing .demo-reader-icon::before,
  .browser-save-demo.is-playing .demo-reader-icon img,
  .browser-save-demo.is-playing .demo-cursor,
  .browser-save-demo.is-clicked .demo-toast,
  .browser-save-demo.is-clicked .demo-reader-icon::after {
    animation: none !important;
  }

  .browser-save-demo.is-clicked .demo-reader-icon::after {
    opacity: 0.42;
    transform: scale(1.08);
  }

  .browser-save-demo.is-clicked .demo-toast {
    opacity: 1;
    transform: none;
  }
}

@media (max-width: 768px) {
  .onboarding-hero {
    padding: 48px 20px 40px;
  }

  .hero-skip-btn {
    top: -28px;
    right: 12px;
  }

  .browser-save-demo {
    height: 116px;
    margin-bottom: 8px;
  }

  .browser-save-demo::before,
  .browser-save-demo::after {
    height: 78px;
  }

  .browser-demo-shell {
    top: 23px;
    height: 56px;
    gap: 8px;
    padding: 0 10px;
  }

  .demo-browser-tabs {
    top: 4px;
    left: 14px;
    right: 14px;
    height: 19px;
    gap: 5px;
  }

  .demo-browser-tab {
    width: 84px;
    height: 19px;
    border-radius: 10px 10px 0 0;
  }

  .demo-address {
    height: 34px;
    padding: 0 11px;
    font-size: 12px;
  }

  .demo-icon-slot {
    width: 30px;
    height: 30px;
    border-radius: 8px;
  }

  .demo-reader-icon img {
    width: 21px;
    height: 21px;
  }

  .demo-puzzle,
  .demo-more {
    display: none;
  }

  .demo-cursor {
    --cursor-start-x: 42px;
    --cursor-start-y: 0;
    --cursor-target-x: 51px;
    --cursor-target-y: -32px;
    top: 78px;
    right: 72px;
    width: 25px;
    height: 25px;
  }

  .demo-toast {
    top: 34px;
    right: 48px;
    height: 32px;
    min-width: 0;
    font-size: 12px;
    padding: 0 12px;
  }

  .pin-illustration {
    min-height: 234px;
    margin-top: 22px;
    border-radius: 12px;
  }

  .pin-browser-bar {
    top: 39px;
    left: 30px;
    right: 30px;
    height: 32px;
    gap: 10px;
  }

  .pin-extension-menu {
    top: 108px;
    right: 20px;
    width: min(242px, calc(100% - 40px));
    padding: 12px 8px 10px;
  }
}
</style>
