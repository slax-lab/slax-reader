<template>
  <Transition name="cursor-toast" @after-leave="onAfterLeave">
    <div class="cursor-toast" :class="{ error: type === ToastType.Error, 'with-action': !!action }" v-show="showToast">
      <span>{{ text }}</span>
      <button v-if="action" type="button" class="cursor-toast-action" @click="onAction">{{ action.text }}</button>
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
  },
  action: {
    type: Object as PropType<{ text: string; onClick: () => void }>,
    required: false,
    default: undefined
  }
})

const showToast = ref<boolean>(false)

onMounted(() => {
  showToast.value = true

  setTimeout(() => {
    showToast.value = false
  }, props.duration)
})

const onAction = () => {
  props.action?.onClick()
  showToast.value = false
}

const onAfterLeave = () => {
  emits('dismiss')
}
</script>

<style lang="scss" scoped>
.cursor-toast {
  --style: select-none flex-center whitespace-nowrap;
  max-width: min(240px, calc(100vw - 24px), 100%);
  padding: 5px 12px;
  background: var(--slax-surface-solid);
  color: var(--slax-text);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius-sm);
  box-shadow: var(--slax-shadow-warm);
  -webkit-backdrop-filter: var(--slax-blur);
  backdrop-filter: var(--slax-blur);
  font-size: var(--slax-fs-aux);
  line-height: 1.4;

  /* 错误态：danger 文字色 */
  &.error {
    color: var(--slax-danger);
  }

  &.with-action {
    max-width: min(320px, calc(100vw - 24px));
    gap: 10px;
  }

  span {
    --style: overflow-hidden text-ellipsis whitespace-nowrap;
    min-width: 0;
  }
}

.cursor-toast-action {
  flex: none;
  min-height: 28px;
  padding: 0;
  border: none;
  background: none;
  color: var(--slax-accent);
  font: inherit;
  font-weight: 400;
  line-height: 1.4;
  white-space: nowrap;
  cursor: pointer;

  &:focus-visible {
    outline: 2px solid var(--slax-accent);
    outline-offset: 2px;
    border-radius: 2px;
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
