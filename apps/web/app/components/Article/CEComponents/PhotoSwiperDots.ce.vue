<template>
  <div class="photo-swiper-dots">
    <div v-for="dot in dots" :key="dot" class="dot" :class="{ selected: selectIndex === dot }" @click="dotClick(dot)"></div>
  </div>
</template>

<script lang="ts" setup>
const props = defineProps({
  count: {
    type: Number,
    required: true
  },
  selectIndex: {
    type: Number,
    required: false,
    default: 0
  }
})
const emits = defineEmits(['indexSelected'])

const dots = Array.from({ length: props.count }, (_, i) => i)
const dotClick = (index: number) => {
  emits('indexSelected', index)
}

const test = () => {}

defineExpose({ test })
</script>

<style lang="scss" scoped>
.photo-swiper-dots {
  --style: w-full flex mt-24px items-center justify-center;
  .dot {
    // 未选中：浅灰小圆点
    --style: 'cursor-pointer w-6px h-6px rounded-full bg-txt/25 not-first:(ml-6px) hover:(scale-105) transition-all duration-normal';
    &.selected {
      // 选中：强调色胶囊，
      // 靠颜色+宽度区分
      --style: w-18px bg-[var(--slax-accent)];
    }
  }
}
</style>
