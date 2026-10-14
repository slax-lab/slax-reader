<template>
  <div class="tips-message">
    <template v-if="tips.tipsType === 'generateQuestion'">
      <div class="generate-question">
        <div class="question-text">
          <span>{{ $t('component.chat_tips_message.generate_question_title') }}</span>
        </div>
      </div>
    </template>
    <template v-if="tips.tipsType === 'error'">
      <div class="error-tips">
        <div class="error-text">
          <span>{{ tips.data }}</span>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import type { TipsMessageItem } from './type'

defineProps({
  tips: {
    type: Object as PropType<TipsMessageItem>,
    required: true
  }
})
</script>

<style lang="scss" scoped>
.tips-message {
  --style: w-full;

  .generate-question {
    --style: pb-8px;

    .question-text {
      --style: pl-12px relative;

      &::before {
        --style: content-empty absolute left-0 top-1/2 -translate-y-1/2 w-4px h-4px bg-#a8b1cd rounded-full;
      }

      span {
        --style: text-(13px #999) line-height-22px font-500;
      }
    }
  }

  .error-tips {
    --style: pb-8px;

    .error-text {
      --style: w-full relative flex-center;
      span {
        --style: text-(13px #999) line-height-22px font-500;
      }
    }
  }
}
</style>
