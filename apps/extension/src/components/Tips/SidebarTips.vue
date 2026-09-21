<template>
  <div class="sidebar-tips" @click="closeClick">
    <slot />
    <Transition name="opacity">
      <div v-show="showTips" class="bubble-tips" :style="{ width: bubbleWidth + 'px' }">
        <svg class="bubble-svg" v-if="containerHeight" preserveAspectRatio="none" :viewBox="viewBox" xmlns="http://www.w3.org/2000/svg">
          <defs>
            <linearGradient id="grad1" x1="50%" y1="0%" x2="50%" y2="100%">
              <stop offset="0%" style="stop-color: #e0fff1ff; stop-opacity: 1" />
              <stop offset="100%" style="stop-color: #fcfffdff; stop-opacity: 1" />
            </linearGradient>
          </defs>
          <path :d="svgPath" fill="url(#grad1)" stroke="#BEF6E4" stroke-width="1" />
        </svg>
        <div class="bubble-container" :style="{ 'margin-top': topGap + 'px', 'margin-right': rightGap + 'px' }" ref="bubbleContainer" v-resize-observer="[onResizeObserver, {}]">
          <span class="bubble-title">{{ $t('common.tips.sidebar_tips') }}</span>
        </div>
        <button class="bubble-close">
          <img src="@/assets/tiny-close-icon.png" />
        </button>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { LocalStorageKey } from '@commons/types/const'
import { vResizeObserver } from '@vueuse/components'
import { storage } from '@wxt-dev/storage'

//TODO: 后续这个提示组件最好抽象出来，建议以动态添加的形式实现
// 原因：1：slot里面的组件原先外部对它的样式会丢失。2：后续可能会有很多类似这种气泡提示需要实现
const sidebarTips = storage.defineItem<boolean>(`${LocalStorageKey.SIDE_BAR_TIPS}`, { fallback: false })

const showTips = ref(false)
const bubbleContainer = ref<HTMLDivElement>()
const triangle = {
  left: 10,
  right: 23,
  width: 4,
  height: 8
}

const topGap = 0
const rightGap = triangle.width
const radius = 8
const containerHeight = ref(bubbleContainer.value?.offsetHeight)
const bubbleHeight = computed(() => {
  return containerHeight.value ? containerHeight.value + 16 * 2 : 50
})
const bubbleWidth = 170

const viewBox = computed(() => {
  return `0 0 ${bubbleWidth} ${bubbleHeight.value + 1}`
})
const svgPath = computed(() => {
  return `
    M ${radius + 1},${topGap}
    Q 1,${topGap} 1,${topGap + radius}
    V ${bubbleHeight.value - radius}
    Q 1,${bubbleHeight.value} ${radius + 1},${bubbleHeight.value} 
    H ${bubbleWidth - rightGap - radius}
    Q ${bubbleWidth - rightGap},${bubbleHeight.value} ${bubbleWidth - rightGap},${bubbleHeight.value - radius} 
    V ${topGap + bubbleHeight.value / 2 + triangle.height / 2}
    L ${bubbleWidth},${topGap + bubbleHeight.value / 2}
    L ${bubbleWidth - rightGap},${topGap + bubbleHeight.value / 2 - triangle.height / 2}
    V ${topGap + radius}
    Q ${bubbleWidth - rightGap},${topGap} ${bubbleWidth - rightGap - radius},${topGap} 
    Z
`
})

const closeClick = () => {
  if (!showTips.value) {
    return
  }

  sidebarTips.setValue(true)
  showTips.value = false
}

onMounted(async () => {
  containerHeight.value = bubbleContainer.value?.offsetHeight

  const showSidebarTips = !(await sidebarTips.getValue())
  showTips.value = showSidebarTips
})

const onResizeObserver = (entries: unknown | ReadonlyArray<ResizeObserverEntry>) => {
  if (!Array.isArray(entries)) {
    return
  }

  const entry = entries[0] as ResizeObserverEntry
  const { height } = entry.contentRect
  containerHeight.value = height
}
</script>

<style lang="scss" scoped>
.sidebar-tips {
  --style: relative;

  .bubble-tips {
    --style: absolute z-1 top-1/2 right-full -translate-y-1/2 mr-8px overflow-hidden select-none cursor-pointer;

    .bubble-svg {
      --style: absolute left-0 top-0 w-full h-full;
    }

    .bubble-container {
      --style: relative z-2 flex items-center p-16px whitespace-pre-wrap shadow-[0px_30px_60px_0px_#00000014];

      .bubble-title {
        --style: text-(12px #333333ff) line-height-17px;
      }
    }

    .bubble-close {
      --style: absolute flex top-8px right-14px p-0;
      img {
        --style: size-8px object-fit;
      }
    }
  }
}
</style>
