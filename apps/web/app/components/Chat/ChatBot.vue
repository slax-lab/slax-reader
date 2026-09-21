<template>
  <div class="chat-bot" ref="chat">
    <div class="dark-trigger" ref="darkTrigger" />
    <div class="chat-panel-title">{{ $t('component.chat_bot.panel_title') }}</div>
    <button v-if="!closeButtonHidden" class="close" @click="closeModal">
      <img v-if="!isDark()" src="@images/button-dialog-close.png" />
      <img v-else src="@images/button-dialog-close-dark.png" />
    </button>
    <div class="messages-container">
      <div class="messages" ref="messages">
        <!-- 空状态：无消息时显示 -->
        <div v-if="messageList.length === 0 && !isChatting" class="chat-empty">
          <div class="chat-empty-title">{{ $t('component.chat_bot.panel_title') }}</div>
          <div class="chat-empty-desc">{{ $t('component.chat_bot.empty_desc') }}</div>
        </div>
        <div class="message" v-for="message in messageList" :key="message.id">
          <template v-if="message.type === 'question'">
            <QuestionMessage :question="message" @question-click="questionClick" />
          </template>
          <template v-if="message.type === 'bubble'">
            <BubbleMessage :message="message" @question-click="relatedQuestionClick" @quote-click="quoteClick" />
          </template>
          <template v-if="message.type === 'tips'">
            <TipsMessage :tips="message" />
          </template>
        </div>
        <div class="message" v-if="bufferMessage">
          <BubbleMessage :message="bufferMessage" />
        </div>
        <div class="loading" v-if="isChatting">
          <!-- indicate-color 走 DotLoading prop，使用 CSS var 兼容 token 切换 -->
          <DotLoading indicate-color="var(--slax-text-light)" />
        </div>
      </div>
    </div>
    <div class="bottom-container">
      <div class="quote-container" v-if="quoteInfo && quoteInfo.data.length > 0">
        <div class="quote">
          <template v-if="showQuoteImage">
            <i v-if="!isDark()" class="img bg-[url('@images/tiny-image-icon.png')]"></i>
            <i v-else class="img bg-[url('@images/tiny-image-icon.png')]"></i>
          </template>
          <span v-for="(item, index) in quoteInfo.data" :key="index">{{ item.type === 'image' ? '🖼️' : item.content }}</span>
        </div>
        <button v-if="!isDark()" class="bg-[url('@images/button-circle-close.png')]" @click="closeQuote"></button>
        <button v-else class="bg-[url('@images/button-circle-close-dark.png')]" @click="closeQuote"></button>
      </div>
      <div class="input-container">
        <div class="textarea-wrapper" :class="{ focus: isFocus }">
          <textarea
            ref="textarea"
            v-ime-guard
            v-model="inputText"
            v-on-key-stroke:Enter="[onKeyDown, { eventName: 'keydown' }]"
            :placeholder="textareaPlaceholder"
            @focus="isFocus = true"
            @blur="isFocus = false"
            @input="handleInput"
          ></textarea>
          <button class="chat-send-btn" :class="{ disabled: !sendable }" @click="sendMessage">
            {{ $t('common.operate.send') }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import BubbleMessage from './BubbleMessage.vue'
import QuestionMessage from './QuestionMessage.vue'
import TipsMessage from './TipsMessage.vue'
import DotLoading from '~/components/DotLoading.vue'

import { parseMarkdownText } from '@commons/utils/parse'
import { getUUID } from '@commons/utils/random'
import type { ChatBotParams } from '~/utils/chatbot'

import 'highlight.js/styles/base16/equilibrium-gray-light.css'
import type { BubbleMessageContent, BubbleMessageItem, MessageItem, QuestionMessageItem, QuoteData } from './type'
import { vOnKeyStroke } from '@vueuse/components'

const { t } = useI18n()
const props = defineProps({
  bookmarkId: Number,
  shareCode: String,
  collection: {
    type: Object as PropType<{ code: string; cbId: number }>,
    required: false
  },
  isAppeared: {
    required: false,
    type: Boolean
  },
  closeButtonHidden: {
    required: false,
    type: Boolean
  }
})

const emits = defineEmits(['dismiss', 'findQuote'])

const isFocus = ref(false)

const botParams: ChatBotParams = (() => {
  if (props.bookmarkId) {
    return { bookmarkId: props.bookmarkId }
  } else if (props.shareCode) {
    return { shareCode: props.shareCode }
  } else if (props.collection) {
    return { collection: props.collection }
  } else {
    return { bookmarkId: 0 }
  }
})()

const bot = new ChatBot(botParams, (params: { type: ChatResponseType; data: ChatResponseData }) => {
  // 负责处理chatbot消息的回复
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
        messageList.value.push({
          id: `tips_generate_question`,
          type: 'tips',
          tipsType: 'generateQuestion'
        })
      }

      messageList.value = messageList.value.concat(
        args.map((item: string) => {
          return {
            type: 'question',
            text: getParsedText(item),
            clickable: true,
            id: `question_${item}`,
            isHTML: true,
            rawContent: item
          }
        })
      )

      scrollToBottom()
    } else if (name === 'relatedQuestion' && args) {
      pushBuffer({
        type: 'related-question',
        questions: [
          {
            content: args,
            rawContent: args
          }
        ]
      })
    } else if (name === 'search' && args) {
      pushBuffer({
        type: 'links',
        content: args
      })
    } else if (name === 'searchBookmark' && args) {
      let data = []
      if (typeof args === 'string') {
        try {
          const parsed = JSON.parse(args)
          data = Array.isArray(parsed) ? parsed : parsed.data || []
        } catch (e) {
          return // 解析失败直接返回
        }
      } else if (Array.isArray(args)) {
        data = args
      } else if (args && (args as any).data) {
        data = (args as any).data
      }

      if (data.length > 0) {
        const bookmarks = data.map((item: any) => ({
          title: item.highlight_title?.replace(/<\/?mark>/g, '') || t('component.chat_bot.bookmark_no_title'),
          content: item.highlight_content?.replace(/<\/?mark>/g, '') || t('component.chat_bot.bookmark_no_content'),
          bookmark_id: item.bookmark_id
        }))

        pushBuffer({
          type: 'bookmarks',
          content: bookmarks
        })
      }
    }
  } else if (type === ChatResponseType.CONTENT) {
    pushBuffer({
      type: 'text',
      content: data[type] || ''
    })
  } else if (type === ChatResponseType.STATUS_UPDATE) {
    if (!data[type]) {
      return
    }

    const { name, tips, status } = data[type]
    if (status === 'processing') {
      if (name === 'generateQuestion') {
        pushBuffer({
          type: 'tips',
          tips: t(`component.chat_bot.generating_question`),
          loading: true,
          tipsType: name
        })
      } else if (name === 'browser') {
        pushBuffer({
          type: 'tips',
          tips: tips ? t(`component.chat_bot.{tips}_accessing`, { tips }) : t('component.chat_bot.now_accessing'),
          loading: true,
          tipsType: name
        })
      } else if (name === 'search') {
        pushBuffer({
          type: 'tips',
          tips: t(`component.chat_bot.{tips}_searching`, { tips }),
          loading: true,
          tipsType: name
        })
      } else if (name === 'searchBookmark') {
        pushBuffer({
          type: 'tips',
          tips: t(`component.chat_bot.{tips}_searching_bookmark`, { tips }),
          loading: true,
          tipsType: name
        })
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
        messageList.value = messageList.value.concat([
          {
            id: `tips_error_${data[type].tips}`,
            type: 'tips',
            tipsType: 'error',
            data: data[type].tips
          }
        ])
      }
    }
  }
})

bot.chatStatusUpdateHandler = (chatting: boolean) => {
  isChatting.value = chatting

  if (!chatting) {
    const result = bufferToMessage()
    if (result) {
      nextTick(() => {
        scrollToBottom()
      })
    }
  }
}

const isMac = /Mac/i.test(navigator.platform || navigator.userAgent)
const textareaPlaceholder = t(`component.chat_bot.{alias}_placeholder`, { alias: isMac ? 'cmd' : 'ctrl' })
const isInited = ref(false)
const chat = ref<HTMLDivElement>()
const messages = ref<HTMLDivElement>()
const textarea = ref<HTMLTextAreaElement>()
const darkTrigger = ref<HTMLDivElement>()
const inputText = ref('')
const isChatting = ref(false)
const messageList = ref<MessageItem[]>([]) as Ref<MessageItem[]>
const bufferMessage = ref<BubbleMessageItem | null>(null) as Ref<BubbleMessageItem | null>
const bufferMarkdownContent = ref('') // 用于缓存解析中的markdown文字内容
const quoteInfo = ref<QuoteData | null>(null) as Ref<QuoteData | null>
const sendable = computed(() => {
  return inputText.value.trim().length > 0 && !isChatting.value
})

const showQuoteImage = computed(() => {
  return quoteInfo.value && quoteInfo.value.data.length > 0 && !!quoteInfo.value.data.find(item => item.type === 'image')
})

const addLog = (subAction: 'open' | 'expand' | 'close' | 'collapse') => {
  if (props.bookmarkId) {
    analyticsLog({
      event: 'bookmark_chat_interact',
      sub_action: subAction,
      entry_point: 'sidebar_entry'
    })
  }
}

watch(
  () => props.isAppeared,
  (value, oldValue) => {
    if (value && !isInited.value && !quoteInfo.value) {
      isInited.value = true
      addLog('open')
    } else if (value) {
      addLog('expand')
    } else if (value !== !!oldValue) {
      addLog('collapse')
    }

    if (value) {
      nextTick(() => {
        focusTextarea()
      })
    }
  },
  {
    flush: 'sync',
    immediate: true
  }
)

onMounted(() => {
  scrollToBottom()
})

onUnmounted(() => {
  bot.destruct()
})

const isDark = () => {
  if (!darkTrigger.value) {
    return false
  }

  const style = window.getComputedStyle(darkTrigger.value)
  return style.opacity === '1'
}

const handleInput = () => {
  if (!textarea.value) {
    return
  }

  textarea.value.style.height = '22px'
  textarea.value.style.height = textarea.value.scrollHeight + 'px'
}

const scrollToBottom = (force?: boolean) => {
  if (!messages.value) {
    return
  }

  const scrollTick = () => {
    nextTick(() => {
      messages.value?.scrollTo({
        top: messages.value.scrollHeight,
        behavior: 'smooth'
      })
    })
  }

  if (force) {
    scrollTick()
    return
  }

  const isNearBottom = messages.value.scrollHeight - messages.value.scrollTop - messages.value.clientHeight < 200
  if (isNearBottom) {
    scrollTick()
  }
}

const sendMessage = () => {
  if (!sendable.value) {
    shakeTextarea()
    return
  }

  const history = getHistoryMessages()
  const text = inputText.value.trim()
  const currentQuote = quoteInfo.value ?? undefined
  messageList.value.push({
    type: 'bubble',
    direction: 'right',
    contents: [
      {
        type: 'text',
        content: text
      }
    ],
    quote: currentQuote,
    id: `bubble_right_${text}`
  })

  bot.chat({
    type: ChatParamsType.CONTENT,
    content: text,
    history,
    quote: currentQuote
  })

  inputText.value = ''
  quoteInfo.value = null
  scrollToBottom()

  nextTick(() => {
    handleInput()
  })
}

const closeModal = () => {
  emits('dismiss')
}

const questionClick = (question: QuestionMessageItem) => {
  if (isChatting.value) {
    return
  }

  question.clickable = false
  const questionsRange: number[] = [] // 存储点击问题的对应问题列，点击问题后需要把该问题端的问题发送给bot，然后清空这一区域的问题（除了点击的那个问题外）
  let inQuestionQueue = false
  let findQuestion = false
  for (let i = 0; i < messageList.value.length; i++) {
    const messageItem = messageList.value[i]!
    if (messageItem.type === 'question') {
      inQuestionQueue = true
    } else {
      inQuestionQueue = false
    }

    if (messageItem === question) {
      findQuestion = true
    }

    if (inQuestionQueue) {
      questionsRange.push(i)
    } else {
      if (findQuestion) {
        // 说明已经找完了对应问题段，可以退出了
        break
      } else {
        // 没有找到，得继续走
        questionsRange.length = 0
      }
    }
  }

  if (!findQuestion) {
    questionsRange.length = 0
  }

  // const questiontText = messageList.value
  //   .filter((item, idx) => item.type === 'question' && questionsRange.includes(idx))
  //   .map(item => (item as QuestionMessageItem).rawContent || '')
  messageList.value = messageList.value.filter((item, idx) => {
    if (item.type === 'question' && item !== question && item.clickable && questionsRange.includes(idx)) {
      return false
    }

    return true
  })

  if (!question.rawContent) return

  bot.chat({
    type: ChatParamsType.ASK,
    questions: question.rawContent
  })
}

const quoteClick = (quote: QuoteData) => {
  emits('findQuote', quote)
}

const relatedQuestionClick = (message: BubbleMessageItem, question: { content: string; rawContent?: string }) => {
  if (isChatting.value) {
    return
  }

  const index = messageList.value.findIndex(item => item === message)
  if (index === -1) {
    console.error('can not find the message')
    return
  }

  messageList.value.splice(index, 1)
  messageList.value.push({
    id: `question_${question.rawContent}`,
    type: 'question',
    text: question.content,
    clickable: false,
    isHTML: true,
    rawContent: question.rawContent
  })

  bot.chat({
    type: ChatParamsType.ASK,
    questions: question.content
  })
}

const onKeyDown = (e: KeyboardEvent) => {
  if (e.key !== 'Enter') {
    return
  }

  // Shift+Enter 交给浏览器原生处理
  if (e.shiftKey) {
    return
  }

  const preLineKey = isMac ? e.metaKey : e.ctrlKey
  if (preLineKey) {
    if (!e.target || !(e.target instanceof HTMLTextAreaElement)) {
      return
    }

    // Ctrl/Cmd+Enter 手动插入换行
    const textareaTarget = e.target as HTMLTextAreaElement
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
    bufferMessage.value = {
      type: 'bubble',
      direction: 'left',
      contents: [],
      isBuffering: true,
      id: `bubble_buffer`
    }
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
      // TODO 优化这里
      bufferMessage.value = {
        type: 'bubble',
        direction: 'left',
        contents: [] as BubbleMessageContent[],
        isBuffering: true,
        id: `bubble_buffer`
      }
    }

    // 上面的bufferToMessage会改变bufferMessage的数据，所以这里需要重新判断
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

  // 有结果的内容后去除搜索相关提示
  const isSearchOrBrowserTips = (item: BubbleMessageContent): boolean => item.type === 'tips' && (item.tipsType === 'search' || item.tipsType === 'browser')
  const shouldKeepContent = (item: BubbleMessageContent): boolean => item.type !== 'tips' || !isSearchOrBrowserTips(item)
  if (content.type !== 'tips' || !isSearchOrBrowserTips(content)) {
    bufferMessage.value.contents = bufferMessage.value.contents?.filter(shouldKeepContent)
  }

  scrollToBottom()
}

const bufferToMessage = () => {
  bufferMarkdownContent.value = ''
  if (bufferMessage.value && (bufferMessage.value.contents || []).length > 0) {
    // 插入buffer消息进消息列表
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
  const reg = new RegExp(`${t('component.chat_bot.searching_token')}\.\.\.$`)
  searchMessage.tips = searchMessage.tips.replace(reg, tipsText)
  searchMessage.loading = false
}

const updateTipsSearchBookmarkStatus = (success: boolean) => {
  const searchMessage = bufferMessage.value?.contents?.find(content => content.type === 'tips' && content.tipsType === 'searchBookmark' && content.loading)
  if (!searchMessage || searchMessage.type !== 'tips') {
    return
  }

  const tipsText = success ? t('component.chat_bot.search_bookmark_complete') : t('component.chat_bot.search_bookmark_failed')
  const reg = new RegExp(`${t('component.chat_bot.search_bookmark_token')}\.\.\.$`)
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
    const reg = new RegExp(`${t('component.chat_bot.accessing_token')}\.\.\.$`)
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

const botSize = () => {
  if (!chat.value) {
    return null
  }

  const style = window.getComputedStyle(chat.value)

  return {
    width: Number(style.width.indexOf('px') !== -1 ? style.width.replace('px', '') : style.width),
    height: Number(style.height.indexOf('px') !== -1 ? style.height.replace('px', '') : style.height)
  }
}

const getHistoryMessages = () => {
  const history = messageList.value
    .filter(data => data.type === 'bubble')
    .map(data => {
      const content =
        data.contents
          ?.filter(content => content.type === 'text')
          .map(content => content.rawContent || content.content)
          .join('\n') || ''
      return {
        role: data.direction === 'left' ? 'assistant' : 'user',
        content
      }
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
  textarea.value.addEventListener(
    'animationend',
    () => {
      textarea.value?.classList.remove('shake')
    },
    { once: true }
  )
}

const getParsedText = (markdownText: string) => {
  return parseMarkdownText(markdownText).replace(/<a/g, '<a target="_blank"') || ''
}

const addQuoteData = (data: QuoteData) => {
  quoteInfo.value = data
  nextTick(() => {
    scrollToBottom(true)
  })
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

const closeQuote = () => {
  quoteInfo.value = null
}

defineExpose({
  botSize,
  addQuoteData,
  focusTextarea
})
</script>

<style lang="scss" scoped>
.chat-bot {
  --style: w-full h-full flex flex-col justify-stretch items-center overflow-hidden rounded-4 bg-surface-solid;

  .dark-trigger {
    --style: 'absolute left-0 top-0 w-0 h-0 opacity-0 dark:opacity-100';
  }

  .chat-panel-title {
    font-family: var(--slax-font-serif);
    font-size: 18px;
    font-weight: 500;
    color: var(--slax-text);
    padding: 24px 24px 0;
    margin-bottom: 0;
    line-height: 1.4;
    flex-shrink: 0;
  }

  .chat-header {
    --style: 'w-full pt-20px px-16px flex justify-between items-center relative h-54px pb-10px dark:(h-70px pb-25px)';

    .chat-title {
      --style: flex items-center select-none;

      img {
        --style: w-24px h-24px object-contain select-none;
      }

      span {
        --style: ml-8px text-(aux txt-light) line-height-18px;
      }
    }

    .close {
      --style: 'w-16px h-16px flex-center hover:(scale-103 opacity-90) active:(scale-105) transition-all duration-normal';
      img {
        --style: w-full select-none;
      }
    }

    &:before,
    &:after {
      // dark 模式专属装饰条（half-transparent white），light 下不显示，保留
      --style: 'content-empty absolute left-16px right-16px h-1px bg-transparent dark:bg-#FFFFFF0F';
    }

    &:before {
      --style: bottom-0;
    }

    &:after {
      --style: bottom-2px;
    }
  }

  .messages-container {
    --style: 'relative flex-1 w-full h-full px-4px overflow-hidden dark:pt-15px';

    &::before,
    &::after {
      --style: z-2 content-empty absolute h-10px w-full left-0 to-transprent from-surface-solid;
    }

    &::before {
      --style: bottom-0 bg-gradient-to-t;
    }

    &::after {
      --style: top-0 bg-gradient-to-b;
    }

    .messages {
      --style: w-full h-full py-10px overflow-auto;

      scrollbar-width: none;
      &::-webkit-scrollbar {
        --style: hidden;
      }

      .message {
        --style: 'not-first:mt-8px flex items-center px-12px';
      }

      .message:has(.bubble-message) + .message:has(.question-message) {
        --style: '!mt-16px';
      }

      .loading {
        --style: w-full flex-center pt-5 pb-3;
      }
    }
  }

  .bottom-container {
    --style: w-full;
    .quote-container {
      --style: px-12px pt-16px pb-8px flex items-center justify-between border-t-(1px solid) border-t-border;

      .quote {
        --style: pl-8px border-l-(2px solid) line-clamp-2 text-meta break-all border-l-border text-txt-muted;

        i.img {
          --style: w-13px h-13px inline-block bg-contain mr-4px translate-y-2px;
        }

        span {
          --style: line-height-21px overflow-hidden;
        }
      }

      button {
        --style: ml-16px shrink-0 w-16px h-16px bg-contain transition-transform duration-normal;
        &:hover {
          --style: scale-105;
        }

        &:active {
          --style: scale-115;
        }
      }
    }

    .input-container {
      flex-shrink: 0;
      border-top: 1px solid var(--slax-border);
      padding: 14px 24px 24px;
      box-shadow: 0 -8px 16px -8px color-mix(in srgb, var(--slax-accent) 6%, transparent);
      background: var(--slax-bg);
      transition:
        border-color 0.15s,
        box-shadow 0.15s;

      &:focus-within {
        border-top-color: color-mix(in srgb, var(--slax-accent) 35%, transparent);
        box-shadow: 0 -8px 16px -8px color-mix(in srgb, var(--slax-accent) 10%, transparent);
      }

      .textarea-wrapper {
        width: 100%;
        position: relative;
        display: flex;
        align-items: flex-end;
        gap: 8px;

        &.focus {
          // focus 状态由外层 input-container:focus-within 处理
        }

        textarea {
          flex: 1;
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

          &::placeholder,
          &::-webkit-input-placeholder {
            color: var(--slax-text-light);
          }
        }

        .chat-send-btn {
          flex-shrink: 0;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 6px 16px;
          border-radius: var(--slax-radius-sm);
          font-size: 13px;
          font-weight: 500;
          font-family: inherit;
          cursor: pointer;
          transition: all 0.15s;
          background: var(--slax-accent);
          color: white;
          min-width: 52px;
          height: 32px;

          &.disabled {
            opacity: 0.4;
            cursor: not-allowed;
          }

          &:not(.disabled):hover {
            transform: translateY(-1px);
            box-shadow: 0 2px 8px color-mix(in srgb, var(--slax-accent) 20%, transparent);
          }
        }
      }
    }

    .chat-empty {
      padding: 24px 24px 0;

      .chat-empty-title {
        font-family: var(--slax-font-serif);
        font-size: 20px;
        font-weight: 500;
        color: var(--slax-text);
        margin-bottom: 8px;
      }

      .chat-empty-desc {
        font-size: 13px;
        color: var(--slax-text-light);
        line-height: 1.6;
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
</style>
