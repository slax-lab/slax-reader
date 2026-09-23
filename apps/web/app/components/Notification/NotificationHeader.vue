<template>
  <div class="notifications-header" v-show="showHeader">
    <button class="back-btn" @click="back">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
        <polyline points="15 18 9 12 15 6" />
      </svg>
      <span>{{ $t('component.notification_header.title') }}</span>
    </button>
  </div>
</template>

<script lang="ts" setup>
const emits = defineEmits(['back'])
const showHeader = ref(false)

onMounted(() => {
  const history = window.history
  showHeader.value = history.length > 2
})

const back = () => {
  emits('back')
}
</script>

<style lang="scss" scoped>
.notifications-header {
  padding-bottom: 20px;
  border-bottom: 1px solid var(--slax-border);
  margin-bottom: 16px;
}

.back-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 10px;
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  background: transparent;
  color: var(--slax-text-muted);
  font-size: 13px;
  font-family: inherit;
  cursor: pointer;
  transition: all 0.15s;

  &:hover {
    background: var(--slax-surface);
    color: var(--slax-text);
    border-color: color-mix(in srgb, var(--slax-accent) 30%, var(--slax-border));
  }

  span {
    font-weight: 500;
    color: var(--slax-text);
  }
}
</style>
