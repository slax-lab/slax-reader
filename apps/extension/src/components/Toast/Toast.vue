<template>
  <Transition name="toast" @after-leave="onAfterLeave">
    <div class="text-toast" :class="{ success: type === ToastType.Success, error: type === ToastType.Error }" v-show="showToast">
      <span>{{ text }}</span>
    </div>
  </Transition>
</template>

<script lang="ts" setup>
import { nextTick, onUnmounted, ref } from 'vue'

import { ToastType } from './type'

const emits = defineEmits(['dismiss'])
defineProps<{
  type: ToastType
  text: string
}>()

const showToast = ref<boolean>(false)
nextTick(() => {
  showToast.value = true

  setTimeout(() => {
    showToast.value = false
  }, 2500)
})

onUnmounted(() => {
  console.log('component dismiss.')
})
const onAfterLeave = () => {
  emits('dismiss')
}
</script>

<style lang="scss" scoped>
.text-toast {
  --style: select-none max-w-md min-w-140px flex-center rounded-6px bg-black bg-opacity-50 flex-wrap whitespace-break-spaces text-center color-white overflow-hidden text-ellipsis
    py-6px px-16px text-(14px) line-height-20px shadow-[0px_20px_30px_0px_#0000000a];

  &.success {
    --style: border-(1px solid #16b998) bg-#E7FAF6 text-(#16b998);
  }

  &.error {
    --style: border-(1px solid #f4c982) bg-#FFF6E7 text-(#f19943);
  }

  span {
    --style: w-full max-h-10 overflow-hidden text-ellipsis whitespace-nowrap;
  }
}

.toast-leave-to {
  --style: -translate-y-full;
}

.toast-enter-from {
  --style: translate-y-full;
}

.toast-leave-to,
.toast-enter-from {
  --style: opacity-0;
}

.toast-enter-active,
.toast-leave-active {
  --style: transition-all duration-250 ease-in-out;
}
</style>

<!-- eslint-disable vue-scoped-css/enforce-style-type -->
<style lang="scss">
.toast.toast-start {
  --style: fixed top-0 left-1/2 -translate-x-1/2 flex items-center flex-col pt-6px;

  & > * {
    --style: 'not-first:mt-6px';
  }
}
</style>
