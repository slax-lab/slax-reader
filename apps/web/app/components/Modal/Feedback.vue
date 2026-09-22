<template>
  <div class="feedback-modal" :class="{ appear }" @click="() => !isLoading && closeModal()">
    <Transition name="modal" @after-leave="onAfterLeave">
      <div class="modal-content" v-show="appear" @click.stop>
        <div class="header">
          <span v-if="title || href">{{ t('component.feedback.title') }}</span>
          <span v-else>{{ t('component.feedback.name') }}</span>
          <button class="close" @click="closeModal">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div class="content">
          <div class="title" v-if="title">{{ title }}</div>
          <a class="link" v-if="href" :href="href" target="_blank" rel="noopener noreferrer">
            <svg class="link-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">
              <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
              <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
            </svg>
            <span>{{ href }}</span>
          </a>
          <textarea v-autofocus="{ enabled: appear }" v-model="feedback" :placeholder="t('component.feedback.placeholder')"></textarea>
        </div>
        <div class="bottom">
          <div class="follow-up" v-show="email" @click="allowFollowUp = !allowFollowUp">
            <span class="checkbox" :class="{ selected: allowFollowUp }">
              <svg class="tick" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            </span>
            <span>{{ t('component.feedback.follow_up', { email }) }}</span>
          </div>
          <button class="submit" :class="{ disabled: feedback.length === 0 }" @click="submitFeedback">{{ t('common.operate.submit') }}</button>
        </div>
        <Transition name="opacity">
          <div class="loading" v-show="isLoading">
            <div class="i-svg-spinners:180-ring-with-bg text-5xl text-accent"></div>
          </div>
        </Transition>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import { RESTMethodPath } from '@commons/contracts/const'
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
const config = useRuntimeConfig()
const version = config.public.appVersion
const isLocked = useScrollLock(window)
const appear = ref(false)
const feedback = ref('')
// 默认勾选「允许后续跟进」，方便用户被回复（用户可手动取消）
const allowFollowUp = ref(true)

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

  analyticsLog({
    event: 'feedback_submit_start',
    scope: 'bookmark'
  })

  isLoading.value = true
  let environment = ''
  try {
    environment = `${result.browser.name} ${result.browser.version} | ${result.os.name} ${result.os.version} | ${result.device.model}`
  } catch (error) {}

  const req = {
    ...props.params,
    type: props.reportType,
    content: feedback.value,
    platform: 'web',
    environment,
    version,
    allow_follow_up: allowFollowUp.value
  }

  request()
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

const t = (text: string, params: Record<string, unknown> = {}) => {
  return useNuxtApp().$i18n.t(text, params)
}
</script>

<style lang="scss" scoped>
.feedback-modal {
  --style: fixed inset-0 z-200 bg-transparent flex-center transition-colors duration-normal;
  &.appear {
    // 遵循 docs/DESIGN.md 第八节弹窗遮罩规范
    background: rgba(15, 20, 25, 0.6);
    backdrop-filter: blur(4px);
  }
}

.modal-content {
  --style: relative p-24px w-480px select-none overflow-hidden mb-10;
  background: var(--slax-surface-solid);
  border: 1px solid var(--slax-border);
  border-radius: var(--slax-radius);
  box-shadow: var(--slax-shadow-modal);

  .header {
    --style: relative z-1 flex justify-between items-center;
    span {
      font-family: var(--slax-font-serif);
      font-size: var(--slax-fs-card);
      font-weight: 500;
      color: var(--slax-text);
      line-height: 1.4;
    }

    button.close {
      --style: flex-center w-28px h-28px rounded-sm transition-all duration-normal;
      color: var(--slax-text-light);

      &:hover {
        background: var(--slax-surface);
        color: var(--slax-text);
      }
    }
  }

  .content {
    --style: mt-16px flex flex-col items-center justify-stretch;
    .title {
      --style: 'w-full text-(meta ellipsis txt) line-height-21px font-medium overflow-hidden line-clamp-2 break-all';
    }

    .link {
      --style: w-full flex items-center gap-8px px-12px py-8px rounded-sm text-aux line-height-18px overflow-hidden transition-colors duration-normal;
      background: var(--slax-accent-bg);
      color: var(--slax-accent);

      .link-icon {
        --style: w-14px h-14px flex-shrink-0;
      }

      span {
        --style: flex-1 truncate;
      }

      &:hover {
        background: color-mix(in srgb, var(--slax-accent) 12%, transparent);
      }
    }

    .title + .link {
      --style: mt-8px;
    }

    * + textarea {
      --style: mt-20px;
    }

    textarea {
      --style: w-full h-120px rounded-2 text-(meta txt) line-height-22px py-12px px-16px resize-none outline-none transition-all duration-normal;
      background: var(--slax-surface-solid);
      border: 1px solid var(--slax-border);

      &:focus {
        border-color: color-mix(in srgb, var(--slax-accent) 40%, var(--slax-border));
        box-shadow: 0 0 0 3px color-mix(in srgb, var(--slax-accent) 12%, transparent);
      }

      &::placeholder,
      &::-webkit-input-placeholder {
        --style: text-(meta txt-light);
      }
    }
  }

  .bottom {
    --style: mt-20px flex justify-between items-center gap-20px;

    .follow-up {
      --style: flex items-center justify-start flex-1 overflow-hidden text-ellipsis whitespace-nowrap cursor-pointer;

      .checkbox {
        --style: shrink-0 w-14px h-14px rounded-3px flex-center transition-all duration-fast;
        background: transparent;
        border: 1px solid var(--slax-border);

        .tick {
          --style: w-9px h-9px opacity-0 transition-opacity duration-fast;
          color: var(--slax-accent);
        }

        &.selected {
          background: var(--slax-accent-bg);
          border-color: var(--slax-accent-soft);

          .tick {
            --style: opacity-70;
          }
        }
      }

      &:hover .checkbox:not(.selected) {
        border-color: var(--slax-accent-soft);
      }

      span {
        --style: ml-8px text-(txt 14px) line-height-22px overflow-hidden text-ellipsis;
      }
    }

    .submit {
      --style: flex-center shrink-0 w-100px h-40px rounded-2 text-(meta txt-btn) font-semibold line-height-40px transition-all duration-normal;
      background: var(--slax-accent);

      &.disabled {
        --style: 'cursor-not-allowed opacity-35';
      }

      &:not(.disabled):hover {
        --style: -translate-y-1px;
        box-shadow: 0 2px 8px color-mix(in srgb, var(--slax-accent) 20%, transparent);
      }

      &:not(.disabled):active {
        --style: translate-y-0 scale-98;
      }
    }
  }

  .loading {
    --style: absolute inset-0 flex-center;
    background: color-mix(in srgb, var(--slax-surface-solid) 80%, transparent);
  }
}

.modal-leave-to,
.modal-enter-from {
  --style: opacity-0 -translate-y-25px;
}

.modal-enter-active,
.modal-leave-active {
  --style: transition-all duration-normal;
  transition-timing-function: var(--slax-ease-spring);
}
</style>
