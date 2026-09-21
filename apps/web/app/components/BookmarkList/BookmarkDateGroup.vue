<template>
  <!-- 日期分组标签：显示年月分组标题 -->
  <div class="date-group">
    <div class="date-group-label">{{ label }}</div>
  </div>
</template>

<script setup lang="ts">
defineProps<{ label: string }>()
</script>

<style lang="scss" scoped>
.date-group {
  --style: mb-8px;
}

.date-group-label {
  font-size: 12px;
  color: var(--slax-text-light);
  font-weight: 400;
  padding: 16px 4px 8px;
  letter-spacing: 0.03em;
}
</style>
