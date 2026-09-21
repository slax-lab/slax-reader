<template>
  <div class="question-message" @click="questionClick" :class="{ clickable: question.clickable }">
    <div class="dark-trigger" ref="darkTrigger" />
    <div class="text" v-if="!question.isHTML">
      {{ question.text }}
    </div>
    <div class="text" v-else v-html="question.text"></div>
    <template v-if="question.clickable">
      <i v-if="!isDark()" class="bg-[url('@images/button-tiny-bottom-arrow.png')]"></i>
      <i v-else class="bg-[url('@images/button-tiny-bottom-arrow-dark.png')]"></i>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { type QuestionMessageItem } from './type'
const emits = defineEmits(['questionClick'])
const props = defineProps({
  question: {
    type: Object as PropType<QuestionMessageItem>,
    required: true
  }
})

const darkTrigger = ref<HTMLDivElement>()

const isDark = () => {
  if (!darkTrigger.value) {
    return false
  }

  const style = window.getComputedStyle(darkTrigger.value)
  return style.opacity === '1'
}

const questionClick = () => {
  if (!props.question.clickable) {
    return
  }

  emits('questionClick', props.question)
}
</script>

<style lang="scss" scoped>
.question-message {
  --style: relative w-398px min-h-48px rounded-8px border-(1px solid) py-13px pl-16px pr-19px flex items-center justify-between select-none bg-surface-solid border-border;

  .dark-trigger {
    --style: 'absolute left-0 top-0 w-0 h-0 opacity-0 dark:opacity-100';
  }

  &.clickable {
    --style: cursor-pointer;
  }

  .text {
    --style: text-(meta) line-height-22px font-500 text-txt;

    &:deep(*) {
      --style: text-(meta) line-height-22px font-500 list-none text-txt;
    }
  }

  i {
    --style: w-16px h-16px bg-contain transition-transform duration-normal;
  }
}
</style>
