<template>
  <Transition name="opacity" @afterLeave="onAfterLeave">
    <div :class="{ dark }" v-show="appear">
      <div
        class="article-selection-comment"
        v-click-outside="{
          handler: closeModal,
          exclude: () => [articleSelectionPanel]
        }"
        v-resize-observer="[resizeHandler, {}]"
        ref="articleSelectionPanel"
      >
        <div class="draggable" ref="draggable" v-if="allowDrag"></div>
        <div class="header">
          <span v-if="!info.id">{{ $t('component.article_selection.title') }}</span>
          <button class="close" @click="closeModal">
            <img v-if="!dark" src="@images/button-dialog-close.png" />
            <img v-else src="@images/button-dialog-close-dark.png" />
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
            <!-- key 用稳定 markUid，避开异步 patch 崩溃 -->
            <ArticleCommentCell
              v-for="(comment, index) in markComments"
              :key="comment.markUid || index"
              :comment="comment"
              :bookmarkUserId="bookmarkUserId"
              @replyComment="replyComment"
              @commentDelete="commentDelete"
            />
          </div>
        </div>
        <Transition name="input">
          <div class="comment-input" v-show="showInput">
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
      </div>
    </div>
  </Transition>
</template>

<script lang="ts" setup>
import ArticleCommentCell from './ArticleCommentCell.ce.vue'

import { ClickOutside } from '@commons/utils/directive'
import { type Position, useDraggable } from '@commons/utils/draggable'

import { type MarkCommentInfo, type MarkItemInfo, MenuType } from './type'
import { vOnKeyStroke, vResizeObserver } from '@vueuse/components'
import { useResizeObserver } from '@vueuse/core'
import { showLoginModal } from '~/components/Modal'
import { useUserStore } from '~/stores/user'
import type { PropType } from 'vue'

interface MenuItem {
  id: MenuType
  name: string
  icon: string
}

const t = (text: string) => {
  return useNuxtApp().$i18n.t(text)
}

const vClickOutside = ClickOutside

const appear = ref(false)
const articleSelectionPanel = useTemplateRef('articleSelectionPanel')
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
  bookmarkUserId: {
    required: true,
    type: Number
  },
  allowAction: {
    required: true,
    type: Boolean
  },
  dark: {
    type: Boolean,
    required: false
  },
  allowDrag: {
    type: Boolean,
    required: false
  }
})

const emits = defineEmits(['action', 'dismiss', 'commentDelete', 'windowResize', 'locationUpdate'])

const userId = useUserStore().userInfo?.userId || 0
const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
const textareaPlaceholder = ref(t('component.article_selection.placeholder'))
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

const { position, reset } = useDraggable(draggable, {
  initialPosition: lastPosition.value ? lastPosition.value : { x: 0, y: 0 },
  onDrag: pos => {
    onUpdatePositionHandler(pos)
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

const updateLocation = (pos: Position) => {
  position.value.x = pos.x
  position.value.y = pos.y

  onUpdatePositionHandler(pos)
}

const commentsHeight = computed(() => {
  return Math.max(0, maxHeight.value - 200)
})
const menus = computed<MenuItem[]>(() => {
  const menus: MenuItem[] = [
    {
      id: MenuType.Copy,
      name: t('common.operate.copy'),
      icon: !props.dark ? new URL('@images/menu-copy-icon.png', import.meta.url).href : new URL('@images/menu-copy-icon-dark.png', import.meta.url).href
    }
  ]

  if (props.allowAction) {
    menus.push(
      ...[
        !!props.info.stroke.find(item => item.userId === userId)
          ? {
              id: MenuType.Stroke_Delete,
              name: t('common.operate.delete_line'),
              icon: !props.dark ? new URL('@images/menu-stroke-delete-icon.png', import.meta.url).href : new URL('@images/menu-stroke-delete-icon-dark.png', import.meta.url).href
            }
          : {
              id: MenuType.Stroke,
              name: t('common.operate.line'),
              icon: !props.dark ? new URL('@images/menu-stroke-icon.png', import.meta.url).href : new URL('@images/menu-stroke-icon-dark.png', import.meta.url).href
            },
        {
          id: MenuType.Comment,
          name: t('common.operate.comment'),
          icon: !props.dark ? new URL('@images/menu-comment-icon.png', import.meta.url).href : new URL('@images/menu-comment-icon-dark.png', import.meta.url).href
        }
      ]
    )
  }

  menus.push({
    id: MenuType.Chatbot,
    name: t('common.operate.chatbot'),
    icon: !props.dark ? new URL('@images/menu-chatbot-icon.png', import.meta.url).href : new URL('@images/menu-chatbot-icon-dark.png', import.meta.url).href
  })

  return menus
})

watch(
  () => props.isAppeared,
  value => {
    if (!value) {
      showInput.value = false
    } else {
      nextTick(() => {
        textarea.value?.focus()
      })
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
  },
  {
    immediate: true
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
  if (type !== MenuType.Copy && !useUserStore().userInfo) {
    return showLoginModal({
      redirect: window.location.href
    })
  }
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
  textareaPlaceholder.value = t('component.article_selection.placeholder')
}

defineExpose({
  positionConfirmedHandler,
  maxHeightUpdate,
  updateLocation,
  closeModal
})
</script>

<style lang="scss" scoped>
@use '~~/styles/global.scss' as *;

// 本组件消费的 token（dark prop override 需全覆盖）：
//   --slax-surface, --slax-surface-solid, --slax-text, --slax-text-light, --slax-text-muted
// 其余颜色 (#a8b1cd33 蓝灰辅助、#ecf0f5 浅蓝灰边框、#0000000a 阴影规格) 保持 inline。

.article-selection-comment {
  --style: w-400px max-w-screen px-16px pt-20px pb-16px rounded-16px border-(1px solid #a8b1cd33) shadow-[0px_20px_40px_0px_#0000000a] bg-surface;

  .draggable {
    --style: absolute top-0 left-0 w-full h-20px cursor-grab z-0;
  }

  .header {
    --style: relative text-align-center min-h-11px;
    span {
      --style: text-(body) line-height-16px font-600 text-txt-light;
    }

    .close {
      --style: 'absolute right-4px top-1/2 -translate-y-1/2 w-16px h-16px flex-center hover:(scale-103 opacity-90) active:(scale-105) transition-all duration-normal';
      img {
        --style: w-full select-none;
      }
    }
  }

  .menus {
    --style: mt-22px p-4px rounded-8px flex items-center bg-surface-solid;

    .menu {
      --style: 'px-0 py-10px rounded-6px cursor-pointer flex-1 flex flex-col items-center active:(scale-105) transition-all duration-normal';

      &:hover {
        --style: bg-surface;
      }

      img {
        --style: w-24px h-24px object-fit;
      }

      span {
        --style: mt-6px text-(aux) line-height-18px text-txt-light;
      }
    }
  }

  .comment-input {
    --style: mt-10px max-h-300px overflow-hidden;
    .comment-input-wrapper {
      // #ecf0f5 浅蓝灰输入框边框（辅助色），保留
      --style: pl-16px pt-16px pr-20px pb-14px w-full relative border-(1px solid #ecf0f5) rounded-8px flex flex-col justify-between bg-surface-solid;

      textarea {
        --style: resize-none min-h-40px max-h-200px text-(body) line-height-24px bg-transparent text-txt;

        &::placeholder,
        &::-webkit-input-placeholder {
          --style: text-(body) line-height-24px text-txt-light;
        }
      }

      button.send-button {
        --style: mt-10px self-end w-20px h-20px bg-contain transition-transform duration-normal;
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
        --style: z-2 content-empty absolute h-6px w-full left-0 to-transprent from-surface;
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
  --style: transition-all duration-normal ease-in-out;
}

// dark prop：iframe 浮层场景强制深色（与全站主题正交）。
// 完整覆盖本组件 scoped 内消费的全部 token；CSS 自定义属性默认 inherit，
// 子元素 .article-selection-comment / .menus / .comment-input-wrapper / textarea / 等
// 通过 cascade 自动拿到 override。
.dark {
  --slax-surface: rgba(30, 27, 24, 0.75);
  --slax-surface-solid: #1e1b18;
  --slax-text: #e8e2d8;
  --slax-text-light: #6a5f52;
  --slax-text-muted: #9a8e7f;

  // 资源切图（双 PNG）：CSS 变量无法承载 url() 的 dark 切换语义在 shadow DOM 内的稳定路径，
  // 故在 .dark 容器内显式覆盖：
  //   - panel 本组件 .send-button（comment-input-wrapper > button）
  //   - 子组件 ArticleCommentInput .send-button（:deep 穿透）
  //   - 子组件 ArticleCommentCell .reply / .reply-child（:deep 穿透）
  .send-button {
    background-image: url('@images/button-tiny-send-dark.png');
  }

  :deep(.send-button) {
    background-image: url('@images/button-tiny-send-dark.png');
  }

  :deep(.reply),
  :deep(.reply-child) {
    background-image: url('@images/tiny-comment-icon-dark.png');
  }
}
</style>

<!-- eslint-disable-next-line vue-scoped-css/enforce-style-type -->
<style lang="scss">
.article-selection-panel-container {
  --style: transition-all duration-normal;
}
</style>
