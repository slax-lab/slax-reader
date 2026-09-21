<template>
  <header class="snapshot-topbar">
    <div class="topbar-inner">
      <div class="topbar-left">
        <slot name="left" />
        <slot name="theme-switcher" />
      </div>
      <div class="topbar-right">
        <slot name="right" />
      </div>
    </div>
  </header>
</template>

<script lang="ts" setup></script>

<style lang="scss" scoped>
.snapshot-topbar {
  --style: fixed top-0 left-0 right-0 z-50;
  height: var(--slax-header-h-snapshot);
  background: var(--slax-topbar-bg);
  backdrop-filter: var(--slax-blur);
  border-bottom: 1px solid var(--slax-border);

  @media (max-width: 768px) {
    height: var(--slax-header-h-mobile);
  }
}

.topbar-inner {
  --style: h-full max-w-960px mx-auto px-24px flex items-center justify-between;
}

.topbar-left {
  --style: flex items-center gap-12px;
}

.topbar-right {
  --style: flex items-center gap-16px;
}
</style>
