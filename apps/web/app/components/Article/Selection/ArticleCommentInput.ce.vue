<template>
  <Transition name="input">
    <div class="article-comment-input" v-show="showInput">
      <div class="comment-input-wrapper">
        <textarea
          ref="textarea"
          v-ime-guard
          v-model="inputText"
          v-on-key-stroke:Enter="[onKeyDown, { eventName: 'keydown' }]"
          :placeholder="textareaPlaceholder"
          @input="handleInput"
        >
        </textarea>
        <button class="send-button" :class="{ disabled: !sendable }" @click="sendMessage"></button>
      </div>
    </div>
  </Transition>
</template>

<script lang="ts" setup>
import { vOnKeyStroke } from '@vueuse/components'

const emits = defineEmits(['post'])
const props = defineProps({
  showInput: {
    type: Boolean
  },
  placeholder: {
    type: String,
    required: false
  }
})

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
const textarea = ref<HTMLTextAreaElement>()
const inputText = ref('')
const textareaPlaceholder = props.placeholder ?? ref(t('component.article_selection.placeholder'))
const sendable = computed(() => {
  return inputText.value.trim().length > 0
})

watch(
  () => props.showInput,
  value => {
    if (!value) {
    } else {
      handleInput()
      nextTick(() => {
        textarea.value?.focus()
      })
    }
  }
)

const handleInput = () => {
  const textareaValue = textarea.value
  if (!textareaValue) {
    return
  }

  nextTick(() => {
    textareaValue.style.height = '20px'
    textareaValue.style.height = textareaValue.scrollHeight + 'px'
  })
}

onMounted(() => {
  handleInput()
})

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Enter') {
    return
  }

  const commonPreLineKey = e.ctrlKey || e.shiftKey
  if ((commonPreLineKey && !isMac) || ((commonPreLineKey || e.metaKey) && isMac)) {
    if (!e.target || !(e.target instanceof HTMLTextAreaElement)) {
      return
    }

    const textareaTarget = e.target as HTMLTextAreaElement
    // Shift+Enter 交给原生换行
    // 避免 nextTick 抢跑光标
    if (e.shiftKey) {
      nextTick(handleInput)
      return
    }
    const cursorPosition = textareaTarget.selectionStart
    const textBeforeCursor = inputText.value.slice(0, cursorPosition)
    const textAfterCursor = inputText.value.slice(cursorPosition)
    inputText.value = textBeforeCursor + '\n' + textAfterCursor

    nextTick(() => {
      textareaTarget.selectionStart = cursorPosition + 1
      textareaTarget.selectionEnd = cursorPosition + 1
      handleInput()
    })
  } else {
    sendMessage()
    e.preventDefault()
  }
}

const shakeTextarea = () => {
  if (!textarea.value) {
    return
  }

  textarea.value.classList.add('shake')
  textarea.value.addEventListener(
    'animationend',
    () => {
      textarea.value?.classList.remove('shake')
    },
    { once: true }
  )
}

const sendMessage = () => {
  if (!sendable.value) {
    shakeTextarea()
    return
  }

  emits('post', inputText.value)

  inputText.value = ''
  handleInput()
}
</script>

<style lang="scss" scoped>
@use '~~/styles/global.scss' as *;

// 本组件消费的 token（无 dark prop）：
//   --slax-surface-solid, --slax-text, --slax-text-light
// 其余 (#ecf0f5 浅蓝灰输入框边框辅助色) 保留。
//
// send-button 资源切图（双 PNG）：
//   shadow DOM 不能匹配 [data-slax-theme] / :host-context()，故 light/dark 切图依赖
//   父级 ArticleSelectionPanel 的 dark prop（在其 scoped 内 `.dark` 容器 cascade 至此）。
//   注意：ArticleCommentInput 也作为独立 CE 在主站非 iframe 场景使用，但主站 send 资源仅 light，
//   此时不存在 dark 切换，故下面以 light 为默认值，dark 切换由 panel 容器接管。
.article-comment-input {
  --style: max-h-300px overflow-hidden;
  .comment-input-wrapper {
    --style: p-8px w-full relative border-(1px solid) rounded-8px flex flex-row justify-between bg-surface-solid border-#ecf0f5;

    textarea {
      --style: resize-none min-h-20px max-h-200px text-(meta txt) line-height-20px flex-1 bg-transparent;

      &::placeholder,
      &::-webkit-input-placeholder {
        --style: text-(meta) line-height-20px text-txt-light;
      }
    }

    .send-button {
      --style: mb-2px ml-8px self-end w-16px h-16px bg-contain transition-transform duration-normal;
      background-image: url('@images/button-tiny-send.png');

      &.disabled {
        --style: opacity-50 cursor-auto;
      }

      &:not(.disabled) {
        &:hover {
          --style: scale-105;
        }

        &:active {
          --style: scale-115;
        }
      }
    }
  }
}

.input-leave-to,
.input-enter-from {
  --style: '!max-h-0px !mt-0 opacity-0';
}

.input-enter-active,
.input-leave-active {
  --style: transition-all duration-normal ease-in-out;
}
</style>
