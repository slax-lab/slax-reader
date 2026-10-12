<template>
  <!-- 浮动添加按钮：固定在右下角，宽屏时跟随内容区右边缘 -->
  <button class="fab" type="button" data-analytics-element="bookmark_add_button" :title="$t('page.bookmarks_index.add_article')" @click="$emit('click')">
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M12 5v14M5 12h14" />
    </svg>
  </button>
</template>

<script setup lang="ts">
defineEmits<{ click: [] }>()
</script>

<style lang="scss" scoped>
.fab {
  position: fixed;
  bottom: 48px;
  right: 16px;
  width: 52px;
  height: 52px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: var(--slax-shadow-warm);
  backdrop-filter: var(--slax-blur);
  cursor: pointer;
  transition: all 0.2s;
  color: var(--slax-text-muted);
  z-index: 40;

  &:hover {
    transform: translateY(-2px) scale(1.04);
    color: var(--slax-accent);
    box-shadow:
      var(--slax-shadow-warm),
      0 8px 24px color-mix(in srgb, var(--slax-accent) 20%, transparent);
  }

  &:active {
    transform: scale(0.97);
  }

  // 宽屏（≥1256px）：跟随内容区右边缘
  @media (min-width: 1256px) {
    right: auto;
    left: calc(50% + var(--slax-shell-w, 1200px) / 2 - 24px);
  }
}
</style>
