<template>
  <!-- 空数据视图：圆形 icon 容器 + 衬线标题 + 描述文字，对齐 demo .empty-view -->
  <div class="empty-view">
    <div class="empty-view-icon">
      <slot name="icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10" />
        </svg>
      </slot>
    </div>
    <h3 class="empty-view-title">{{ title }}</h3>
    <p class="empty-view-desc">{{ desc }}</p>
    <button v-if="actionText" class="empty-view-action" type="button" @click="emit('action')">{{ actionText }}</button>
    <p v-if="actionNote" class="empty-view-action-note">{{ actionNote }}</p>
  </div>
</template>

<script setup lang="ts">
defineProps<{
  title: string
  desc: string
  actionText?: string
  actionNote?: string
}>()

const emit = defineEmits<{ action: [] }>()
</script>

<style lang="scss" scoped>
.empty-view {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 96px 24px 48px;
  user-select: none;
  -webkit-user-select: none;
}

.empty-view-icon {
  width: 72px;
  height: 72px;
  border-radius: 50%;
  background: var(--slax-surface);
  border: 1px solid var(--slax-border);
  box-shadow: inset 0 1px 0 var(--slax-inset-hi);
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--slax-text-light);
  margin-bottom: 24px;

  svg {
    opacity: 0.7;
  }
}

.empty-view-title {
  font-family: var(--slax-font-serif);
  font-size: 20px;
  font-weight: 500;
  color: var(--slax-text);
  margin: 0 0 8px;
  letter-spacing: 0.01em;
}

.empty-view-desc {
  font-size: 14px;
  color: var(--slax-text-light);
  margin: 0;
  line-height: 1.7;
  max-width: 400px;
}

.empty-view-action {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-height: 32px;
  margin-top: 24px;
  padding: 7px 16px;
  border: 1px solid var(--slax-accent);
  border-radius: var(--slax-radius-sm, 8px);
  background: var(--slax-accent);
  color: var(--slax-btn-text);
  font: inherit;
  font-size: 13px;
  font-weight: 500;
  line-height: 1;
  cursor: pointer;
  transition:
    opacity 0.15s,
    transform 0.15s;

  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  &:active {
    opacity: 0.8;
    transform: scale(0.98);
  }
}

.empty-view-action-note {
  margin: 12px 0 0;
  color: var(--slax-text-light);
  font-size: 13px;
  font-weight: 400;
  line-height: 1.6;
}
</style>
