<template>
  <div class="feedback-modal" :class="{ appear }" @click="() => !isLoading && closeModal()">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-content" v-show="appear" @click.stop>
        <div class="header">
          <span v-if="title || href">{{ $t('component.feedback.title') }}</span>
          <span v-else>{{ $t('component.feedback.name') }}</span>
          <button class="close" @click="closeModal">
            <img src="@/assets/button-dialog-close.png" />
          </button>
        </div>
        <div class="content">
          <div class="title" v-if="title">{{ title }}</div>
          <div class="link" v-if="href">
            <span>{{ href }}</span>
          </div>
          <textarea v-model="feedback" :placeholder="$t('component.feedback.placeholder')"></textarea>
        </div>
        <div class="bottom">
          <div class="follow-up" v-show="email" @click="allowFollowUp = !allowFollowUp">
            <button :class="{ selected: allowFollowUp }"></button>
            <span>{{ $t('component.feedback.follow_up', [email || '']) }}</span>
          </div>
          <button class="submit" :class="{ disabled: feedback.length === 0 }" @click="submitFeedback">{{ $t('common.operate.submit') }}</button>
        </div>
        <Transition name="opacity">
          <div class="loading" v-show="isLoading">
            <div class="i-svg-spinners:180-ring-with-bg text-5xl text-emerald"></div>
          </div>
        </Transition>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { RESTMethodPath } from '@commons/types/const'
import { useScrollLock } from '@vueuse/core'
import { UAParser } from 'ua-parser-js'

const props = defineProps({
  reportType: String,
  title: String,
  href: { type: String, required: false },
  email: { type: String, required: false },
  params: {
    type: Object as PropType<Record<string, string | number>>,
    required: false
  }
})

const emits = defineEmits(['close', 'dismiss'])

const isLoading = ref(false)
const parser = new UAParser()
const result = parser.getResult()
const version = `${process.env.VERSION}`
const isLocked = useScrollLock(window)
const appear = ref(false)
const feedback = ref('')
const allowFollowUp = ref(false)

isLocked.value = true

onMounted(() => {
  setTimeout(() => {
    appear.value = true
  })
})

const closeModal = () => {
  appear.value = false
}
const submitFeedback = () => {
  if (feedback.value.length === 0) {
    return
  }

  reportFeedbackContent()
}
const reportFeedbackContent = async () => {
  if (isLoading.value) {
    return
  }

  trackEvent({
    event: 'feedback_submit_start',
    scope: 'bookmark'
  })

  isLoading.value = true
  let environment = ''
  try {
    environment = `${(import.meta.env.BROWSER + '-extension').toUpperCase()} | ${result.browser.name} ${result.browser.version} | ${result.os.name} ${result.os.version} | ${result.device.model}`
  } catch (error) {}

  const req = {
    ...props.params,
    type: props.reportType,
    content: feedback.value,
    platform: 'extension',
    environment,
    version,
    allow_follow_up: allowFollowUp.value,
    target_url: props.href || ''
  }

  request
    .post({
      url: RESTMethodPath.REPORT_FEEDBACK,
      body: req
    })
    .then(res => {
      feedback.value = ''
      closeModal()
    })
    .finally(() => {
      isLoading.value = false
    })
}
const onAfterLeave = () => {
  isLocked.value = false
  emits('dismiss')
}
</script>

<style lang="scss" scoped>
.feedback-modal {
  --style: fixed inset-0 z-100 bg-transparent flex-center transition-colors duration-250;
  &.appear {
    --style: bg-#0f141999;
  }
}

button {
  --style: 'hover:(scale-103 opacity-90) active:(scale-105) transition-all duration-250';
}

.modal-content {
  --style: relative bg-#f5f5f3 rounded-2 p-24px w-480px select-none overflow-hidden mb-10;

  .header {
    --style: relative z-1 flex justify-between items-center;
    span {
      --style: text-(13px #999999) line-height-18px;
    }

    button {
      --style: w-16px h-16px;
      img {
        --style: w-full;
      }
    }
  }

  .content {
    --style: mt-16px flex flex-col items-center justify-stretch;
    .title {
      --style: w-full text-(14px ellipsis #333333) line-height-21px font-medium overflow-hidden line-clamp-2 break-all;
    }

    .link {
      --style: w-full text-(#5490c2 15px) line-height-21px;
    }

    .title + .link {
      --style: mt-8px;
    }

    * + textarea {
      --style: mt-20px;
    }

    textarea {
      --style: w-full h-120px rounded-2 border-(1px solid #3333330d) text-(15px #0f1419) bg-#fcfcfc line-height-22px py-12px px-16px resize-none outline-none;

      &::placeholder,
      &::-webkit-input-placeholder {
        --style: text-(15px #999999);
      }
    }
  }

  .bottom {
    --style: mt-20px flex justify-between items-center gap-20px;

    .follow-up {
      --style: flex items-center justify-start flex-1 overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer;

      button {
        --style: shrink-0 border-(1px solid #3333331a) bg-#fcfcfc w-12px h-12px rounded-3px transition-transform duration-250;

        &.selected {
          --style: 'bg-center bg-[length:7px_6px] border-1';
          background-image: url('@/assets/tiny-tick-outline-icon.png');
        }

        &:hover {
          --style: scale-105;
        }

        &:active {
          --style: scale-110;
        }
      }

      span {
        --style: ml-5px text-(#333 14px) line-height-22px overflow-hidden text-ellipsis;
      }
    }

    .submit {
      --style: flex-center shrink-0 w-100px h-40px bg-#16B998 rounded-2 text-(14px #ffffff) font-semibold line-height-40px transition-all duration-250;

      &.disabled {
        --style: 'bg-#ccc cursor-not-allowed hover:(scale-100)';
      }

      &:not(.disabled):hover {
        --style: bg-#14a689;
      }

      &:not(.disabled):active {
        --style: scale-105;
      }
    }
  }

  .loading {
    --style: absolute inset-0 bg-#ffffff40 flex-center;
  }
}

.modal-leave-to,
.modal-enter-from {
  --style: opacity-0 -translate-y-25px;
}

.modal-enter-active,
.modal-leave-active {
  --style: transition-all duration-250 ease-in-out;
}
</style>
