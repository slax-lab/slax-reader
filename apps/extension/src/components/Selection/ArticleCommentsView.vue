<template>
  <div class="article-comments-view">
    <div class="title">
      <img src="@/assets/tiny-comments-outline-icon.png" />
      <span>
        {{ $t('component.article_selection.comments.title') }}
      </span>
    </div>
    <div class="comment-list-container">
      <div class="comments-wrapper" ref="commentsWrapper" v-if="markComments.length > 0">
        <TransitionGroup name="opacity">
          <ArticleCommentCell
            v-for="(comment, index) in markComments"
            ref="commentCells"
            :key="index"
            :comment="comment.value"
            :userId="bookmarkUserId"
            @replyComment="options => replyComment(comment.value, options)"
            @click="navigateToMark(comment.value)"
            @commentDelete="commentDelete"
          />
        </TransitionGroup>
      </div>
      <div class="empty-wrapper" v-else>
        <span>{{ $t('component.article_selection.comments.placeholder') }}</span>
      </div>
    </div>
    <Transition name="opacity">
      <div class="comment-input-container" v-show="postCommentInfo && postCommentInfo.data && postCommentInfo.data.length > 0">
        <div class="comment-quote-container">
          <div class="quote">
            <i class="img bg-[url('@/assets/tiny-image-icon.png')]" v-if="showQuoteImage"></i>
            <template v-if="postCommentInfo">
              <span v-for="item in postCommentInfo.data" :key="item.content">{{ item.content }}</span>
            </template>
          </div>
          <button class="bg-[url('@/assets/button-circle-close.png')]" @click="clearPostCommentData"></button>
        </div>
        <Transition name="input">
          <div class="comment-input" v-show="postCommentInfo">
            <div class="comment-input-wrapper" :class="{ focus: isFocus }">
              <textarea
                ref="textarea"
                v-model="inputText"
                v-on-key-stroke:Enter="[onKeyDown, { eventName: 'keydown' }]"
                :placeholder="textareaPlaceholder"
                @focus="isFocus = true"
                @blur="isFocus = false"
                @compositionstart="compositionstart"
                @compositionend="compositionend"
                @input="handleInput"
              >
              </textarea>
              <button :class="{ disabled: !sendable }" class="bg-[url('@/assets/button-tiny-send-dark.png')]" @click="sendMessage"></button>
            </div>
          </div>
        </Transition>
      </div>
    </Transition>
  </div>
</template>

<script lang="ts" setup>
import ArticleCommentCell from './ArticleCommentCell.vue'

import { ExtensionsArticleSelection } from './ExtensionsArticleSelection'
import type { QuoteData } from '@slax-reader/selection/types'
import { type MarkCommentInfo, type MarkItemInfo } from '@slax-reader/selection/types'
import { vOnKeyStroke } from '@vueuse/components'

const props = defineProps({
  isAppeared: {
    required: false,
    type: Boolean
  },
  selection: {
    required: true,
    type: Object as PropType<ExtensionsArticleSelection>
  },
  bookmarkUserId: {
    required: true,
    type: Number
  }
})

const emits = defineEmits(['action'])

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
const textareaPlaceholder = ref($t('component.article_selection.placeholder'))
const compositionAppear = ref(false)
const textarea = ref<HTMLTextAreaElement>()
const commentsWrapper = ref<HTMLDivElement>()
const commentCells = ref<InstanceType<typeof ArticleCommentCell>[]>([])
const commentIdRefs = ref<Record<string, string>>({})
const inputText = ref('')
const postCommentInfo = ref<{ info: MarkItemInfo; data: QuoteData['data'] } | null>(null)
const isFocus = ref(false)

const sendable = computed(() => {
  return inputText.value.trim().length > 0
})

const showQuoteImage = computed(() => {
  return postCommentInfo.value && postCommentInfo.value.data && postCommentInfo.value.data.length > 0 && !!postCommentInfo.value.data.find(item => item.type === 'image')
})

const markComments = computed(() => {
  const marks = Array.from(document.body.querySelectorAll('slax-mark')) || []
  const markIds = marks.map(mark => mark.getAttribute('data-uuid') || '')

  const infos = props.selection.markItemInfos.value
  const noMarkRefs = infos.reduce(
    (acc, info) => {
      acc[info.id] = !markIds.includes(info.id)
      return acc
    },
    {} as Record<string, boolean>
  )

  return props.selection.markItemInfos.value
    .map(info => {
      if (info.comments.length === 0) {
        return []
      }

      return info.comments.map(comment => {
        commentIdRefs.value[comment.markUid] = info.id
        return ref(convertComment(comment, noMarkRefs[info.id]))
      })
    })
    .flat()
})

watch(
  () => postCommentInfo.value,
  value => {
    if (value) {
      nextTick(() => {
        focusTextarea()
      })
    }
  }
)

onMounted(() => {
  handleInput()
})

const showPostCommentView = (info: MarkItemInfo, data: QuoteData['data']) => {
  if (info) {
    postCommentInfo.value = {
      info,
      data
    }
  }
}

const navigateToComment = (comment: MarkCommentInfo) => {
  nextTick(() => {
    const index = markComments.value.findIndex(item => item.value.markUid === comment.markUid)
    if (index !== -1) {
      if (index < commentCells.value.length) {
        commentCells.value[index].highlightCell()
      }
    }
  })
}

const convertComment = (comment: MarkCommentInfo, noMarkMapping?: boolean): MarkCommentInfo => {
  const { children, ...detail } = comment
  return {
    ...detail,
    noMarkMapping,
    children: children.map(child => {
      return convertComment(child, noMarkMapping)
    })
  }
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

const postComment = (info: MarkItemInfo, options: { replyToUid: string; comment: string }) => {
  props.selection.strokeSelection({
    info,
    ...options
  })
}

const replyComment = (commentInfo: MarkCommentInfo, options: { replyToUid: string; comment: string }) => {
  const infoId = commentIdRefs.value[commentInfo.markUid]
  const info = props.selection.markItemInfos.value.find(item => item.id === infoId)
  if (!info) {
    return
  }

  props.selection.strokeSelection({
    info,
    ...options
  })
}

const commentDelete = (comment: MarkCommentInfo) => {
  const infoId = commentIdRefs.value[comment.reply ? (comment.rootUid ?? comment.markUid) : comment.markUid]
  const info = props.selection.markItemInfos.value.find(item => item.id === infoId)
  if (!info) {
    return
  }

  props.selection.deleteComment(info.id, comment.markUid)
}

const navigateToMark = (comment: MarkCommentInfo) => {
  const infoId = commentIdRefs.value[comment.reply ? (comment.rootUid ?? comment.markUid) : comment.markUid]
  const info = props.selection.markItemInfos.value.find(item => item.id === infoId)
  if (!info) {
    return
  }

  const quote = props.selection.createQuote(info.source, info.approx)
  props.selection.findQuote({
    source: { id: info.id },
    data: quote
  })
}

const compositionstart = () => {
  compositionAppear.value = true
}

const compositionend = () => {
  compositionAppear.value = false
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
  if (!postCommentInfo.value) {
    return
  }

  if (!sendable.value) {
    shakeTextarea()
    return
  }

  const cacheCommentIds = markComments.value.map(item => item.value.markUid)

  postComment(postCommentInfo.value.info, { comment: inputText.value, replyToUid: '' })

  nextTick(() => {
    const newCommentIds = markComments.value.map(item => item.value.markUid)
    if (newCommentIds.length > cacheCommentIds.length) {
      const index = newCommentIds.findIndex(id => !cacheCommentIds.includes(id))
      navigateToComment(markComments.value[index].value)
    }
  })

  clearPostCommentData()
  nextTick(() => {
    handleInput()
  })
}

const clearPostCommentData = () => {
  inputText.value = ''
  postCommentInfo.value = null
}

const handleInput = () => {
  if (!textarea.value) {
    return
  }

  textarea.value.style.height = '22px'
  textarea.value.style.height = textarea.value.scrollHeight + 'px'
}

const focusTextarea = () => {
  nextTick(() => {
    if (textarea.value) {
      textarea.value.blur()
      setTimeout(() => {
        textarea.value?.focus()
      }, 50)
    }
  })
}

defineExpose({
  navigateToComment,
  showPostCommentView
})
</script>

<style lang="scss" scoped>
.article-comments-view {
  --style: size-full flex flex-col bg-#262626 justify-between;

  .title {
    --style: pt-24px px-24px pb-12px select-none flex items-center justify-start;

    img {
      --style: size-20px object-contain;
    }

    span {
      --style: ml-8px text-(16px #999) line-height-22px;
    }
  }

  .comment-list-container {
    --style: flex-1 overflow-hidden relative;

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

    .comments-wrapper {
      --style: pt-12px pb-24px px-24px h-full overflow-auto;

      scroll-snap-type: x mandatory;
      scrollbar-width: none;
      &::-webkit-scrollbar {
        --style: hidden;
      }
    }

    .empty-wrapper {
      --style: size-full relative;

      span {
        --style: absolute left-1/2 -translate-x-1/2 top-1/2 -translate-y-1/2 text-(15px #ffffff66) line-height-21px whitespace-pre-line text-align-center;
      }
    }
  }

  .comment-input-container {
    --style: border-t-(1px solid #ffffff0f) pt-20px px-24px pb-16px;

    .comment-quote-container {
      --style: mb-20px flex items-center justify-between;

      .quote {
        --style: pl-8px line-clamp-2 text-(15px #ffffff66) break-all border-l-(2px solid #ffffff14);

        i.img {
          --style: w-13px h-13px inline-block bg-contain mr-4px translate-y-2px;
        }

        span {
          --style: line-height-21px overflow-hidden;
        }
      }

      button {
        --style: ml-16px shrink-0 w-16px h-16px bg-contain transition-transform duration-250;
        &:hover {
          --style: scale-105;
        }

        &:active {
          --style: scale-115;
        }
      }
    }

    .comment-quote-container + .comment-input {
      --style: ;
    }

    .comment-input {
      --style: max-h-300px overflow-hidden;

      .comment-input-wrapper {
        --style: pl-16px pt-16px pr-20px pb-14px w-full relative bg-#1a1a1aff border-(1px solid #1a1a1aff) rounded-8px flex flex-col justify-between;

        &.focus {
          --style: border-(1px solid #16b99899);
        }

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
