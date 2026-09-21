<template>
  <div class="ai-language-tips">
    <button v-element-hover="onHover">
      <img src="@images/button-tiny-faq-outline.png" />
    </button>
    <Transition name="opacity">
      <div class="bubble-container" v-show="isShowBubble" ref="bubbleContainer">
        <span>{{ $t('common.tips.ai_response_language') }}</span>
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { vElementHover } from '@vueuse/components'

const isShowBubble = ref(false)

// 第四期 Sprint B.2：抽出具名 onHover 替代内联回调
// Why：v-element-hover 内联回调在 happy-dom 不可达 + v8 functions 覆盖把 inline 算成独立函数，
//      导致 functions 覆盖只到 50%。具名后 spec 可直接调 setupState.onHover(true/false) 驱动。
const onHover = (state: boolean) => {
  isShowBubble.value = state
}
</script>

<style lang="scss" scoped>
.ai-language-tips {
  --style: relative select-none flex-center;

  button {
    --style: size-16px flex-center;
    img {
      --style: object-contain size-full;
    }
  }

  .bubble-container {
    // bg-#0F1419FF 深色 tooltip 反色底，保留
    --style: -ml-12px mt-11px z-12 absolute top-full left-0 px-8px py-7px bg-#0F1419FF flex items-center rounded-6px shadow-[0px_20px_30px_0px_#0000001f];

    &::before {
      --style: content-empty absolute -top-5px left-16px w-0 h-0 border-(solid transparent l-4px r-4px) border-t-(0px solid transparent) border-b-(5px solid #0f1419ff);
    }

    span {
      --style: text-(#fcfcfcff 13px) line-height-13px whitespace-nowrap;
    }
  }
}
</style>
