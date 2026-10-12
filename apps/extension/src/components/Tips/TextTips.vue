<template>
  <div class="text-tips-container" v-element-hover="hoverHandler">
    <slot />
    <Transition name="opacity">
      <div class="text-tips" v-show="tipsApprear">
        <span>{{ tips }}</span>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { vElementHover } from '@vueuse/components'

defineProps({
  tips: {
    type: String,
    required: true
  }
})

const tipsApprear = ref(false)
const isTipsHover = ref(false)

const hoverHandler = (state: boolean) => {
  isTipsHover.value = state

  if (!isTipsHover.value) {
    tipsApprear.value = false
    return
  }

  setTimeout(() => {
    if (isTipsHover.value) {
      tipsApprear.value = true
    }
  }, 500)
}
</script>

<style lang="scss" scoped>
.text-tips-container {
  --style: relative p-0 m-0 flex;

  .text-tips {
    --style: absolute right-0 top-full mt-8px bg-#141414 border-(1px solid #a28d643d) shadow-[0px 40px 80px 0px #00000052] rounded-4px px-6px pt-4px pb-3px flex-center;

    span {
      --style: text-(12px #ffffff66) line-height-17px whitespace-nowrap;
    }
  }
}
</style>
