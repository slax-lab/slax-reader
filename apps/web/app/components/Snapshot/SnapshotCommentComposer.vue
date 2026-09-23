<template>
  <!-- 无引用时隐藏整个 composer -->
  <div v-if="canCompose" class="comment-composer" :class="{ replying: !!replyInfo }">
    <!-- 引用条：@用户名：内容 -->
    <div v-if="replyInfo" class="comment-composer-quote">
      <div class="comment-composer-quote-body">
        <span v-if="replyInfo.username" class="comment-composer-quote-author">@{{ replyInfo.username }}：</span>{{ replyInfo.content }}
      </div>
      <button class="comment-composer-quote-clear" :title="$t('page.bookmarks_detail.cancel_quote')" @click="cancelReply">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M18 6L6 18M6 6l12 12" />
        </svg>
      </button>
    </div>

    <textarea
      ref="textareaRef"
      v-autofocus
      v-ime-guard
      v-model="inputText"
      class="comment-composer-textarea"
      :placeholder="$t('page.bookmarks_detail.comment_placeholder')"
      :disabled="sending"
      rows="2"
      @keydown.enter.exact.prevent="handleSend"
      @keydown.enter.shift.exact="() => {}"
      @input="autoResize"
    />
    <div class="comment-composer-actions">
      <span class="comment-composer-hint">{{ $t('page.bookmarks_detail.send_hint') }}</span>
      <button class="comment-composer-send" :disabled="!inputText.trim() || sending" @click="handleSend">
        <div v-if="sending" class="i-svg-spinners:90-ring w-14px" />
        <span v-else>{{ $t('common.operate.send') }}</span>
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import type { MarkCommentInfo, MarkItemInfo, QuoteData } from '@slax-reader/selection/types'
import type { DwebArticleSelection } from '~/components/Article/Selection/DwebArticleSelection'
import { getUUID } from '~/components/Article/Selection/tools'
import { showLoginModal } from '~/components/Modal'
import Toast, { ToastType } from '~/components/Toast'
import { useUserStore } from '~/stores/user'

const props = defineProps<{
  allowAction?: boolean
  allowReply?: boolean
  articleSelection: DwebArticleSelection | null
  pendingSelection: MarkItemInfo | null
  pendingQuote: QuoteData | null
  activeInfoId: string | null
  infos?: MarkItemInfo[]
  replyToUid?: string | null
  focusTick?: number
  // 给纯划线补评论：true 才显示输入框
  composeStroke?: boolean
}>()

const emits = defineEmits<{
  sent: [infoId: string]
  'cancel-reply': []
}>()

const { t } = useI18n()
const userStore = useUserStore()
const textareaRef = ref<HTMLTextAreaElement>()
const inputText = ref('')
const sending = ref(false)

// 组装引用信息：@用户名：内容
const replyTarget = computed((): MarkCommentInfo | null => {
  if (!props.replyToUid || !props.infos) return null
  for (const info of props.infos) {
    const findComment = (comments: MarkCommentInfo[]): MarkCommentInfo | null => {
      for (const comment of comments) {
        if (comment.markUid === props.replyToUid) return comment.isDeleted ? null : comment
        const found = findComment(comment.children ?? [])
        if (found) return found
      }
      return null
    }
    const target = findComment(info.comments)
    if (target) return target
  }
  return null
})

const replyInfo = computed((): { username: string; content: string } | null => {
  // 新选区：从 pendingQuote 取划线文本（无用户名，只显示内容）
  if (props.pendingSelection && props.pendingQuote) {
    const texts = props.pendingQuote.data.filter(d => d.type === 'text').map(d => d.content)
    const content = texts.join('').slice(0, 80)
    if (content) return { username: '', content }
    return null
  }

  // 回复某条具体评论（replyToUid 优先）
  if (replyTarget.value) {
    return { username: replyTarget.value.username, content: replyTarget.value.comment?.slice(0, 80) ?? '' }
  }

  // 点击已有划线/评论（无 replyToUid，显示划线引用）
  if (props.activeInfoId && props.infos) {
    const info = props.infos.find(i => i.id === props.activeInfoId)
    if (!info) return null

    // 纯划线：显示划线文本
    const quoteText = getQuoteTextFromInfo(info)
    if (quoteText) return { username: '', content: quoteText.slice(0, 80) }
    return null
  }

  return null
})

// 新选区/回复直接显示
// 补评论须有引用，引用失效则隐藏
const hasTarget = computed(() => !!props.pendingSelection || !!replyTarget.value || (!!props.composeStroke && !!replyInfo.value))
const canCompose = computed(() => {
  if (props.allowAction !== false) return hasTarget.value
  return !!props.allowReply && !!props.replyToUid && !!replyTarget.value && !props.pendingSelection && !props.composeStroke
})

const getQuoteTextFromInfo = (info: MarkItemInfo): string => {
  // 优先用 approx.exact（服务端存储的精确文本，不依赖 DOM）
  if (info.approx?.exact) return info.approx.exact

  if (!info.source.length) return ''
  const textItems = info.source.filter(s => s.type === 'text')
  if (!textItems.length) return ''
  try {
    return textItems
      .map(item => {
        const el = document.querySelector(item.path)
        if (!el) return ''
        const text = el.textContent || ''
        return text.slice(item.start ?? 0, item.end ?? text.length)
      })
      .join('')
  } catch {
    return ''
  }
}

const cancelReply = () => {
  emits('cancel-reply')
}

// 命令式补聚焦（已显示时）
const focusTextarea = () => {
  nextTick(() => {
    const el = textareaRef.value
    if (!el?.isConnected) return
    el.focus({ preventScroll: true })
    const end = el.value.length
    el.setSelectionRange(end, end)
  })
}

watch(
  () => props.replyToUid,
  uid => uid && focusTextarea()
)
// 重复点同一目标也聚焦
watch(
  () => props.focusTick,
  () => focusTextarea()
)

const autoResize = () => {
  const el = textareaRef.value
  if (!el) return
  el.style.height = 'auto'
  el.style.height = Math.min(el.scrollHeight, 200) + 'px'
}

const handleSend = async () => {
  if (!canCompose.value || !inputText.value.trim() || sending.value) return

  if (!userStore.userInfo) {
    showLoginModal({ redirect: location.href })
    return
  }

  if (!props.articleSelection) return

  sending.value = true
  const comment = inputText.value.trim()

  try {
    let info: MarkItemInfo

    if (props.pendingSelection) {
      info = props.pendingSelection
    } else if (props.activeInfoId) {
      const existing = props.articleSelection.markItemInfos?.value?.find(i => i.id === props.activeInfoId)
      if (existing) {
        info = existing
      } else {
        info = { id: getUUID(), source: [], comments: [], stroke: [], approx: undefined }
      }
    } else {
      info = { id: getUUID(), source: [], comments: [], stroke: [], approx: undefined }
    }

    const resultInfoId = await props.articleSelection.strokeSelection({
      info,
      comment,
      // 新选区是全新评论，不能带 replyToUid；只有回复已有评论时才传
      replyToUid: props.pendingSelection ? undefined : (props.replyToUid ?? undefined)
    })

    if (!resultInfoId) {
      return
    }

    inputText.value = ''
    if (textareaRef.value) {
      textareaRef.value.style.height = 'auto'
    }
    emits('sent', resultInfoId)
    emits('cancel-reply')
  } catch {
    Toast.showToast({ text: t('common.tips.operate_failed'), type: ToastType.Error })
  } finally {
    sending.value = false
  }
}
</script>

<style lang="scss" scoped>
.comment-composer {
  flex-shrink: 0;
  border-top: 1px solid var(--slax-border);
  padding: 14px 24px 24px;
  box-shadow: 0 -8px 16px -8px color-mix(in srgb, var(--slax-accent) 6%, transparent);
  background: var(--slax-bg);
  display: flex;
  flex-direction: column;
  gap: 8px;
  transition:
    border-color 0.15s,
    box-shadow 0.15s;

  &:focus-within {
    border-top-color: color-mix(in srgb, var(--slax-accent) 35%, transparent);
    box-shadow: 0 -8px 16px -8px color-mix(in srgb, var(--slax-accent) 10%, transparent);
  }

  .comment-composer-quote {
    display: none;
    align-items: flex-start;
    gap: 8px;
    padding: 7px 10px 7px 11px;
    background: var(--slax-accent-bg);
    border-left: 3px solid var(--slax-accent);
    border-radius: 0 4px 4px 0;
    // 引用文字统一 13px
    font-size: 13px;
    line-height: 1.55;
    color: var(--slax-text-muted);

    .comment-composer-quote-body {
      flex: 1;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      line-clamp: 2;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    .comment-composer-quote-author {
      color: var(--slax-accent);
      font-weight: 500;
      margin-right: 2px;
    }

    .comment-composer-quote-clear {
      width: 18px;
      height: 18px;
      background: none;
      border: none;
      padding: 0;
      cursor: pointer;
      color: var(--slax-text-light);
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
      border-radius: 4px;
      transition: all 0.15s;

      svg {
        width: 12px;
        height: 12px;
      }

      &:hover {
        color: var(--slax-text);
        background: color-mix(in srgb, var(--slax-accent) 10%, transparent);
      }
    }
  }

  &.replying .comment-composer-quote {
    display: flex;
  }

  .comment-composer-textarea {
    width: 100%;
    min-height: 40px;
    max-height: 200px;
    resize: none;
    border: none;
    background: transparent;
    color: var(--slax-text);
    font-size: 13px;
    font-family: inherit;
    line-height: 1.6;
    outline: none;

    &::placeholder {
      color: var(--slax-text-light);
    }
  }

  .comment-composer-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;

    .comment-composer-hint {
      font-size: 12px;
      color: var(--slax-text-light);
      font-weight: 300;
    }

    .comment-composer-send {
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 6px 16px;
      border-radius: 6px;
      font-size: 12px;
      font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      transition: all 0.15s;
      background: var(--slax-accent);
      color: white;

      &:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }

      &:not(:disabled):hover {
        transform: translateY(-1px);
        box-shadow: 0 2px 8px color-mix(in srgb, var(--slax-accent) 20%, transparent);
      }
    }
  }
}
</style>
