<template>
  <div class="top-tips" v-show="isShow" :style="{ background: backgroundColor ? backgroundColor : 'txt-btn' }">
    <div class="tips responsive-width">
      <slot name="left"></slot>
      <span class="flex-1">{{ tipsText }}</span>
      <button class="shrink-0" :style="{ color: buttonTextColor || '#5490C2' }" :class="{ enabled: buttonEnabled }" @click="() => buttonEnabled && $emit('clickButton')">
        {{ buttonText }}
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
defineProps({
  isShow: {
    type: Boolean,
    required: true
  },
  tipsText: {
    type: String,
    required: true
  },
  buttonText: {
    type: String,
    required: false
  },
  buttonTextColor: {
    type: String,
    required: false
  },
  buttonEnabled: {
    type: Boolean,
    default: true
  },
  backgroundColor: {
    type: String,
    required: false
  }
})

defineEmits(['clickButton'])
</script>

<style lang="scss" scoped>
.top-tips {
  --style: relative w-full h-full py-10px flex-center select-none overflow-hidden;

  .tips {
    --style: w-full flex items-center line-height-20px;

    * {
      --style: text-(meta);
    }

    span {
      --style: text-(txt ellipsis) whitespace-nowrap overflow-hidden;
    }

    button {
      --style: cursor-auto;

      &.enabled {
        --style: 'cursor-pointer underline underline-#5490C2 transition-transfrom duration-normal hover:(scale-105) active:(scale-110)';
      }
    }

    * + * {
      --style: ml-10px;
    }
  }

  .responsive-width {
    --style: ' max-w-2xl max-md:(pl-5 pr-5) md:(w-2xl)';
  }
}
</style>
