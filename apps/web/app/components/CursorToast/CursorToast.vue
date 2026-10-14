<template>
  <Transition name="cursor-toast" @after-leave="onAfterLeave">
    <div class="cursor-toast" :class="{ error: type === ToastType.Error }" v-show="showToast">
      <span>{{ text }}</span>
    </div>
  </Transition>
</template>

<script lang="ts" setup>
import { type PropType, ref } from 'vue'

import { ToastType } from '~/components/Toast/type'

const emits = defineEmits(['dismiss'])
const props = defineProps({
  text: {
    type: String,
    required: true
  },
  duration: {
    type: Number,
    required: false,
    default: 1000
  },
  type: {
    type: String as PropType<ToastType>,
    required: false,
    default: ToastType.Normal
  }
})

const showToast = ref<boolean>(false)

onMounted(() => {
  showToast.value = true

  setTimeout(() => {
    showToast.value = false
  }, props.duration)
})

const onAfterLeave = () => {
  emits('dismiss')
}
</script>

<style lang="scss" scoped>
.cursor-toast {
  --style: select-none flex-center whitespace-nowrap;
  max-width: 240px;
  padding: 5px 12px;
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  box-shadow: var(--slax-shadow-warm);
  backdrop-filter: var(--slax-blur);
  -webkit-backdrop-filter: var(--slax-blur);
  font-size: var(--slax-fs-aux);
  line-height: 1.4;

  /* 错误态：danger 文字色 */
  &.error {
    color: var(--slax-danger);
  }

  span {
    --style: overflow-hidden text-ellipsis whitespace-nowrap;
  }
}

.cursor-toast-leave-to {
  --style: -translate-y-full;
}

.cursor-toast-enter-from {
  --style: translate-y-full;
}

.cursor-toast-leave-to,
.cursor-toast-enter-from {
  --style: opacity-0;
}

.cursor-toast-enter-active,
.cursor-toast-leave-active {
  --style: transition-all duration-normal ease-in-out;
}
</style>
