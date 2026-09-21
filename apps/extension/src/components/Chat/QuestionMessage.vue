<template>
  <div class="question-message" @click="questionClick" :class="{ clickable: question.clickable }">
    <div class="text" v-if="!question.isHTML">
      {{ question.text }}
    </div>
    <div class="text" v-else v-html="question.text"></div>
    <i v-if="question.clickable" class="bg-[url('@/assets/button-tiny-bottom-arrow.png')]"></i>
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

const questionClick = () => {
  if (!props.question.clickable) {
    return
  }

  emits('questionClick', props.question)
}
</script>

<style lang="scss" scoped>
.question-message {
  --style: w-398px min-h-48px bg-#1F1F1FFF rounded-8px border-(1px solid #ffffff0a) py-13px pl-16px pr-19px flex items-center justify-between select-none;

  &.clickable {
    --style: cursor-pointer;
  }

  .text {
    --style: text-(15px #ffffffcc) line-height-22px font-500;

    &:deep(*) {
      --style: text-(15px #ffffffcc) line-height-22px font-500 list-none;
    }
  }

  i {
    --style: shrink-0 w-16px h-16px bg-contain transition-transform duration-250;
  }
}
</style>
