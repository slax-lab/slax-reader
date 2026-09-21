<template>
  <div class="h-full w-full flex items-start justify-start" style="background: #faf8f2; font-family: 'Inter', 'Noto Sans SC', sans-serif; padding: 56px 64px">
    <!-- 左侧 accent 竖线装饰 -->
    <div style="width: 4px; border-radius: 2px; background: #b45837; margin-right: 40px; flex-shrink: 0; align-self: stretch" />

    <div class="h-full w-full flex flex-col justify-between">
      <!-- 标题区 -->
      <div class="flex flex-col" style="gap: 16px">
        <p style="font-size: 14px; font-weight: 400; color: #b45837; letter-spacing: 0.08em; text-transform: uppercase; margin: 0">Slax Reader</p>
        <p class="line-clamp-4 overflow-hidden" style="font-size: 56px; font-weight: 700; color: #1a1814; line-height: 1.2; margin: 0">
          {{ title }}
        </p>
      </div>

      <!-- 底部品牌 -->
      <div class="flex items-center" style="gap: 12px">
        <div style="width: 24px; height: 2px; background: #e4b894; border-radius: 1px" />
        <p style="font-size: 20px; font-weight: 400; color: #6a5f52; margin: 0">r.slax.com</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    title?: string
  }>(),
  {
    title: 'title'
  }
)
</script>
