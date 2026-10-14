<template>
  <div class="detail-layout" :class="{ animated }">
    <div class="small-screen-trigger" ref="smallScreenTrigger"></div>
    <div class="responsive-width shadow-content" ref="shadowContent" :style="contentXOffset ? { transform: `translateX(${-contentXOffset}px)` } : {}">
      <div class="panel-container">
        <slot name="panel" />
      </div>
    </div>
    <div class="content responsive-width" :style="contentXOffset ? { transform: `translateX(${-contentXOffset}px)` } : {}">
      <div v-if="$slots.tips" class="tips-container">
        <div class="tips">
          <slot name="tips" />
        </div>
      </div>
      <div class="header-container">
        <slot name="header" />
      </div>
      <div class="detail-container" data-allow-mismatch="children">
        <slot name="detail" />
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
defineProps({
  contentXOffset: {
    type: Number,
    default: 0
  },
  animated: {
    type: Boolean,
    required: false
  }
})

const shadowContent = ref<HTMLDivElement>()
const smallScreenTrigger = ref<HTMLDivElement>()

const contentWidth = () => {
  return shadowContent.value?.getBoundingClientRect().width || 0
}

const isSmallScreen = () => {
  if (!smallScreenTrigger.value) {
    return false
  }

  const style = window.getComputedStyle(smallScreenTrigger.value)
  return style.opacity === '1'
}

defineExpose({
  contentWidth,
  isSmallScreen
})
</script>

<style lang="scss" scoped>
.detail-layout {
  --style: w-full min-h-screen relative flex justify-center items-start;

  &.animated {
    .shadow-content {
      --style: transition-transform duration-200;
    }

    .content {
      --style: transition-transform duration-200;
    }
  }

  .small-screen-trigger {
    --style: 'h-0 bg-transparent max-md:(opacity-100) md:(opacity-0)';
  }

  .shadow-content {
    --style: 'fixed top-0 h-screen bg-transparent max-md:(!w-full)';

    .panel-container {
      --style: absolute left-full bottom-68px ml-60px flex-center;
    }
  }

  .content {
    --style: 'relative min-h-screen flex-1 max-md:(pb-10 !w-full)';

    .tips-container {
      --style: relative h-40px;

      .tips {
        --style: absolute left-1/2 top-0 w-screen h-full -translate-x-1/2;
      }
    }

    .header-container {
      --style: h-header border-b-(1px solid border);
    }

    .detail-container {
      --style: mt-32px;
    }
  }

  .responsive-width {
    --style: 'max-w-2xl max-md:(pl-5 pr-5) md:(w-2xl)';
  }
}
</style>
