<template>
  <div class="local-sync-progress">
    <div class="lsp-head">
      <span class="lsp-icon">
        <span class="i-svg-spinners:90-ring lsp-spinner"></span>
      </span>

      <div class="lsp-meta">
        <span class="lsp-title">{{ t('page.bookmarks_index.local_sync.title') }}</span>
        <span class="lsp-subtitle">{{ t('page.bookmarks_index.local_sync.subtitle') }}</span>
      </div>

      <span class="lsp-count">
        <template v-if="total > 0">
          <span class="lsp-percent">{{ percent }}%</span>
          <span class="lsp-ratio">{{ downloaded }} / {{ total }}</span>
        </template>
        <template v-else>{{ t('page.bookmarks_index.local_sync.preparing') }}</template>
      </span>
    </div>

    <div class="lsp-track">
      <div class="lsp-fill" :class="{ 'lsp-fill--indeterminate': total === 0 }" :style="total > 0 ? { width: `${percent}%` } : undefined">
        <span class="lsp-shimmer"></span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
defineProps<{
  percent: number
  downloaded: number
  total: number
}>()

const { t } = useI18n()
</script>

<style lang="scss" scoped>
.local-sync-progress {
  --style: 'mx-auto my-12px max-w-680px w-full px-18px py-14px';
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow:
    var(--slax-shadow-sm),
    inset 0 1px 0 var(--slax-inset-hi);
  backdrop-filter: var(--slax-blur);
}

.lsp-head {
  --style: 'flex items-center gap-12px';
}

/* 图标外圈：中性底 */
.lsp-icon {
  --style: 'shrink-0 flex items-center justify-center w-32px h-32px rounded-full';
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  color: var(--slax-text-muted);
}

.lsp-spinner {
  --style: 'w-16px h-16px';
}

.lsp-meta {
  --style: 'flex flex-col min-w-0';
}

.lsp-title {
  --style: 'font-500 truncate';
  font-family: var(--slax-font-serif);
  font-size: var(--slax-fs-card);
  letter-spacing: -0.01em;
  color: var(--slax-text);
}

.lsp-subtitle {
  --style: 'mt-1px truncate';
  font-size: var(--slax-fs-aux);
  font-weight: 300;
  color: var(--slax-text-light);
}

.lsp-count {
  --style: 'ml-auto shrink-0 flex flex-col items-end';
  font-size: var(--slax-fs-tag);
  color: var(--slax-text-light);
}

.lsp-percent {
  --style: 'font-600 tabular-nums leading-none';
  font-size: var(--slax-fs-card);
  color: var(--slax-accent);
}

.lsp-ratio {
  --style: 'mt-3px tabular-nums';
}

.lsp-track {
  --style: 'mt-12px h-6px w-full overflow-hidden rounded-full relative';
  background: var(--slax-border);
}

.lsp-fill {
  --style: 'absolute inset-y-0 left-0 h-full rounded-full overflow-hidden';
  min-width: 6px;
  background: linear-gradient(90deg, color-mix(in srgb, var(--slax-accent) 70%, transparent), var(--slax-accent));
  transition: width var(--slax-dur-normal) var(--slax-ease-spring);
}

/* 流光扫过，强化进行中感 */
.lsp-shimmer {
  --style: 'absolute inset-0';
  background: linear-gradient(90deg, transparent, color-mix(in srgb, white 45%, transparent), transparent);
  transform: translateX(-100%);
  animation: lsp-shimmer 1.6s ease-in-out infinite;
}

.lsp-fill--indeterminate {
  width: 36%;
  animation: lsp-indeterminate 1.3s var(--slax-ease-spring) infinite;
}

@keyframes lsp-shimmer {
  0% {
    transform: translateX(-100%);
  }
  60%,
  100% {
    transform: translateX(100%);
  }
}

@keyframes lsp-indeterminate {
  0% {
    left: -36%;
  }
  100% {
    left: 100%;
  }
}
</style>
