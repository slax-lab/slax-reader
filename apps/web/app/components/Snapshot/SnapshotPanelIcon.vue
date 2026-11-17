<template>
  <span class="snapshot-panel-icon" :class="{ 'is-loading': loading }" :data-panel-icon="panel" :style="{ width: size + 'px', height: size + 'px' }">
    <AppIcon class="panel-icon-art" :name="name" :size="size" />
    <span class="panel-icon-ring" aria-hidden="true" />
    <span class="panel-icon-status" role="status">{{ $t('common.operate.loading') }}</span>
  </span>
</template>

<script setup lang="ts">
import AppIcon from '~/components/AppIcon.vue'

import type { SnapshotPanelId } from '~/components/Snapshot/panels'
import type { IconKey } from '~/icons/registry'

withDefaults(defineProps<{
  panel: SnapshotPanelId
  name: IconKey
  size: number
  loading?: boolean
}>(), { loading: false })
</script>

<style lang="scss" scoped>
.snapshot-panel-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.panel-icon-ring {
  display: none;
  color: var(--slax-accent);
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  border: 1.5px solid currentColor;
  border-right-color: transparent;
  border-radius: 50%;
  animation: panel-icon-spin 0.8s linear infinite;
}

.panel-icon-status {
  display: none;
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}

@mixin busy-icon {
  .panel-icon-art { display: none; }
  .panel-icon-ring,
  .panel-icon-status { display: block; }
}

.is-loading { @include busy-icon; }

// The critical startup script owns this marker outside the hydrated app tree.
@each $panel in ai, transcript, chat, comment {
  :global(html[data-slax-pending-panel='#{$panel}'] [data-panel-icon='#{$panel}'] .panel-icon-art) {
    display: none;
  }
  :global(html[data-slax-pending-panel='#{$panel}'] [data-panel-icon='#{$panel}'] .panel-icon-ring),
  :global(html[data-slax-pending-panel='#{$panel}'] [data-panel-icon='#{$panel}'] .panel-icon-status) {
    display: block;
  }
}

@keyframes panel-icon-spin {
  to { transform: rotate(360deg); }
}

@media (prefers-reduced-motion: reduce) {
  .panel-icon-ring { animation: none; }
}
</style>
