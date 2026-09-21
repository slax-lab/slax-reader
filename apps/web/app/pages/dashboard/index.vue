<template>
  <div class="dashboard-page">
    <div class="dashboard-bg" aria-hidden="true">
      <div class="dashboard-bg__blob dashboard-bg__blob--1"></div>
      <div class="dashboard-bg__blob dashboard-bg__blob--2"></div>
      <div class="dashboard-bg__blob dashboard-bg__blob--3"></div>
    </div>

    <div class="dashboard-content">
      <ClientOnly>
        <DashboardClient />
        <template #fallback>
          <div class="dashboard-fallback">
            <div class="i-svg-spinners:90-ring dashboard-fallback__spinner"></div>
            <span>{{ t('page.dashboard.loading') }}</span>
          </div>
        </template>
      </ClientOnly>
    </div>
  </div>
</template>

<script setup lang="ts">
import DashboardClient from '~/components/Dashboard/DashboardClient.vue'

const { t } = useI18n()

useHead({
  titleTemplate: `Dashboard - ${t('common.app.name')}`
})

definePageMeta({
  middleware: ['dashboard']
})
</script>

<style lang="scss" scoped>
.dashboard-page {
  position: relative;
  min-height: 100vh;
  /* Dashboard 是固定 light 分析页（不接入 data-slax-theme 主题切换），
     teal 底色 + 下方绿色 blob 为刻意的 data-viz 视觉身份，与 reader 暖色改版分离，保留字面值 */
  background: #dff7f3;
  overflow: hidden;
}

.dashboard-content {
  position: relative;
  z-index: 1;
}

.dashboard-fallback {
  --style: min-h-[70vh] flex flex-col items-center justify-center gap-18px text-16px font-500;
  color: var(--slax-text-muted);
}

.dashboard-fallback__spinner {
  --style: text-64px;
  color: var(--slax-chart-primary);
}

/* ── Animated background blobs ── */

.dashboard-bg {
  position: absolute;
  inset: 0;
  pointer-events: none;
  z-index: 0;
}

.dashboard-bg__blob {
  position: absolute;
  border-radius: 50%;
  will-change: transform;
}

.dashboard-bg__blob--1 {
  width: 720px;
  height: 620px;
  background: radial-gradient(circle, #16b998 0%, rgba(22, 185, 152, 0.35) 50%, transparent 100%);
  filter: blur(80px);
  opacity: 0.55;
  top: -160px;
  left: -100px;
  animation: wave1 5s ease-in-out infinite;
}

.dashboard-bg__blob--2 {
  width: 580px;
  height: 500px;
  background: radial-gradient(circle, #52d5b9 0%, rgba(82, 213, 185, 0.3) 50%, transparent 100%);
  filter: blur(70px);
  opacity: 0.48;
  top: 20px;
  right: -80px;
  animation: wave2 6s ease-in-out infinite;
}

.dashboard-bg__blob--3 {
  width: 480px;
  height: 420px;
  background: radial-gradient(circle, #0ea882 0%, rgba(179, 236, 226, 0.35) 50%, transparent 100%);
  filter: blur(60px);
  opacity: 0.45;
  top: 30%;
  left: 50%;
  animation: wave4 5.5s ease-in-out infinite;
}

@keyframes wave1 {
  0% {
    transform: translate(0, 0) scale(1);
  }
  25% {
    transform: translate(160px, 120px) scale(1.12);
  }
  50% {
    transform: translate(80px, 260px) scale(0.92);
  }
  75% {
    transform: translate(-100px, 160px) scale(1.08);
  }
  100% {
    transform: translate(0, 0) scale(1);
  }
}

@keyframes wave2 {
  0% {
    transform: translate(0, 0) scale(1);
  }
  25% {
    transform: translate(-140px, 110px) scale(1.1);
  }
  50% {
    transform: translate(-70px, -160px) scale(0.9);
  }
  75% {
    transform: translate(110px, -90px) scale(1.06);
  }
  100% {
    transform: translate(0, 0) scale(1);
  }
}

@keyframes wave4 {
  0% {
    transform: translate(0, 0) scale(1);
  }
  20% {
    transform: translate(-180px, 90px) scale(1.18);
  }
  40% {
    transform: translate(-100px, 200px) scale(0.88);
  }
  60% {
    transform: translate(140px, 140px) scale(1.1);
  }
  80% {
    transform: translate(180px, -60px) scale(0.94);
  }
  100% {
    transform: translate(0, 0) scale(1);
  }
}
</style>
