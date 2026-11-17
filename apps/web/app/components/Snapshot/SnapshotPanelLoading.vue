<template>
  <div class="snapshot-panel-loading" role="status" :aria-label="$t('common.operate.loading')">
    <DotLoading aria-hidden="true" />
  </div>
</template>

<script setup lang="ts">
import DotLoading from '~/components/DotLoading.vue'
</script>

<style scoped>
.snapshot-panel-loading {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 100%;
  height: 100%;
}

@media (prefers-reduced-motion: reduce) {
  .snapshot-panel-loading :deep(.dot) {
    animation: none !important;
  }
}
</style>
