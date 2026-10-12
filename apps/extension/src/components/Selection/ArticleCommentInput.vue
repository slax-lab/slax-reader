<template>
  <Transition name="input">
    <div class="article-comment-input" v-show="showInput" @click.stop>
      <div class="comment-input-wrapper">
        <textarea
          ref="textarea"
          v-model="inputText"
          v-on-key-stroke:Enter="[onKeyDown, { eventName: 'keydown' }]"
          :placeholder="textareaPlaceholder"
          @compositionstart="compositionstart"
          @compositionend="compositionend"
          @input="handleInput"
        >
        </textarea>
        <button :class="{ disabled: !sendable }" class="bg-[url('@/assets/button-tiny-send.png')]" @click="sendMessage"></button>
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

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
const textarea = ref<HTMLTextAreaElement>()
const inputText = ref('')
const textareaPlaceholder = props.placeholder ?? ref($t('component.article_selection.placeholder'))
const compositionAppear = ref(false)
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

const compositionstart = () => {
  compositionAppear.value = true
}

const compositionend = () => {
  compositionAppear.value = false
}

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Enter' || compositionAppear.value) {
    return
  }

  const commonPreLineKey = e.ctrlKey || e.shiftKey
  if ((commonPreLineKey && !isMac) || ((commonPreLineKey || e.metaKey) && isMac)) {
    if (!e.target || !(e.target instanceof HTMLTextAreaElement)) {
      return
    }

    const textareaTarget = e.target as HTMLTextAreaElement
    const cursorPosition = textareaTarget.selectionStart
    const textBeforeCursor = inputText.value.slice(0, cursorPosition)
    const textAfterCursor = inputText.value.slice(cursorPosition)
    !e.shiftKey && (inputText.value = textBeforeCursor + '\n' + textAfterCursor)

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
.article-comment-input {
  --style: max-h-300px overflow-hidden;
  .comment-input-wrapper {
    --style: p-8px w-full relative bg-#1A1A1AFF border-(1px solid #1a1a1aff) rounded-8px flex flex-row justify-between;
    textarea {
      --style: resize-none min-h-20px max-h-200px text-(14px #ffffffcc) line-height-20px flex-1 bg-transparent;
      &::placeholder,
      &::-webkit-input-placeholder {
        --style: text-(14px #ffffff66) line-height-20px;
      }
    }

    button {
      --style: mb-2px ml-8px self-end w-16px h-16px bg-contain transition-transform duration-250;

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
  --style: transition-all duration-250 ease-in-out;
}
</style>
