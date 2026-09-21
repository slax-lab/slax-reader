<template>
  <div class="snapshot-chat-panel" ref="chat">
    <!-- 标题（对齐 snapshot demo 的 .panel-title） -->
    <div class="chat-title">
      <span>{{ $t('component.chat_bot.panel_title') }}</span>
      <OptionsBar v-if="showModelSwitcher" class="chat-model-switcher" :options="MODEL_LABELS" :default-selected-index="selectedModelIndex" v-model:index="selectedModelIndex" />
    </div>
    <!-- 消息流（含空态） -->
    <div
      class="chat-messages"
      :class="{ scrolled: isScrolled }"
      ref="messages"
      @scroll="onMessagesScroll"
      @wheel.passive="onWheel"
      @touchstart.passive="onTouchStart"
      @touchmove.passive="onTouchMove"
      @touchend.passive="onTouchEnd"
      @touchcancel.passive="onTouchEnd"
    >
      <!-- 空态 -->
      <div v-if="messageList.length === 0 && !isChatting" class="chat-empty">
        <div class="chat-empty-icon">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.6">
            <path d="M12 2 L13.5 8.5 L20 10 L13.5 11.5 L12 18 L10.5 11.5 L4 10 L10.5 8.5 Z" />
          </svg>
        </div>
        <div class="chat-empty-title">{{ $t('component.snapshot_chat.empty_title') }}</div>
        <div class="chat-empty-desc">{{ $t('component.snapshot_chat.empty_desc') }}</div>
      </div>

      <!-- 消息列表 -->
      <template v-for="message in messageList" :key="message.id">
        <!-- 用户消息（右气泡 + 可选引用块） -->
        <template v-if="message.type === 'bubble' && message.direction === 'right'">
          <div v-if="message.quote && message.quote.data.length > 0" class="chat-msg-quote">
            <span v-for="(item, index) in message.quote.data" :key="index">{{ item.type === 'image' ? '🖼️' : item.content }}</span>
          </div>
          <div class="chat-msg-user">{{ bubbleText(message) }}</div>
        </template>

        <!-- AI 消息（左对齐无气泡 + 内联 tips/links/bookmarks/related-question + 完成态复制按钮） -->
        <div v-else-if="message.type === 'bubble' && message.direction === 'left'" class="chat-msg-ai">
          <template v-for="(content, ci) in message.contents || []" :key="ci">
            <div v-if="content.type === 'text'" class="chat-msg-ai-text" v-html="content.content"></div>
            <div v-else-if="content.type === 'tips'" class="chat-msg-ai-tip" :data-tips-type="content.tipsType" :data-loading="content.loading ? 'true' : 'false'">
              {{ content.tips }}
            </div>
            <div v-else-if="content.type === 'links'" class="chat-msg-ai-links" data-content-type="links">
              <a v-for="link in content.content" :key="link.url" :href="link.url" target="_blank" rel="noopener">{{ link.title }}</a>
            </div>
            <div v-else-if="content.type === 'bookmarks'" class="chat-msg-ai-bookmarks" data-content-type="bookmarks">
              <div v-for="bm in content.content" :key="bm.bookmark_id" class="chat-msg-ai-bookmark">{{ bm.title }}</div>
            </div>
            <template v-else-if="content.type === 'related-question'">
              <QuestionMessage v-for="(q, qi) in content.questions" :key="qi" :question="toQuestionItem(q)" @question-click="relatedQuestionClick(message, q)" />
            </template>
          </template>
          <span v-if="message.isBuffering" class="chat-msg-ai-caret"></span>
          <div v-else class="chat-msg-ai-tools">
            <button class="chat-copy-btn" @click="copyMessage(message)">
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.6">
                <rect x="9" y="9" width="11" height="11" rx="2" />
                <path d="M5 15V5a2 2 0 0 1 2-2h10" />
              </svg>
              <span v-if="copiedId === message.id" class="chat-copied-tip">{{ $t('component.snapshot_chat.copied') }}</span>
            </button>
          </div>
        </div>

        <!-- 建议问题（generateQuestion 产出的独立 question 消息） -->
        <QuestionMessage v-else-if="message.type === 'question'" :question="message" @question-click="questionClick" />

        <!-- 顶层 tips（generateQuestion / error） -->
        <TipsMessage v-else-if="message.type === 'tips'" :tips="message" />
      </template>

      <!-- buffer 流式消息（与 message 列表分开渲染，逻辑同 AI 消息） -->
      <div v-if="bufferMessage" class="chat-msg-ai">
        <template v-for="(content, ci) in bufferMessage.contents || []" :key="ci">
          <div v-if="content.type === 'text'" class="chat-msg-ai-text" v-html="content.content"></div>
          <div v-else-if="content.type === 'tips'" class="chat-msg-ai-tip" :data-tips-type="content.tipsType" :data-loading="content.loading ? 'true' : 'false'">
            {{ content.tips }}
          </div>
          <div v-else-if="content.type === 'links'" class="chat-msg-ai-links" data-content-type="links">
            <a v-for="link in content.content" :key="link.url" :href="link.url" target="_blank" rel="noopener">{{ link.title }}</a>
          </div>
          <div v-else-if="content.type === 'bookmarks'" class="chat-msg-ai-bookmarks" data-content-type="bookmarks">
            <div v-for="bm in content.content" :key="bm.bookmark_id" class="chat-msg-ai-bookmark">{{ bm.title }}</div>
          </div>
          <template v-else-if="content.type === 'related-question'">
            <QuestionMessage v-for="(q, qi) in content.questions" :key="qi" :question="toQuestionItem(q)" @question-click="relatedQuestionClick(bufferMessage, q)" />
          </template>
        </template>
        <span class="chat-msg-ai-caret"></span>
      </div>

      <!-- 加载态（chatting 且无 buffer 时） -->
      <div class="chat-loading" v-if="isChatting && !bufferMessage">
        <DotLoading indicate-color="var(--slax-text-light)" />
      </div>
    </div>

    <!-- 回到底部：零高度浮层，不占布局 -->
    <div class="chat-scroll-down-bar">
      <button
        v-if="showScrollDown"
        class="chat-scroll-down"
        :class="{ 'has-new': isChatting }"
        :title="$t('component.snapshot_chat.scroll_to_bottom')"
        :aria-label="$t('component.snapshot_chat.scroll_to_bottom')"
        @click="scrollDownClick"
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
          <path d="M12 5v14M6 13l6 6 6-6" />
        </svg>
      </button>
    </div>

    <!-- 输入区（复用 .comment-composer 规范） -->
    <div class="chat-composer">
      <div class="chat-composer-quote" v-if="quoteInfo && quoteInfo.data.length > 0">
        <div class="chat-composer-quote-text">
          <span v-for="(item, index) in quoteInfo.data" :key="index">{{ item.type === 'image' ? '🖼️' : item.content }}</span>
        </div>
        <button class="chat-composer-quote-close" @click="closeQuote" aria-label="cancel quote">
          <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M18 6L6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <textarea
        ref="textarea"
        v-ime-guard
        v-model="inputText"
        v-on-key-stroke:Enter="[onKeyDown, { eventName: 'keydown' }]"
        :placeholder="textareaPlaceholder"
        @input="handleInput"
      ></textarea>
      <div class="chat-composer-actions">
        <span class="chat-composer-hint">{{ textareaPlaceholder }}</span>
        <button class="chat-send-btn" :disabled="!sendable" @click="sendMessage()">{{ $t('common.operate.send') }}</button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import QuestionMessage from '~/components/Chat/QuestionMessage.vue'
import TipsMessage from '~/components/Chat/TipsMessage.vue'
import DotLoading from '~/components/DotLoading.vue'
import OptionsBar from '~/components/OptionsBar.vue'

import { parseMarkdownText } from '@commons/utils/parse'
import { getUUID } from '@commons/utils/random'
import type { ChatBotParams } from '~/utils/chatbot'

import { vOnKeyStroke } from '@vueuse/components'
import type { BubbleMessageContent, BubbleMessageItem, MessageItem, QuestionMessageItem, QuoteData } from '~/components/Chat/type'

const { t } = useI18n()

const props = defineProps<{
  bookmarkId?: number
  shareCode?: string
  collection?: { code: string; cbId: number }
  // /b/[id] 的 bookmark_uid
  bookmarkUid?: string
  isAppeared?: boolean
  closeButtonHidden?: boolean
}>()

const emits = defineEmits<{
  dismiss: []
  findQuote: [quote: QuoteData]
}>()

const botParams: ChatBotParams = (() => {
  if (props.bookmarkId) {
    return { bookmarkId: props.bookmarkId }
  } else if (props.shareCode) {
    return { shareCode: props.shareCode }
  } else if (props.collection) {
    return { collection: props.collection }
  } else if (props.bookmarkUid) {
    return { bookmarkUid: props.bookmarkUid }
  } else {
    return { bookmarkId: 0 }
  }
})()

const bot = new ChatBot(botParams, (params: { type: ChatResponseType; data: ChatResponseData }) => {
  const { type, data } = params
  if (type === ChatResponseType.FUNCTION) {
    if (!data[type]) {
      return
    }
    const { name, args } = data[type]
    if (name === 'generateQuestion' && args) {
      bufferMessage.value = null
      const noQuestionMessage = !messageList.value.find(item => item.type === 'question' || (item.type === 'tips' && item.tipsType === 'generateQuestion'))
      if (noQuestionMessage) {
        messageList.value.push({ id: `tips_generate_question`, type: 'tips', tipsType: 'generateQuestion' })
      }
      messageList.value = messageList.value.concat(
        args.map((item: string) => {
          return { type: 'question', text: getParsedText(item), clickable: true, id: `question_${item}`, isHTML: true, rawContent: item }
        })
      )
      onStreamTick()
    } else if (name === 'relatedQuestion' && args) {
      pushBuffer({ type: 'related-question', questions: [{ content: args, rawContent: args }] })
    } else if (name === 'search' && args) {
      pushBuffer({ type: 'links', content: args })
    } else if (name === 'searchBookmark' && args) {
      let parsed = []
      if (typeof args === 'string') {
        try {
          const p = JSON.parse(args)
          parsed = Array.isArray(p) ? p : p.data || []
        } catch (e) {
          return
        }
      } else if (Array.isArray(args)) {
        parsed = args
      } else if (args && (args as any).data) {
        parsed = (args as any).data
      }
      if (parsed.length > 0) {
        const bookmarks = parsed.map((item: any) => ({
          title: item.highlight_title?.replace(/<\/?mark>/g, '') || t('component.chat_bot.bookmark_no_title'),
          content: item.highlight_content?.replace(/<\/?mark>/g, '') || t('component.chat_bot.bookmark_no_content'),
          bookmark_id: item.bookmark_id
        }))
        pushBuffer({ type: 'bookmarks', content: bookmarks })
      }
    }
  } else if (type === ChatResponseType.CONTENT) {
    pushBuffer({ type: 'text', content: data[type] || '' })
  } else if (type === ChatResponseType.STATUS_UPDATE) {
    if (!data[type]) {
      return
    }
    const { name, tips, status } = data[type]
    if (status === 'processing') {
      if (name === 'generateQuestion') {
        pushBuffer({ type: 'tips', tips: t(`component.chat_bot.generating_question`), loading: true, tipsType: name })
      } else if (name === 'browser') {
        pushBuffer({ type: 'tips', tips: tips ? t('component.chat_bot.{tips}_accessing', { tips }) : t('component.chat_bot.now_accessing'), loading: true, tipsType: name })
      } else if (name === 'search') {
        pushBuffer({ type: 'tips', tips: t('component.chat_bot.{tips}_searching', { tips }), loading: true, tipsType: name })
      } else if (name === 'searchBookmark') {
        pushBuffer({ type: 'tips', tips: t('component.chat_bot.{tips}_searching_bookmark', { tips }), loading: true, tipsType: name })
      }
    } else if (status === 'finished') {
      if (name === 'browser') {
        updateTipsBrowserStatus(true)
      } else if (name === 'search') {
        updateTipsSearchStatus(true)
      } else if (name === 'searchBookmark') {
        updateTipsSearchBookmarkStatus(true)
      } else {
        discardSearch()
      }
    } else if (status === 'failed') {
      if (name === 'browser') {
        updateTipsBrowserStatus(false)
      } else if (name === 'search') {
        updateTipsSearchStatus(false)
      } else if (name === 'searchBookmark') {
        updateTipsSearchBookmarkStatus(false)
      } else if (name === 'error') {
        messageList.value = messageList.value.concat([{ id: `tips_error_${data[type].tips}`, type: 'tips', tipsType: 'error', data: data[type].tips }])
      }
    }
  }
})

const MODEL_OPTIONS = [
  { label: 'Gemini 3 Flash Preview', id: 'gemini-3-flash-preview' },
  { label: 'Gemini 3.5 Flash', id: 'gemini-3.5-flash' },
  { label: 'Gemini 3.1 Flash Lite', id: 'gemini-3.1-flash-lite' }
]
const MODEL_LABELS = MODEL_OPTIONS.map(m => m.label)
const selectedModelIndex = ref(0)
const showModelSwitcher = useRuntimeConfig().public.slaxEnv !== 'production'

watch(
  selectedModelIndex,
  index => {
    bot.model = showModelSwitcher ? MODEL_OPTIONS[index]?.id : undefined
  },
  { immediate: true }
)

bot.chatStatusUpdateHandler = (chatting: boolean) => {
  isChatting.value = chatting
  if (!chatting) {
    const result = bufferToMessage()
    if (result) {
      onStreamTick()
    }
    // 收尾：置顶没达成就别留着
    // 须排在 onStreamTick 的 rAF 后
    finishRaf = requestAnimationFrame(() => {
      finishRaf = null
      if (!pinActive.value) {
        return
      }
      pinActive.value = false
      syncAtBottom()
      if (atBottom.value) {
        autoFollow.value = true
      }
    })
  }
}

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
const textareaPlaceholder = t('component.chat_bot.{alias}_placeholder', { alias: isMac ? 'cmd' : 'ctrl' })
const isInited = ref(false)
const chat = ref<HTMLDivElement>()
const messages = ref<HTMLDivElement>()
const textarea = ref<HTMLTextAreaElement>()
const inputText = ref('')
const isChatting = ref(false)
const messageList = ref<MessageItem[]>([]) as Ref<MessageItem[]>
const bufferMessage = ref<BubbleMessageItem | null>(null) as Ref<BubbleMessageItem | null>
const bufferMarkdownContent = ref('')
const quoteInfo = ref<QuoteData | null>(null) as Ref<QuoteData | null>
const copiedId = ref<string | null>(null)
// 是否已向下滚动：仅在离开顶部后才启用顶部淡出 mask，避免滚到最顶时淡化最上方消息
const isScrolled = ref(false)

// 流式贴底跟随；只由用户滚动改写
const autoFollow = ref(true)
// 新提问置顶中
const pinActive = ref(false)
const atBottom = ref(true)
// 距底容差
const BOTTOM_EPS = 24
// 置顶留的上边距
const PIN_OFFSET = 8
// 程序滚动落点，用于区分用户滚动
let expectedTop: number | null = null
// 上次滚动位置
let lastScrollTop = 0

const distanceToBottom = () => {
  const box = messages.value
  if (!box) {
    return 0
  }
  return box.scrollHeight - box.scrollTop - box.clientHeight
}

const syncAtBottom = () => {
  atBottom.value = distanceToBottom() <= BOTTOM_EPS
}

// 手势早于 scroll，故不只靠它
// 否则程序滚动会掩盖用户那次事件
const applyUserIntent = (goingUp: boolean) => {
  expectedTop = null
  pinActive.value = false
  if (goingUp) {
    autoFollow.value = false
    return
  }
  // 在底部往下拨无 scroll 事件，
  // 只能在此恢复跟随
  syncAtBottom()
  if (atBottom.value) {
    autoFollow.value = true
  }
}

const onWheel = (e: WheelEvent) => applyUserIntent(e.deltaY < 0)

// null = 无可测方向的单指
let touchY: number | null = null

const onTouchStart = (e: TouchEvent) => {
  // 多指时 touches[0] 不可靠
  touchY = e.touches.length === 1 ? (e.touches[0]?.clientY ?? null) : null
}

const onTouchEnd = () => {
  touchY = null
}

const onTouchMove = (e: TouchEvent) => {
  if (e.touches.length !== 1) {
    touchY = null
    return
  }
  const y = e.touches[0]?.clientY ?? null
  if (y === null) {
    return
  }
  if (touchY !== null) {
    // 手指下移 = 看上文
    applyUserIntent(y > touchY)
  }
  touchY = y
}

const onMessagesScroll = () => {
  const box = messages.value
  if (!box) {
    return
  }
  const top = box.scrollTop
  isScrolled.value = top > 0
  syncAtBottom()
  // 落点对得上 = 自己滚的，不改用户意图
  const isOurs = expectedTop !== null && Math.abs(top - expectedTop) <= 1
  if (!isOurs) {
    expectedTop = null
    if (top < lastScrollTop - 1) {
      // 往上滚 = 在看上文，停跟随
      pinActive.value = false
      autoFollow.value = false
    } else if (atBottom.value) {
      // 滚回底部 = 恢复跟随，一并清置顶
      pinActive.value = false
      autoFollow.value = true
    }
  }
  lastScrollTop = top
}

const showScrollDown = computed(() => !atBottom.value && (messageList.value.length > 0 || !!bufferMessage.value))

const scrollDownClick = () => {
  pinActive.value = false
  autoFollow.value = true
  jumpToBottom('smooth')
}

const sendable = computed(() => inputText.value.trim().length > 0 && !isChatting.value)

const bubbleText = (message: BubbleMessageItem) => {
  return (message.contents || [])
    .filter(c => c.type === 'text')
    .map(c => (c as any).rawContent || (c as any).content)
    .join('\n')
}

const toQuestionItem = (q: { content: string; rawContent?: string }): QuestionMessageItem => ({
  id: `related_${q.rawContent || q.content}`,
  type: 'question',
  text: q.content,
  clickable: true,
  isHTML: true,
  rawContent: q.rawContent
})

watch(
  () => props.isAppeared,
  value => {
    if (value && !isInited.value && !quoteInfo.value) {
      isInited.value = true
      addLog('open')
    } else if (value) {
      addLog('expand')
    }
    if (value) {
      nextTick(() => {
        focusTextarea()
        // 隐藏时几何为 0，显示后补贴底
        if (autoFollow.value) {
          jumpToBottom()
        } else {
          syncAtBottom()
        }
      })
    }
  },
  { flush: 'sync', immediate: true }
)

const addLog = (subAction: 'open' | 'expand' | 'close' | 'collapse') => {
  if (props.bookmarkId) {
    analyticsLog({ event: 'bookmark_chat_interact', sub_action: subAction, entry_point: 'sidebar_entry' })
  }
}

onMounted(() => jumpToBottom())

onUnmounted(() => {
  // ChatBot.destruct() 只清 responseCallback，不清 chatStatusUpdateHandler；
  // 显式置 undefined 防止 in-flight stream 卸载后仍触发状态更新（类型为可选函数）
  bot.chatStatusUpdateHandler = undefined
  bot.destruct()
  if (streamTickRaf !== null) {
    cancelAnimationFrame(streamTickRaf)
    streamTickRaf = null
  }
  if (finishRaf !== null) {
    cancelAnimationFrame(finishRaf)
    finishRaf = null
  }
})

const handleInput = () => {
  if (!textarea.value) {
    return
  }
  textarea.value.style.height = '22px'
  textarea.value.style.height = textarea.value.scrollHeight + 'px'
}

// 贴底；smooth 会打断滚轮
const scrollToBottomNow = (behavior: ScrollBehavior = 'auto') => {
  const box = messages.value
  if (!box) {
    return
  }
  // clamp 后即落点
  expectedTop = box.scrollHeight - box.clientHeight
  box.scrollTo({ top: box.scrollHeight, behavior })
  syncAtBottom()
}

const jumpToBottom = (behavior: ScrollBehavior = 'auto') => {
  nextTick(() => scrollToBottomNow(behavior))
}

// 置顶目标=最后一条用户消息/引用块
const pinTargetEl = () => {
  const box = messages.value
  if (!box) {
    return null
  }
  const bubbles = box.querySelectorAll<HTMLElement>('.chat-msg-user')
  const last = bubbles[bubbles.length - 1]
  if (!last) {
    return null
  }
  const prev = last.previousElementSibling as HTMLElement | null
  return prev?.classList.contains('chat-msg-quote') ? prev : last
}

// 提问置顶，不到位则逐 token 重试
const applyPin = () => {
  const box = messages.value
  const el = pinTargetEl()
  if (!box || !el) {
    return
  }
  const delta = el.getBoundingClientRect().top - box.getBoundingClientRect().top - PIN_OFFSET
  if (Math.abs(delta) <= 1) {
    pinActive.value = false
    return
  }
  const before = box.scrollTop
  box.scrollBy({ top: delta, behavior: 'auto' })
  // auto 同步生效，直接读落点
  expectedTop = box.scrollTop
  syncAtBottom()
  // 上滚不动=到顶收工，下滚不动=待重试
  if (delta < 0 && box.scrollTop === before) {
    pinActive.value = false
  }
}

// 流式/新消息统一入口
// 逐 token 读几何，rAF 合成一帧
let streamTickRaf: number | null = null
// 流式收尾那次 rAF，卸载时要一并取消
let finishRaf: number | null = null

const onStreamTick = () => {
  if (streamTickRaf !== null) {
    return
  }
  streamTickRaf = requestAnimationFrame(() => {
    streamTickRaf = null
    // 状态在回调里重读，避免用排队时的旧值
    if (pinActive.value) {
      applyPin()
      // 提前 return 时也要刷按钮
      syncAtBottom()
    } else if (autoFollow.value) {
      scrollToBottomNow()
    } else {
      // 内容变高不触发 scroll，补算一次
      syncAtBottom()
    }
  })
}

// sendMessage 扩展：有 text 参数时用参数文本（建议问题点击），但仍保留 isChatting 防重入
const sendMessage = (text?: string) => {
  const content = (text ?? inputText.value).trim()
  if (isChatting.value || content.length === 0) {
    if (text === undefined) {
      shakeTextarea()
    }
    return
  }
  const history = getHistoryMessages()
  const currentQuote = quoteInfo.value ?? undefined
  messageList.value.push({
    type: 'bubble',
    direction: 'right',
    contents: [{ type: 'text', content }],
    quote: currentQuote,
    id: `bubble_right_${content}_${getUUID()}`
  })
  bot.chat({ type: ChatParamsType.CONTENT, content, history, quote: currentQuote })
  inputText.value = ''
  quoteInfo.value = null
  // 新一轮：提问置顶，之后不追输出
  pinActive.value = true
  autoFollow.value = false
  nextTick(() => {
    applyPin()
    handleInput()
  })
}

const questionClick = (question: QuestionMessageItem) => {
  if (isChatting.value) {
    return
  }
  question.clickable = false
  const questionsRange: number[] = []
  let inQuestionQueue = false
  let findQuestion = false
  for (let i = 0; i < messageList.value.length; i++) {
    const messageItem = messageList.value[i]!
    inQuestionQueue = messageItem.type === 'question'
    if (messageItem === question) {
      findQuestion = true
    }
    if (inQuestionQueue) {
      questionsRange.push(i)
    } else {
      if (findQuestion) {
        break
      } else {
        questionsRange.length = 0
      }
    }
  }
  if (!findQuestion) {
    questionsRange.length = 0
  }
  messageList.value = messageList.value.filter((item, idx) => {
    if (item.type === 'question' && item !== question && item.clickable && questionsRange.includes(idx)) {
      return false
    }
    return true
  })
  if (!question.rawContent) {
    return
  }
  // 无气泡可锚，改贴底并立刻滚一次
  pinActive.value = false
  autoFollow.value = true
  jumpToBottom()
  bot.chat({ type: ChatParamsType.ASK, questions: question.rawContent })
}

const relatedQuestionClick = (message: BubbleMessageItem | null, question: { content: string; rawContent?: string }) => {
  if (isChatting.value || !message) {
    return
  }
  const index = messageList.value.findIndex(item => item === message)
  if (index !== -1) {
    messageList.value.splice(index, 1)
  }
  messageList.value.push({
    id: `question_${question.rawContent}`,
    type: 'question',
    text: question.content,
    clickable: false,
    isHTML: true,
    rawContent: question.rawContent
  })
  // 同上
  pinActive.value = false
  autoFollow.value = true
  jumpToBottom()
  bot.chat({ type: ChatParamsType.ASK, questions: question.content })
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

const pushBuffer = (content: BubbleMessageContent) => {
  if (!bufferMessage.value) {
    bufferMessage.value = { type: 'bubble', direction: 'left', contents: [], isBuffering: true, id: `bubble_buffer` }
  }
  if (!bufferMessage.value.contents) {
    bufferMessage.value.contents = []
  }
  const contents = bufferMessage.value.contents
  if (content.type === 'links' || content.type === 'tips' || content.type === 'bookmarks') {
    contents.push(content)
    bufferMarkdownContent.value = ''
  } else if (content.type === 'related-question') {
    if (bufferMessage.value && bufferMessage.value.contents && bufferMessage.value.contents.length > 0 && bufferMessage.value.contents[0]!.type !== 'related-question') {
      bufferToMessage()
      bufferMessage.value = { type: 'bubble', direction: 'left', contents: [] as BubbleMessageContent[], isBuffering: true, id: `bubble_buffer` }
    }
    const newBufferMessageContents = bufferMessage.value.contents
    if (newBufferMessageContents?.length === 0) {
      newBufferMessageContents.push(content)
    } else {
      const lastContent = newBufferMessageContents?.[newBufferMessageContents.length - 1]
      if (content.type !== lastContent?.type) {
        newBufferMessageContents?.push(content)
      } else {
        lastContent.questions = lastContent.questions.concat(content.questions)
      }
    }
    bufferMarkdownContent.value = ''
  } else {
    if (contents.length === 0) {
      if (content.type === 'text') {
        bufferMarkdownContent.value = content.content
        content.content = getParsedText(bufferMarkdownContent.value)
        content.rawContent = bufferMarkdownContent.value
        content.isHTML = true
      }
      contents.push(content)
    } else {
      const lastContent = contents[contents.length - 1]!
      if (content.type !== lastContent.type) {
        if (content.type === 'text') {
          bufferMarkdownContent.value = content.content
          content.content = getParsedText(bufferMarkdownContent.value)
          content.rawContent = bufferMarkdownContent.value
          content.isHTML = true
        }
        contents.push(content)
      } else if (content.type === 'text' && lastContent.type === 'text') {
        bufferMarkdownContent.value += content.content
        lastContent.content = getParsedText(bufferMarkdownContent.value)
        lastContent.rawContent = bufferMarkdownContent.value
      }
    }
  }
  const isSearchOrBrowserTips = (item: BubbleMessageContent): boolean => item.type === 'tips' && (item.tipsType === 'search' || item.tipsType === 'browser')
  const shouldKeepContent = (item: BubbleMessageContent): boolean => item.type !== 'tips' || !isSearchOrBrowserTips(item)
  if (content.type !== 'tips' || !isSearchOrBrowserTips(content)) {
    bufferMessage.value.contents = bufferMessage.value.contents?.filter(shouldKeepContent)
  }
  onStreamTick()
}

const bufferToMessage = () => {
  bufferMarkdownContent.value = ''
  if (bufferMessage.value && (bufferMessage.value.contents || []).length > 0) {
    bufferMessage.value.isBuffering = false
    bufferMessage.value.id = `bubble_${getUUID()}_${new Date().getTime()}`
    messageList.value.push(bufferMessage.value)
    bufferMessage.value = null
    discardSearch()
    return true
  }
  return false
}

const updateTipsSearchStatus = (success: boolean) => {
  const searchMessage = bufferMessage.value?.contents?.find(content => content.type === 'tips' && content.tipsType === 'search' && content.loading)
  if (!searchMessage || searchMessage.type !== 'tips') {
    return
  }
  const tipsText = success ? t('component.chat_bot.search_complete') : t('component.chat_bot.search_failed')
  const reg = new RegExp(`${t('component.chat_bot.searching_token')}\\.\\.\\.$`)
  searchMessage.tips = searchMessage.tips.replace(reg, tipsText)
  searchMessage.loading = false
}

const updateTipsSearchBookmarkStatus = (success: boolean) => {
  const searchMessage = bufferMessage.value?.contents?.find(content => content.type === 'tips' && content.tipsType === 'searchBookmark' && content.loading)
  if (!searchMessage || searchMessage.type !== 'tips') {
    return
  }
  const tipsText = success ? t('component.chat_bot.search_bookmark_complete') : t('component.chat_bot.search_bookmark_failed')
  const reg = new RegExp(`${t('component.chat_bot.search_bookmark_token')}\\.\\.\\.$`)
  searchMessage.tips = searchMessage.tips.replace(reg, tipsText)
  searchMessage.loading = false
}

const updateTipsBrowserStatus = (success: boolean) => {
  const browerMessage = bufferMessage.value?.contents?.find(content => content.type === 'tips' && content.tipsType === 'browser' && content.loading)
  if (!browerMessage || browerMessage.type !== 'tips') {
    return
  }
  const tipsText = success ? t('component.chat_bot.access_complete') : t('component.chat_bot.access_failed')
  if (browerMessage.tips === t('component.chat_bot.now_accessing')) {
    browerMessage.tips = tipsText
  } else {
    const reg = new RegExp(`${t('component.chat_bot.accessing_token')}\\.\\.\\.$`)
    browerMessage.tips = browerMessage.tips.replace(reg, tipsText)
  }
  browerMessage.loading = false
}

const discardSearch = () => {
  if (!bufferMessage.value || !bufferMessage.value.contents || bufferMessage.value.contents.length === 0) {
    return
  }
  bufferMessage.value.contents = bufferMessage.value.contents.filter(item => item.type !== 'tips' || (item.type === 'tips' && !item.loading))
}

const getHistoryMessages = () => {
  const history = messageList.value
    .filter(data => data.type === 'bubble')
    .map(data => {
      const content =
        (data as BubbleMessageItem).contents
          ?.filter(c => c.type === 'text')
          .map(c => (c as any).rawContent || (c as any).content)
          .join('\n') || ''
      return { role: (data as BubbleMessageItem).direction === 'left' ? 'assistant' : 'user', content }
    })
    .filter(data => data.content.length > 0) as { role: 'assistant' | 'user'; content: string }[]
  if (history.length > 5) {
    history.reverse()
    history.length = 5
    history.reverse()
  }
  return history
}

const shakeTextarea = () => {
  if (!textarea.value) {
    return
  }
  textarea.value.classList.add('shake')
  textarea.value.addEventListener('animationend', () => textarea.value?.classList.remove('shake'), { once: true })
}

const getParsedText = (markdownText: string) => {
  return parseMarkdownText(markdownText).replace(/<a/g, '<a target="_blank"') || ''
}

const addQuoteData = (data: QuoteData) => {
  quoteInfo.value = data
  // 侧栏已开时 watch 不触发，自己聚焦
  focusTextarea()
  jumpToBottom()
}

const focusTextarea = () => {
  nextTick(() => {
    const el = textarea.value
    if (!el?.isConnected) {
      return
    }
    // 长文页聚焦不该滚走页面
    el.focus({ preventScroll: true })
    const end = el.value.length
    el.setSelectionRange(end, end)
  })
}

const closeQuote = () => {
  quoteInfo.value = null
}

const copyMessage = async (message: BubbleMessageItem) => {
  const text = (message.contents || [])
    .filter(c => c.type === 'text')
    .map(c => (c as any).rawContent || (c as any).content)
    .join('\n')
  await navigator.clipboard.writeText(text)
  copiedId.value = message.id
  setTimeout(() => {
    if (copiedId.value === message.id) {
      copiedId.value = null
    }
  }, 1500)
}

defineExpose({ addQuoteData, focusTextarea })
</script>

<style lang="scss" scoped>
.snapshot-chat-panel {
  --style: w-full h-full flex flex-col overflow-hidden;
  background: var(--slax-surface-solid);

  // 标题（对齐 snapshot demo 的 .panel-title + 评论面板 header 规格）
  .chat-title {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    font-family: var(--slax-font-serif);
    font-size: 18px;
    font-weight: 500;
    line-height: 1.4;
    color: var(--slax-text);
    padding: 24px 24px 0;
    margin-bottom: 12px;

    .chat-model-switcher {
      font-family: var(--slax-font-sans);
      font-size: 12px;
      font-weight: 400;
      opacity: 0.45;
      transition: opacity 0.15s;

      &:hover {
        opacity: 0.75;
      }
    }
  }

  .chat-messages {
    --style: flex-1 w-full overflow-y-auto;
    display: flex;
    flex-direction: column;
    gap: 20px;
    // 对齐 snapshot demo：左右 24px，顶 4px，底 16px（给内容留呼吸空间，不贴 composer）
    padding: 4px 24px 16px;
    overscroll-behavior: contain;
    scrollbar-width: none;
    &::-webkit-scrollbar {
      display: none;
    }

    // 顶部边缘淡出：仅在离开顶部后启用（.scrolled），
    // 滚到最顶时无 mask，不会淡化最上方消息；向下滚动时上沿渐隐与背景融合
    &.scrolled {
      mask-image: linear-gradient(to bottom, transparent 0, #000 16px, #000 100%);
      -webkit-mask-image: linear-gradient(to bottom, transparent 0, #000 16px, #000 100%);
    }
  }

  // 空态：引导内容整体居中
  .chat-empty {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    padding: 24px 8px 68px;
    color: var(--slax-text-light);

    .chat-empty-icon {
      width: 36px;
      height: 36px;
      margin: 0 auto 12px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: var(--slax-accent-bg);
      color: var(--slax-accent);
    }

    .chat-empty-title {
      font-size: 13px;
      color: var(--slax-text-muted);
      line-height: 1.6;
    }

    .chat-empty-desc {
      font-size: 13px;
      color: var(--slax-text-muted);
      line-height: 1.6;
    }
  }

  // 用户消息
  .chat-msg-user {
    align-self: flex-end;
    max-width: 85%;
    background: color-mix(in srgb, var(--slax-text) 7%, var(--slax-surface));
    font-size: 14px;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    border-radius: 14px 14px 4px 14px;
    padding: 10px 14px;
    color: var(--slax-text);
  }

  // 引用块（用户消息上方）
  .chat-msg-quote {
    flex-shrink: 0;
    align-self: flex-end;
    max-width: 85%;
    border-left: 3px solid var(--slax-accent);
    background: var(--slax-accent-bg);
    font-size: 12px;
    color: var(--slax-text-muted);
    line-height: 1.55;
    padding: 6px 10px 6px 12px;
    margin-bottom: -12px;
    display: -webkit-box;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  // AI 消息
  .chat-msg-ai {
    align-self: flex-start;
    max-width: 100%;
    font-size: 14px;
    line-height: 1.75;
    color: var(--slax-text);
    // 对齐 snapshot demo：换行与断词挂在 .chat-msg-ai 上（文本直接是其内容）
    white-space: pre-wrap;
    word-break: break-word;

    // markdown 渲染容器：v-html 出的是 <p>/<ul>/<h2> 等块级元素，
    // 需覆盖父级的 pre-wrap（否则保留 HTML 源码空白符 + <p> margin = 双重大间距），
    // 并对内部元素做 margin 清零 + 精确段间距 + 列表自绘 bullet（思路对齐 BubbleMessage）
    .chat-msg-ai-text {
      white-space: normal;

      // 清零所有元素默认 margin（code 除外），间距由下面 * + 选择器精确控制
      :deep(:not(code)) {
        margin: 0;
      }

      // 前面有内容时，段落 / 标题 / 列表才加上间距
      :deep(* + p) {
        margin-top: 12px;
      }
      :deep(* + ul),
      :deep(* + ol) {
        margin-top: 10px;
      }
      :deep(* + h1),
      :deep(* + h2),
      :deep(* + h3) {
        margin-top: 18px;
      }
      :deep(* + pre),
      :deep(* + blockquote) {
        margin-top: 12px;
      }

      :deep(h1) {
        font-size: 16px;
        font-weight: 600;
        line-height: 1.4;
      }
      :deep(h2) {
        font-size: 15px;
        font-weight: 600;
        line-height: 1.4;
      }
      :deep(h3),
      :deep(h4),
      :deep(h5) {
        font-size: 14px;
        font-weight: 600;
        line-height: 1.4;
      }

      // 列表：去掉默认 marker（黑点会溢出容器），自绘 bullet 在 li padding 区内
      :deep(ul),
      :deep(ol) {
        list-style: none;
        padding-left: 0;
      }
      :deep(li) {
        position: relative;
        padding-left: 18px;
        line-height: 1.6;
      }
      :deep(li + li) {
        margin-top: 6px;
      }
      :deep(li::marker) {
        content: none;
      }
      // 无序列表：accent 系小圆点
      :deep(ul > li::before) {
        content: '';
        position: absolute;
        left: 4px;
        top: 0.6em;
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: var(--slax-text-light);
      }
      // 有序列表：序号
      :deep(ol) {
        counter-reset: chat-ol;
      }
      :deep(ol > li) {
        counter-increment: chat-ol;
      }
      :deep(ol > li::before) {
        content: counter(chat-ol) '.';
        position: absolute;
        left: 0;
        top: 0;
        color: var(--slax-text-light);
      }

      :deep(blockquote) {
        padding-left: 12px;
        border-left: 2px solid var(--slax-accent-soft);
        color: var(--slax-text-muted);
      }

      :deep(pre) {
        background: color-mix(in srgb, var(--slax-text) 6%, transparent);
        border-radius: 6px;
        padding: 10px 12px;
        overflow-x: auto;
        font-size: 13px;
      }
      :deep(code) {
        font-family: var(--slax-font-mono);
      }

      // 日夜强调色，E-ink 蓝 + ↗︎
      :deep(a) {
        color: var(--slax-link);

        &::after {
          content: var(--slax-link-suffix, '');
        }
      }

      :deep(img) {
        max-width: 100%;
        border-radius: 6px;
      }

      // 表格对齐 /b/[id] 详情页
      :deep(table) {
        display: block;
        max-width: 100%;
        margin: 12px 0;
        overflow-x: auto;
        border-collapse: separate; // 圆角才生效
        border-spacing: 0;
        border: 1px solid var(--slax-border);
        border-radius: var(--slax-radius-sm);
        background: var(--slax-surface-solid);
        box-shadow: var(--slax-shadow-sm);
        font-size: 13px;
        line-height: 1.6;
      }
      // 只画下/右内线，避免双线
      :deep(th),
      :deep(td) {
        padding: 8px 12px;
        text-align: left;
        border-bottom: 1px solid var(--slax-border);
        border-right: 1px solid var(--slax-border);
        color: var(--slax-text-muted);
        vertical-align: top;
        font-variant-numeric: tabular-nums; // 数字等宽
      }
      :deep(th:last-child),
      :deep(td:last-child) {
        border-right: none;
      }
      :deep(tr:last-child td) {
        border-bottom: none;
      }
      // 表头浅底加重
      :deep(th) {
        background: var(--slax-surface);
        border-bottom-width: 2px;
        color: var(--slax-text);
        font-weight: 600;
        letter-spacing: 0.01em;
        white-space: nowrap;
      }
      // 行首列加重作锚点
      :deep(tbody td:first-child) {
        color: var(--slax-text);
        font-weight: 500;
      }
      // 斑马纹：偶数行淡底
      :deep(tbody tr:nth-child(even) td) {
        background: var(--slax-accent-bg);
      }
      // 手动补四角圆角
      :deep(thead tr:first-child th:first-child),
      :deep(tr:first-child td:first-child) {
        border-top-left-radius: var(--slax-radius-sm);
      }
      :deep(thead tr:first-child th:last-child),
      :deep(tr:first-child td:last-child) {
        border-top-right-radius: var(--slax-radius-sm);
      }
      :deep(tr:last-child td:first-child) {
        border-bottom-left-radius: var(--slax-radius-sm);
      }
      :deep(tr:last-child td:last-child) {
        border-bottom-right-radius: var(--slax-radius-sm);
      }
    }

    .chat-msg-ai-tip {
      font-size: 12px;
      color: var(--slax-text-light);
      margin: 4px 0;

      &[data-loading='true']::after {
        content: '...';
      }
    }

    .chat-msg-ai-links,
    .chat-msg-ai-bookmarks {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin: 8px 0;

      a,
      .chat-msg-ai-bookmark {
        font-size: 13px;
        color: var(--slax-accent);
      }
    }

    .chat-msg-ai-caret {
      display: inline-block;
      width: 6px;
      height: 1em;
      background: var(--slax-accent);
      margin-left: 2px;
      vertical-align: -2px;
      border-radius: 1px;
      animation: chatCaretBlink 0.9s steps(2, start) infinite;
    }

    .chat-msg-ai-tools {
      margin-top: 6px;

      .chat-copy-btn {
        position: relative;
        width: 26px;
        height: 26px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 6px;
        color: var(--slax-text-light);
        cursor: pointer;
        transition: all 0.15s;

        &:hover {
          color: var(--slax-accent);
          background: var(--slax-accent-bg);
        }

        .chat-copied-tip {
          position: absolute;
          bottom: 100%;
          left: 50%;
          transform: translateX(-50%);
          margin-bottom: 4px;
          font-size: 11px;
          color: var(--slax-accent);
          // 不透明底（accent-bg 仅 6-8% alpha 会透出下方文字），叠 accent 边框 + 轻阴影
          background: var(--slax-surface-solid);
          border: 1px solid color-mix(in srgb, var(--slax-accent) 30%, transparent);
          box-shadow: 0 2px 8px color-mix(in srgb, var(--slax-text) 10%, transparent);
          padding: 2px 8px;
          border-radius: 4px;
          white-space: nowrap;
          pointer-events: none;
        }
      }
    }
  }

  .chat-loading {
    --style: w-full flex-center py-2;
  }

  // 零高度容器，不占 flex 布局
  .chat-scroll-down-bar {
    flex-shrink: 0;
    position: relative;
    height: 0;
  }

  .chat-scroll-down {
    position: absolute;
    right: 24px;
    bottom: 12px;
    width: 30px;
    height: 30px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 50%;
    cursor: pointer;
    color: var(--slax-text-muted);
    background: var(--slax-surface-solid);
    border: 1px solid var(--slax-border);
    box-shadow: 0 2px 8px color-mix(in srgb, var(--slax-text) 12%, transparent);
    transition: all 0.15s;

    &:hover {
      color: var(--slax-accent);
      border-color: color-mix(in srgb, var(--slax-accent) 35%, transparent);
    }

    // 有新内容小圆点
    &.has-new::after {
      content: '';
      position: absolute;
      top: 1px;
      right: 1px;
      width: 7px;
      height: 7px;
      border-radius: 50%;
      background: var(--slax-accent);
      border: 1.5px solid var(--slax-surface-solid);
    }
  }

  // 输入区（复用 .comment-composer 规范）
  .chat-composer {
    flex-shrink: 0;
    background: var(--slax-bg);
    border-top: 1px solid var(--slax-border);
    // 对齐 snapshot demo：左右 24px
    padding: 14px 24px 24px;
    box-shadow: 0 -8px 16px -8px color-mix(in srgb, var(--slax-accent) 6%, transparent);
    transition:
      border-color 0.15s,
      box-shadow 0.15s;

    &:focus-within {
      border-top-color: color-mix(in srgb, var(--slax-accent) 35%, transparent);
      box-shadow: 0 -8px 16px -8px color-mix(in srgb, var(--slax-accent) 10%, transparent);
    }

    .chat-composer-quote {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      border-left: 3px solid var(--slax-accent);
      background: var(--slax-accent-bg);
      padding: 6px 8px 6px 10px;
      margin-bottom: 10px;
      border-radius: 0 4px 4px 0;

      .chat-composer-quote-text {
        font-size: 12px;
        color: var(--slax-text-muted);
        line-height: 1.55;
        display: -webkit-box;
        -webkit-line-clamp: 2;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .chat-composer-quote-close {
        flex-shrink: 0;
        margin-left: 8px;
        color: var(--slax-text-light);
        cursor: pointer;

        &:hover {
          color: var(--slax-text);
        }
      }
    }

    textarea {
      width: 100%;
      min-height: 40px;
      max-height: 120px;
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

    .chat-composer-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-top: 8px;

      .chat-composer-hint {
        font-size: 11px;
        font-weight: 300;
        color: var(--slax-text-light);
      }

      .chat-send-btn {
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
        color: var(--slax-btn-text, #fff);

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
}

@keyframes chatCaretBlink {
  to {
    opacity: 0;
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
</style>
