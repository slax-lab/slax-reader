<template>
  <!-- 内容尽头，左右各一枚 em-dash -->
  <div class="list-end-hint">— {{ text }} —</div>
</template>

<script lang="ts" setup>
defineProps<{ text: string }>()
</script>

<style lang="scss" scoped>
.list-end-hint {
  // 衬线斜体淡色，对齐 demo
  text-align: center;
  font-family: var(--slax-font-serif);
  font-size: 13px;
  font-weight: 300;
  font-style: italic;
  color: var(--slax-text-light);
  user-select: none;
}
</style>
