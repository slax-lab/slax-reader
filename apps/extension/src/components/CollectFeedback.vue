<script setup lang="ts">
import DotLoading from './DotLoading.vue'

defineProps<{
  title: string
  status: string
  closeLabel: string
  loading?: boolean
  success?: boolean
  expanded?: boolean
  standalone?: boolean
}>()
defineEmits<{ close: [] }>()
</script>

<template>
  <div class="slax-popup" :class="{ 'slax-popup-loading': loading, expanded, standalone }" :aria-busy="loading">
    <div class="header">
      <div class="status" role="status" aria-live="polite">
        <DotLoading v-if="loading" aria-hidden="true" />
        <img v-else-if="success" class="smile" src="@/assets/smile_face.svg" alt="" />
        <span>{{ status }}</span>
      </div>
      <button v-if="!loading" type="button" :aria-label="closeLabel" @click="$emit('close')">
        <img src="@/assets/close.svg" alt="" />
      </button>
    </div>
    <div class="title"><slot name="title">{{ title }}</slot></div>
    <slot />
  </div>
</template>

<style lang="scss" scoped>
.slax-popup {
  /* Preserve the existing light collection renderer; see DESIGN.md's Extension exception. */
  --collect-surface: #fff;
  --collect-text: #0f1419;
  --collect-muted: #999;
  --collect-accent: #5490c2;
  --collect-border: #3333330d;
  --style: fixed top-2 right-2 w-75 z-99999999 rounded-2xl p-5 pt-6 box-border select-none transition-max-height duration-250 ease-in-out max-h-50 overflow-hidden;
  background: var(--collect-surface);
  color: var(--collect-text);
  border: 1px solid var(--collect-border);
  box-shadow: 0 20px 60px #0000001a;
  &.slax-popup-loading { max-height: 130px; }
  &.expanded { max-height: none; }
  &.standalone { position: relative; top: auto; right: auto; width: 100%; max-height: none; box-shadow: none; border: 0; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 8px; }
  .status {
    font-size: 13px; line-height: 18px; color: var(--collect-muted); display: flex; align-items: center; gap: 8px;
    span { overflow-wrap: anywhere; }
    img { flex: none; }
  }
  .smile { --style: animate-tada; }
  .header button {
    --style: flex-center w-16px h-16px p-0 hover:opacity-80;
    border: 0; background: transparent; cursor: pointer; flex: none;
    img { width: 100%; height: 100%; }
  }
  button:focus-visible { outline: 2px solid var(--collect-accent); outline-offset: 3px; }
  .title { margin-top: 16px; font-size: 16px; font-weight: bold; line-height: 24px; overflow-wrap: anywhere; }
  &:not(.expanded) .title { display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 2; overflow: hidden; }
}
@media (prefers-reduced-motion: reduce) {
  .slax-popup { transition: none; }
  .smile { animation: none; }
  :deep(.dot) { animation: none; }
}
</style>
