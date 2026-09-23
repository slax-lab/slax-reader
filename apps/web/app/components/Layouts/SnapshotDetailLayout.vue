<template>
  <div
    class="snapshot-detail-layout"
    :class="{ 'h5-mode': isH5, 'panel-pushed': layoutMode === 'push' || layoutMode === 'push-soft' }"
    :style="{ '--slax-push-amount': pushAmount + 'px' }"
  >
    <slot name="topbar" />
    <slot name="tips" />
    <main class="snapshot-content">
      <slot />
    </main>
    <slot name="right-edge-toolbar" />
    <slot name="bottom-toolbar" />
    <slot name="side-panel" />
  </div>
</template>

<script lang="ts" setup>
import { useSnapshotLayout } from '~/composables/useSnapshotLayout'

defineEmits<{
  'close-panel': []
}>()

const { isH5, layoutMode, pushAmount, panelOpen } = useSnapshotLayout()

// H5 打开面板时锁定 body 滚动
if (import.meta.client) {
  watch(
    () => isH5.value && panelOpen.value,
    locked => {
      document.body.style.overflow = locked ? 'hidden' : ''
    }
  )
  onUnmounted(() => {
    document.body.style.overflow = ''
  })
}

defineExpose({ isH5, layoutMode, pushAmount, panelOpen })
</script>

<style lang="scss" scoped>
.snapshot-detail-layout {
  --style: w-full min-h-screen relative;
  padding-right: var(--slax-push-amount, 0px);
  transition: padding-right 0.3s cubic-bezier(0.16, 1, 0.3, 1);
}

.snapshot-content {
  --style: w-full flex flex-col items-center;
  padding-top: var(--slax-header-h-snapshot);

  @media (max-width: 768px) {
    padding-top: var(--slax-header-h-mobile);
  }
}
</style>
