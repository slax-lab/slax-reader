<template>
  <Transition name="opacity" @afterLeave="onAfterLeave">
    <div v-show="appear" class="article-selection-comment" ref="commentPanel" v-on-click-outside="closeModal" v-resize-observer="[resizeHandler, {}]">
      <div class="draggable" ref="draggable"></div>
      <div class="header">
        <span v-if="!info.id">{{ $t('component.article_selection.title') }}</span>
        <button class="close" @click="closeModal">
          <img src="@/assets/button-dialog-close.png" />
        </button>
      </div>
      <div class="menus" v-if="info.id">
        <button class="menu" v-for="menu in menus" :key="menu.id" @click="e => handleClick(menu.id, e)">
          <img :src="menu.icon" />
          <span>{{ menu.name }}</span>
        </button>
      </div>
      <div class="comments" v-if="markComments.length > 0">
        <div class="comments-wrapper" :style="commentsHeight ? { 'max-height': `${commentsHeight}px` } : {}" ref="commentsWrapper">
          <TransitionGroup name="opacity">
            <ArticleCommentCell
              v-for="(comment, index) in markComments"
              :key="index"
              :comment="comment"
              :userId="userId"
              @replyComment="replyComment"
              @commentDelete="commentDelete"
            />
          </TransitionGroup>
        </div>
      </div>
      <Transition name="input">
        <div class="comment-input" v-show="showInput">
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
    </div>
  </Transition>
</template>

<script lang="ts" setup>
import ArticleCommentCell from './ArticleCommentCell.vue'

import menuChatbotImage from '@/assets/menu-chatbot-icon.png'
import menuCommentImage from '@/assets/menu-comment-icon.png'
import menuCopyImage from '@/assets/menu-copy-icon.png'
import menuStrokeDeleteImage from '@/assets/menu-stroke-delete-icon.png'
import menuStrokeImage from '@/assets/menu-stroke-icon.png'

import { type MarkCommentInfo, type MarkItemInfo, MenuType } from './type'
import { vOnClickOutside, vOnKeyStroke, vResizeObserver } from '@vueuse/components'
import { type Position, useDebounceFn, useResizeObserver } from '@vueuse/core'
import { useDraggable } from '@vueuse/core'
import type { PropType } from 'vue'

interface MenuItem {
  id: MenuType
  name: string
  icon: string
}

const appear = ref(false)
const commentsWrapper = ref<HTMLDivElement>()
const props = defineProps({
  isAppeared: {
    required: false,
    type: Boolean
  },
  info: {
    required: true,
    type: Object as PropType<MarkItemInfo>
  },
  allowAction: {
    required: true,
    type: Boolean
  },
  userId: {
    required: true,
    type: Number
  }
})

const emits = defineEmits(['action', 'dismiss', 'commentDelete', 'windowResize', 'locationUpdate'])

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
const textareaPlaceholder = ref($t('component.article_selection.placeholder'))
const compositionAppear = ref(false)
const textarea = ref<HTMLTextAreaElement>()
const inputText = ref('')
const showInput = ref(props.info.stroke.length === 0 && props.info.comments.length === 0)
const sendable = computed(() => {
  return inputText.value.trim().length > 0
})

const maxHeight = ref(0)
const markComments = ref<MarkCommentInfo[]>([])

const draggable = ref<HTMLDivElement>()

const lastPosition = ref<{ x: number; y: number } | null>(null)
const { x, y } = useDraggable(draggable, {
  initialValue: lastPosition.value ? lastPosition.value : { x: 0, y: 0 },
  onMove: (position: Position) => {
    onUpdatePositionHandler(position)
  }
})

const onUpdatePositionHandler = (position: Position) => {
  if (lastPosition.value !== null) {
    if (Math.abs(lastPosition.value.x - position.x) > 300 || Math.abs(lastPosition.value.y - position.y) > 300) {
      return
    }
  }

  lastPosition.value = { x: position.x, y: position.y }
  emits('locationUpdate', position)
}

const updateLocation = (position: Position) => {
  x.value = position.x
  y.value = position.y

  onUpdatePositionHandler(position)
}

const commentsHeight = computed(() => {
  return Math.max(0, maxHeight.value - 200)
})

const menus = computed<MenuItem[]>(() => {
  const menus: MenuItem[] = [
    {
      id: MenuType.Copy,
      name: $t('common.operate.copy'),
      icon: menuCopyImage
    }
  ]

  if (props.allowAction) {
    menus.push(
      ...[
        !!props.info.stroke.find(item => item.userId === props.userId)
          ? {
              id: MenuType.Stroke_Delete,
              name: $t('common.operate.delete_line'),
              icon: menuStrokeDeleteImage
            }
          : {
              id: MenuType.Stroke,
              name: $t('common.operate.line'),
              icon: menuStrokeImage
            },
        {
          id: MenuType.Comment,
          name: $t('common.operate.comment'),
          icon: menuCommentImage
        }
      ]
    )
  }

  menus.push({
    id: MenuType.Chatbot,
    name: $t('common.operate.chatbot'),
    icon: menuChatbotImage
  })

  return menus
})

watch(
  () => props.isAppeared,
  value => {
    if (!value) {
      showInput.value = false
    }
  },
  {
    flush: 'sync'
  }
)

watch(
  () => showInput.value,
  value => {
    if (value) {
      nextTick(() => {
        textarea.value?.focus()
      })
    }
  }
)

nextTick(() => {
  appear.value = true
})

const resizeHandler = (entries: unknown | ReadonlyArray<ResizeObserverEntry>) => {
  if (!Array.isArray(entries)) {
    return
  }

  const entry = entries[0]
  resizeDebouncedFn(entry.contentRect.width)
}

useResizeObserver(document.body, resizeHandler)

const resizeDebouncedFn = useDebounceFn(
  (width: number) => {
    emits('windowResize', width)
  },
  500,
  { maxWait: 5000 }
)

const convertComment = (comment: MarkCommentInfo): MarkCommentInfo => {
  const { children, ...detail } = comment
  return {
    ...detail,
    children: children.map(convertComment)
  }
}

watch(
  () => props.info.comments,
  () => {
    const insertNewRootComment = props.info.comments?.length && markComments.value?.length && props.info.comments.length > markComments.value.length

    if (!props.info.comments) {
      markComments.value = []
    }

    if (!props.info.comments) {
      markComments.value = []
    } else {
      markComments.value = props.info.comments.map(item => convertComment(item))
    }

    if (insertNewRootComment) {
      nextTick(() => {
        commentsWrapper.value?.scrollTo({
          top: commentsWrapper.value.scrollHeight,
          behavior: 'smooth'
        })
      })
    }
  },
  {
    immediate: true,
    deep: true
  }
)

const replyComment = (options: { replyToUid: string; comment: string }) => {
  const { replyToUid, comment } = options
  emits('action', MenuType.Comment, {
    info: props.info,
    comment: comment.trim(),
    replyToUid
  })
}

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

  emits('action', MenuType.Comment, {
    info: props.info,
    comment: inputText.value.trim()
  })

  inputText.value = ''
  showInput.value = false
  nextTick(() => {
    handleInput()
  })
}

const handleInput = () => {
  if (!textarea.value) {
    return
  }

  textarea.value.style.height = '22px'
  textarea.value.style.height = textarea.value.scrollHeight + 'px'
}

const handleClick = (type: MenuType, event: MouseEvent) => {
  if (type === MenuType.Comment) {
    nextTick(() => {
      cancelReply()
      showInput.value = !showInput.value
    })
  } else {
    emits('action', type, {
      info: props.info,
      comment: inputText.value,
      event: event
    })
  }

  if (type === MenuType.Copy || type === MenuType.Chatbot) {
    closeModal()
  }
}

const commentDelete = (comment: MarkCommentInfo) => {
  emits('commentDelete', {
    id: props.info.id,
    markUid: comment.markUid
  })
}

const closeModal = () => {
  appear.value = false
}

const onAfterLeave = () => {
  emits('dismiss')
}

const positionConfirmedHandler = () => {
  if (showInput.value) {
    nextTick(() => {
      textarea.value?.focus()
    })
  }
}

const maxHeightUpdate = (height: number) => {
  maxHeight.value = height
}

const cancelReply = () => {
  textareaPlaceholder.value = $t('component.article_selection.placeholder')
}

defineExpose({
  positionConfirmedHandler,
  maxHeightUpdate,
  updateLocation,
  closeModal
})
</script>

<style lang="scss" scoped>
.article-selection-comment {
  --style: relative w-400px max-w-screen px-16px pt-20px pb-16px bg-#262626 rounded-16px border-(1px solid #a8b1cd33) shadow-[0px_20px_40px_0px_#0000000a];

  .draggable {
    --style: absolute top-0 left-0 w-full h-20px cursor-grab z-0;
  }

  .header {
    --style: relative z-1 text-align-center min-h-11px;
    span {
      --style: text-(16px #ffffff66) line-height-16px font-600;
    }

    .close {
      --style: 'absolute right-4px top-1/2 -translate-y-1/2 w-16px h-16px flex-center hover:(scale-103 opacity-90) active:(scale-105) transition-all duration-250';
      img {
        --style: w-full select-none;
      }
    }
  }

  .menus {
    --style: mt-22px p-4px bg-#333333 rounded-8px flex items-center;

    .menu {
      --style: 'px-0 py-10px rounded-6px cursor-pointer flex-1 flex flex-col items-center hover:(bg-#262626) active:(scale-105) transition-all duration-250';

      img {
        --style: w-24px h-24px object-fit;
      }

      span {
        --style: mt-6px text-(13px #ffffff66) line-height-18px;
      }
    }
  }

  .comment-input {
    --style: mt-10px max-h-300px overflow-hidden;
    .comment-input-wrapper {
      --style: pl-16px pt-16px pr-20px pb-14px w-full relative bg-#1a1a1aff border-(1px solid #1a1a1aff) rounded-8px flex flex-col justify-between;
      textarea {
        --style: resize-none min-h-40px max-h-200px text-(16px #ffffffcc) line-height-24px bg-transparent;
        &::placeholder,
        &::-webkit-input-placeholder {
          --style: text-(16px #ffffff66) line-height-24px;
        }
      }

      button {
        --style: mt-10px self-end w-20px h-20px bg-contain transition-transform duration-250;

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

  .comments {
    --style: mt-10px relative;
    .comments-wrapper {
      --style: py-6px max-h-80vh overflow-auto;

      scroll-snap-type: x mandatory;
      scrollbar-width: none;
      &::-webkit-scrollbar {
        --style: hidden;
      }

      &::before,
      &::after {
        --style: z-2 content-empty absolute h-6px w-full left-0 from-#262626 to-transprent;
      }

      &::before {
        --style: bottom-0 bg-gradient-to-t;
      }

      &::after {
        --style: top-0 bg-gradient-to-b;
      }
    }
  }
}

@keyframes shake {
  0%,
  100% {
    transform: translateX(0);
  }
  20%,
  60% {
    transform: translateX(-2px);
  }
  40%,
  80% {
    transform: translateX(2px);
  }
}

// eslint-disable-next-line vue-scoped-css/no-unused-selector
textarea.shake {
  animation: shake 0.5s;
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
