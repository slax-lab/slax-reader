// ChatBot.vue 单元测试 — 完整非流式覆盖（38 用例）
// 关键约束（spec 修订 1-3 决议）：
//  - ChatBot/ChatResponseType/ChatParamsType 是 Nuxt auto-import，必须 mockNuxtImport
//  - enum 值全大写 'CONTENT' / 'FUNCTION' / 'STATUS_UPDATE' / 'QUESTIONS' / 'ASK'
//  - capturedCallback 注入 payload key 用大写（data.FUNCTION / data.CONTENT / data.STATUS_UPDATE）
//  - 模板用 $t → 必须 mountWithApp（自动注入 i18n + pinia），不用裸 mount
//  - MockChatBot plain function with prototype（lessons §8）
//  - happy-dom getComputedStyle 必须 spy（isDark / botSize 依赖）

import { nextTick } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { flushPromises } from '@vue/test-utils'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { MockChatBot, capturedCallback, mockBotChat, mockBotDestruct, mockBotInstance, mockAnalyticsLog, mockUseI18n, mockT, mockParseMarkdownText, mockGetUUID } = vi.hoisted(
  () => {
    const captured: { value: any } = { value: null }
    const instance: { value: any } = { value: null }
    const mockBotChat = vi.fn()
    const mockBotDestruct = vi.fn()

    function MockChatBot(this: any, params: any, callback: any) {
      captured.value = callback
      this.params = params
      this.isChatting = false
      this.chat = mockBotChat
      this.destruct = mockBotDestruct
      this.chatStatusUpdateHandler = null
      instance.value = this
    }

    const mockT = vi.fn((key: string, params?: any) => (params ? `${key}__${JSON.stringify(params)}` : key))
    return {
      MockChatBot: MockChatBot as any,
      capturedCallback: captured,
      mockBotChat,
      mockBotDestruct,
      mockBotInstance: instance,
      mockAnalyticsLog: vi.fn(),
      mockUseI18n: vi.fn(() => ({ locale: { value: 'en' }, t: mockT })),
      mockT,
      mockParseMarkdownText: vi.fn((s: string) => s),
      mockGetUUID: vi.fn(() => 'test-uuid')
    }
  }
)

mockNuxtImport('ChatBot', () => MockChatBot)
mockNuxtImport('ChatResponseType', () => ({ CONTENT: 'CONTENT', FUNCTION: 'FUNCTION', STATUS_UPDATE: 'STATUS_UPDATE' }))
mockNuxtImport('ChatParamsType', () => ({ CONTENT: 'CONTENT', QUESTIONS: 'QUESTIONS', ASK: 'ASK' }))
mockNuxtImport('useI18n', () => mockUseI18n)
mockNuxtImport('analyticsLog', () => mockAnalyticsLog)

vi.mock('@commons/utils/parse', () => ({
  parseMarkdownText: mockParseMarkdownText
}))

vi.mock('@commons/utils/random', () => ({
  getUUID: mockGetUUID
}))

import ChatBot from '~~/app/components/Chat/ChatBot.vue'

const baseStubs = {
  BubbleMessage: true,
  QuestionMessage: true,
  TipsMessage: true,
  DotLoading: true
}

const mountChatBot = (props: any = {}) =>
  mountWithApp(ChatBot, {
    props,
    global: { stubs: baseStubs }
  })

describe('ChatBot.vue', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    capturedCallback.value = null
    mockBotInstance.value = null
    // happy-dom getComputedStyle 默认返回空，spy 覆盖
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({
      width: '500px',
      height: '600px',
      opacity: '0.5'
    } as any)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.useRealTimers()
  })

  // === A 类：挂载 + 基础渲染（C1-C4）===
  describe('挂载 + 基础渲染', () => {
    it('C1: 默认 mount 不抛错，渲染 .chat-bot 容器', () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      expect(wrapper.find('.chat-bot').exists()).toBe(true)
    })

    it('C2: 默认 closeButtonHidden=false → close 按钮渲染', () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      expect(wrapper.find('button.close').exists()).toBe(true)
    })

    it('C3: closeButtonHidden=true → close 按钮不渲染', () => {
      const wrapper = mountChatBot({ bookmarkId: 1, closeButtonHidden: true })
      expect(wrapper.find('button.close').exists()).toBe(false)
    })

    it('C4: close button click → emit dismiss', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      await wrapper.find('button.close').trigger('click')
      expect(wrapper.emitted('dismiss')).toBeTruthy()
    })
  })

  // === B 类：botParams 4 路径（C5-C8）===
  describe('botParams 4 路径', () => {
    it('C5: props.bookmarkId=123 → ChatBot 构造收到 { bookmarkId: 123 }', () => {
      mountChatBot({ bookmarkId: 123 })
      expect(mockBotInstance.value.params).toEqual({ bookmarkId: 123 })
    })

    it('C6: props.shareCode 优先级（无 bookmarkId）→ { shareCode }', () => {
      mountChatBot({ shareCode: 'share-abc' })
      expect(mockBotInstance.value.params).toEqual({ shareCode: 'share-abc' })
    })

    it('C7: props.collection（无 bookmarkId / shareCode）→ { collection }', () => {
      mountChatBot({ collection: { code: 'c-1', cbId: 5 } })
      expect(mockBotInstance.value.params).toEqual({ collection: { code: 'c-1', cbId: 5 } })
    })

    it('C8: 都不传 → 兜底 { bookmarkId: 0 }', () => {
      mountChatBot()
      expect(mockBotInstance.value.params).toEqual({ bookmarkId: 0 })
    })
  })

  // === watch isAppeared 4 路径（C9 参数化）===
  describe('watch isAppeared', () => {
    it('C9a: 初始 isAppeared=true → addLog("open")', () => {
      mountChatBot({ bookmarkId: 1, isAppeared: true })
      expect(mockAnalyticsLog).toHaveBeenCalledWith(expect.objectContaining({ event: 'bookmark_chat_interact', sub_action: 'open' }))
    })

    it('C9b: isAppeared=true → false → addLog("collapse")', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1, isAppeared: true })
      mockAnalyticsLog.mockClear()
      await wrapper.setProps({ isAppeared: false })
      expect(mockAnalyticsLog).toHaveBeenCalledWith(expect.objectContaining({ sub_action: 'collapse' }))
    })

    it('C9c: 初始 isAppeared=false → 不调 addLog', () => {
      mountChatBot({ bookmarkId: 1, isAppeared: false })
      expect(mockAnalyticsLog).not.toHaveBeenCalled()
    })
  })

  // === C 类：callback FUNCTION 子分支（C10-C15）===
  describe('callback FUNCTION', () => {
    it('C10: generateQuestion + args → push tips + question 消息', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'FUNCTION',
        data: { FUNCTION: { name: 'generateQuestion', args: ['Q1', 'Q2'] } }
      })
      await nextTick()
      const questions = wrapper.findAllComponents({ name: 'QuestionMessage' })
      expect(questions.length).toBeGreaterThanOrEqual(2)
    })

    it('C11: generateQuestion 已有 question 时不再 push tips', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      // 先 push 一次 question
      capturedCallback.value({
        type: 'FUNCTION',
        data: { FUNCTION: { name: 'generateQuestion', args: ['Q1'] } }
      })
      await nextTick()
      const tipsCount1 = wrapper.findAllComponents({ name: 'TipsMessage' }).length
      // 再 push 一次
      capturedCallback.value({
        type: 'FUNCTION',
        data: { FUNCTION: { name: 'generateQuestion', args: ['Q2'] } }
      })
      await nextTick()
      const tipsCount2 = wrapper.findAllComponents({ name: 'TipsMessage' }).length
      expect(tipsCount2).toBe(tipsCount1) // 没增加
    })

    it('C12: relatedQuestion → pushBuffer related-question（bufferMessage 渲染）', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'FUNCTION',
        data: { FUNCTION: { name: 'relatedQuestion', args: 'Q?' } }
      })
      await nextTick()
      // bufferMessage 渲染（BubbleMessage 子组件）
      expect(wrapper.findAllComponents({ name: 'BubbleMessage' }).length).toBeGreaterThan(0)
    })

    it('C13: search → pushBuffer links', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'FUNCTION',
        data: { FUNCTION: { name: 'search', args: [{ url: 'u', title: 't', content: 'c', icon: 'i' }] } }
      })
      await nextTick()
      expect(wrapper.findAllComponents({ name: 'BubbleMessage' }).length).toBeGreaterThan(0)
    })

    it('C14: searchBookmark + 数组 args → pushBuffer bookmarks', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'FUNCTION',
        data: {
          FUNCTION: {
            name: 'searchBookmark',
            args: [{ bookmark_id: 1, highlight_title: 'T', highlight_content: 'C' }]
          }
        }
      })
      await nextTick()
      expect(wrapper.findAllComponents({ name: 'BubbleMessage' }).length).toBeGreaterThan(0)
    })

    it('C15: FUNCTION + !data[type] → 早退（不抛错）', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      expect(() =>
        capturedCallback.value({
          type: 'FUNCTION',
          data: {} // 无 FUNCTION 字段
        })
      ).not.toThrow()
      await nextTick()
    })
  })

  // === D 类：callback CONTENT（C16）===
  describe('callback CONTENT', () => {
    it('C16: CONTENT + hello → pushBuffer text → bufferMessage 渲染', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'CONTENT',
        data: { CONTENT: 'hello world' }
      })
      await nextTick()
      expect(wrapper.findAllComponents({ name: 'BubbleMessage' }).length).toBeGreaterThan(0)
    })
  })

  // === E 类：callback STATUS_UPDATE 子分支（C17-C23）===
  describe('callback STATUS_UPDATE', () => {
    it('C17: processing + generateQuestion → pushBuffer tips', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'STATUS_UPDATE',
        data: { STATUS_UPDATE: { name: 'generateQuestion', tips: '', status: 'processing' } }
      })
      await nextTick()
      expect(wrapper.findAllComponents({ name: 'BubbleMessage' }).length).toBeGreaterThan(0)
    })

    it('C18: processing + browser → pushBuffer tips（含 i18n key）', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'STATUS_UPDATE',
        data: { STATUS_UPDATE: { name: 'browser', tips: 'http://x', status: 'processing' } }
      })
      await nextTick()
      expect(wrapper.findAllComponents({ name: 'BubbleMessage' }).length).toBeGreaterThan(0)
    })

    it('C19: processing + search/searchBookmark → pushBuffer tips', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'STATUS_UPDATE',
        data: { STATUS_UPDATE: { name: 'search', tips: 'q', status: 'processing' } }
      })
      await nextTick()
      capturedCallback.value({
        type: 'STATUS_UPDATE',
        data: { STATUS_UPDATE: { name: 'searchBookmark', tips: 'q', status: 'processing' } }
      })
      await nextTick()
      expect(wrapper.findAllComponents({ name: 'BubbleMessage' }).length).toBeGreaterThan(0)
    })

    it('C20: finished + browser/search/searchBookmark/其他 → discardSearch（无错）', () => {
      mountChatBot({ bookmarkId: 1 })
      // browser 通过 processing 注入后 finished
      capturedCallback.value({
        type: 'STATUS_UPDATE',
        data: { STATUS_UPDATE: { name: 'browser', tips: 'now', status: 'processing' } }
      })
      expect(() =>
        capturedCallback.value({
          type: 'STATUS_UPDATE',
          data: { STATUS_UPDATE: { name: 'browser', tips: '', status: 'finished' } }
        })
      ).not.toThrow()
      // 其他 name 走 discardSearch
      expect(() =>
        capturedCallback.value({
          type: 'STATUS_UPDATE',
          data: { STATUS_UPDATE: { name: 'unknownTool', tips: '', status: 'finished' } }
        })
      ).not.toThrow()
    })

    it('C21: failed + browser/search/searchBookmark → updateTipsXxxStatus(false)（无错）', () => {
      mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'STATUS_UPDATE',
        data: { STATUS_UPDATE: { name: 'browser', tips: 'now', status: 'processing' } }
      })
      expect(() =>
        capturedCallback.value({
          type: 'STATUS_UPDATE',
          data: { STATUS_UPDATE: { name: 'browser', tips: '', status: 'failed' } }
        })
      ).not.toThrow()
    })

    it('C22: failed + name=error → messageList push tips error', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'STATUS_UPDATE',
        data: { STATUS_UPDATE: { name: 'error', tips: 'oops', status: 'failed' } }
      })
      await nextTick()
      expect(wrapper.findAllComponents({ name: 'TipsMessage' }).length).toBeGreaterThan(0)
    })

    it('C23: STATUS_UPDATE + !data[type] → 早退', () => {
      mountChatBot({ bookmarkId: 1 })
      expect(() =>
        capturedCallback.value({
          type: 'STATUS_UPDATE',
          data: {}
        })
      ).not.toThrow()
    })
  })

  // === F 类：chatStatusUpdateHandler（C24-C25）===
  describe('chatStatusUpdateHandler', () => {
    it('C24: chatStatusUpdateHandler(true) → isChatting=true，DotLoading 渲染', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      mockBotInstance.value.chatStatusUpdateHandler!(true)
      await nextTick()
      expect(wrapper.findComponent({ name: 'DotLoading' }).exists()).toBe(true)
    })

    it('C25: chatStatusUpdateHandler(false) + bufferMessage 存在 → bufferToMessage 调用', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      // 先注入 buffer
      capturedCallback.value({
        type: 'CONTENT',
        data: { CONTENT: 'buffered text' }
      })
      await nextTick()
      mockBotInstance.value.chatStatusUpdateHandler!(false)
      await nextTick()
      // bufferToMessage 后 messageList 含一条 bubble，bufferMessage 清空
      expect(wrapper.findAllComponents({ name: 'BubbleMessage' }).length).toBeGreaterThan(0)
    })
  })

  // === G 类：用户交互（C26-C31）===
  describe('用户交互', () => {
    it('C26: textarea 输入 → sendable=true（send button 不含 disabled）', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      const textarea = wrapper.find('textarea')
      await textarea.setValue('hello')
      await nextTick()
      // send button 是 .input-container button
      const sendBtn = wrapper.find('.input-container button')
      expect(sendBtn.classes()).not.toContain('disabled')
    })

    it('C27: textarea 空白 → sendable=false（disabled class）', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      const textarea = wrapper.find('textarea')
      await textarea.setValue('   ')
      await nextTick()
      const sendBtn = wrapper.find('.input-container button')
      expect(sendBtn.classes()).toContain('disabled')
    })

    it('C28: showQuoteImage：quoteInfo 含 image → quote img 渲染', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      ;(wrapper.vm as any).addQuoteData({ data: [{ type: 'image', content: 'img-src' }] })
      await nextTick()
      expect(wrapper.find('.quote-container').exists()).toBe(true)
      expect(wrapper.find('.quote .img').exists()).toBe(true)
    })

    it('C29: send button click + sendable=false → shakeTextarea（textarea 加 shake class）', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      // 不输入，sendable=false
      const sendBtn = wrapper.find('.input-container button')
      await sendBtn.trigger('click')
      await nextTick()
      const textarea = wrapper.find('textarea')
      expect(textarea.classes()).toContain('shake')
    })

    it('C30: 输入 + send button click → sendMessage：bot.chat 调 + inputText 清空', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      const textarea = wrapper.find('textarea')
      await textarea.setValue('hello world')
      await nextTick()
      const sendBtn = wrapper.find('.input-container button')
      await sendBtn.trigger('click')
      await nextTick()
      expect(mockBotChat).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CONTENT',
          content: 'hello world'
        })
      )
      expect((textarea.element as HTMLTextAreaElement).value).toBe('')
    })

    it('C31: composition 中 + Enter → 不触发 sendMessage', async () => {
      // attachTo: v-ime-guard 靠 document 捕获阶段拦截 Enter，元素必须真实挂在 document 树上才生效
      const wrapper = mountWithApp(ChatBot, { props: { bookmarkId: 1 }, global: { stubs: baseStubs }, attachTo: document.body })
      const textarea = wrapper.find('textarea')
      await textarea.setValue('hi')
      await textarea.trigger('compositionstart')
      await textarea.trigger('keydown', { key: 'Enter' })
      await nextTick()
      // compositionAppear=true → onKeyDown 早退
      expect(mockBotChat).not.toHaveBeenCalled()
    })
  })

  // === H 类：emit 事件（C32-C35）===
  describe('emit 事件', () => {
    it('C32: questionClick 触发 → 该 question 后续 questions 被过滤 + bot.chat ASK', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'FUNCTION',
        data: { FUNCTION: { name: 'generateQuestion', args: ['Q1', 'Q2'] } }
      })
      await nextTick()
      const firstQuestion = wrapper.findComponent({ name: 'QuestionMessage' })
      // findComponent 返回 stub，emit 触发
      const messageProp = (firstQuestion.props() as any).question
      await firstQuestion.vm.$emit('question-click', { ...messageProp, rawContent: 'Q1' })
      await nextTick()
      expect(mockBotChat).toHaveBeenCalledWith(expect.objectContaining({ type: 'ASK', questions: 'Q1' }))
    })

    it('C33: questionClick 但 rawContent 缺失 → 不调 bot.chat', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'FUNCTION',
        data: { FUNCTION: { name: 'generateQuestion', args: ['Q1'] } }
      })
      await nextTick()
      const q = wrapper.findComponent({ name: 'QuestionMessage' })
      await q.vm.$emit('question-click', { type: 'question', text: 'Q1', clickable: true, id: 'x' }) // 无 rawContent
      await nextTick()
      expect(mockBotChat).not.toHaveBeenCalled()
    })

    it('C34: BubbleMessage emit quote-click → 组件 emit findQuote', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'CONTENT',
        data: { CONTENT: 'msg' }
      })
      // 触发 bufferToMessage，让 BubbleMessage 进入 messageList（line 22 才挂 @quote-click）
      mockBotInstance.value.chatStatusUpdateHandler!(false)
      await nextTick()
      const bubble = wrapper.findComponent({ name: 'BubbleMessage' })
      const quoteData = { data: [{ type: 'text', content: 'q' }] }
      await bubble.vm.$emit('quote-click', quoteData)
      await nextTick()
      expect(wrapper.emitted('findQuote')).toBeTruthy()
      expect(wrapper.emitted('findQuote')![0]).toEqual([quoteData])
    })

    it('C35: BubbleMessage emit question-click（relatedQuestionClick）→ messageList replace + bot.chat ASK', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'CONTENT',
        data: { CONTENT: 'msg' }
      })
      // chatStatusUpdateHandler false 让 buffer 进 messageList
      mockBotInstance.value.chatStatusUpdateHandler!(false)
      await nextTick()
      const bubble = wrapper.findComponent({ name: 'BubbleMessage' })
      const message = (bubble.props() as any).message
      await bubble.vm.$emit('question-click', message, { content: 'related-q', rawContent: 'related-q' })
      await nextTick()
      expect(mockBotChat).toHaveBeenCalledWith(expect.objectContaining({ type: 'ASK', questions: 'related-q' }))
    })
  })

  // === I 类：expose 直调 + closeQuote button（C36-C38）===
  describe('expose 直调', () => {
    it('C36: addQuoteData(data) → quote-container 渲染', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      ;(wrapper.vm as any).addQuoteData({ data: [{ type: 'text', content: 'quoted' }] })
      await nextTick()
      expect(wrapper.find('.quote-container').exists()).toBe(true)
    })

    it('C37: addQuoteData 后 click .quote-container button → closeQuote → quote-container 消失', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      ;(wrapper.vm as any).addQuoteData({ data: [{ type: 'text', content: 'quoted' }] })
      await nextTick()
      expect(wrapper.find('.quote-container').exists()).toBe(true)
      // .quote-container 内的 close button
      await wrapper.find('.quote-container button').trigger('click')
      await nextTick()
      expect(wrapper.find('.quote-container').exists()).toBe(false)
    })

    it('C38: focusTextarea → textarea blur+focus（fake timer 50ms）', async () => {
      vi.useFakeTimers()
      const wrapper = mountChatBot({ bookmarkId: 1 })
      const textarea = wrapper.find('textarea').element as HTMLTextAreaElement
      const focusSpy = vi.spyOn(textarea, 'focus')
      const blurSpy = vi.spyOn(textarea, 'blur')
      ;(wrapper.vm as any).focusTextarea()
      await nextTick()
      expect(blurSpy).toHaveBeenCalled()
      vi.advanceTimersByTime(60)
      expect(focusSpy).toHaveBeenCalled()
    })
  })

  // === 补测覆盖率（C39-C46）===
  describe('补测覆盖率（暗色 / unmount / search/searchBookmark finished/failed / botSize / focus blur / sendMessage history）', () => {
    it('C39: isDark=true（opacity=1）→ getComputedStyle 调用，覆盖 isDark 真路径分支', async () => {
      // override getComputedStyle 让 opacity='1'
      const styleSpy = vi.spyOn(window, 'getComputedStyle').mockReturnValue({ width: '500px', height: '600px', opacity: '1' } as any)
      const wrapper = mountChatBot({ bookmarkId: 1 })
      await nextTick()
      // 触发 isDark()：通过 close button click（点击触发模板重渲染，会重新求值 v-if="!isDark()"）
      // 也可以触发 callback 让 messageList 重渲染
      capturedCallback.value({
        type: 'FUNCTION',
        data: { FUNCTION: { name: 'generateQuestion', args: ['Q'] } }
      })
      await nextTick()
      // 至少 isDark 函数已被调过（getComputedStyle 被读取过）
      expect(styleSpy).toHaveBeenCalled()
    })

    it('C40: onUnmounted → bot.destruct 调用', () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      wrapper.unmount()
      expect(mockBotDestruct).toHaveBeenCalled()
    })

    it('C41: STATUS_UPDATE search finished → updateTipsSearchStatus(true) 不抛错', () => {
      mountChatBot({ bookmarkId: 1 })
      // 先 processing 注入 search tips
      capturedCallback.value({
        type: 'STATUS_UPDATE',
        data: { STATUS_UPDATE: { name: 'search', tips: 'q', status: 'processing' } }
      })
      // 再 finished
      expect(() =>
        capturedCallback.value({
          type: 'STATUS_UPDATE',
          data: { STATUS_UPDATE: { name: 'search', tips: 'q', status: 'finished' } }
        })
      ).not.toThrow()
    })

    it('C42: STATUS_UPDATE searchBookmark finished → updateTipsSearchBookmarkStatus 不抛错', () => {
      mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'STATUS_UPDATE',
        data: { STATUS_UPDATE: { name: 'searchBookmark', tips: 'q', status: 'processing' } }
      })
      expect(() =>
        capturedCallback.value({
          type: 'STATUS_UPDATE',
          data: { STATUS_UPDATE: { name: 'searchBookmark', tips: 'q', status: 'finished' } }
        })
      ).not.toThrow()
    })

    it('C43: STATUS_UPDATE search failed → updateTipsSearchStatus(false) 不抛错', () => {
      mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'STATUS_UPDATE',
        data: { STATUS_UPDATE: { name: 'search', tips: 'q', status: 'processing' } }
      })
      expect(() =>
        capturedCallback.value({
          type: 'STATUS_UPDATE',
          data: { STATUS_UPDATE: { name: 'search', tips: 'q', status: 'failed' } }
        })
      ).not.toThrow()
    })

    it('C44: STATUS_UPDATE searchBookmark failed → updateTipsSearchBookmarkStatus 不抛错', () => {
      mountChatBot({ bookmarkId: 1 })
      capturedCallback.value({
        type: 'STATUS_UPDATE',
        data: { STATUS_UPDATE: { name: 'searchBookmark', tips: 'q', status: 'processing' } }
      })
      expect(() =>
        capturedCallback.value({
          type: 'STATUS_UPDATE',
          data: { STATUS_UPDATE: { name: 'searchBookmark', tips: 'q', status: 'failed' } }
        })
      ).not.toThrow()
    })

    it('C45: botSize 暴露（chat ref 存在）→ 返 { width, height }', () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      const size = (wrapper.vm as any).botSize()
      // getComputedStyle mock 返 width=500px,height=600px
      expect(size).toEqual({ width: 500, height: 600 })
    })

    it('C46: textarea focus/blur → isFocus 切换 .textarea-wrapper.focus class', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      const textarea = wrapper.find('textarea')
      await textarea.trigger('focus')
      await nextTick()
      expect(wrapper.find('.textarea-wrapper').classes()).toContain('focus')
      await textarea.trigger('blur')
      await nextTick()
      expect(wrapper.find('.textarea-wrapper').classes()).not.toContain('focus')
    })

    it('C47: sendMessage 在已有 messages 时拼 history（filter+map+slice 路径）', async () => {
      const wrapper = mountChatBot({ bookmarkId: 1 })
      // 先 push 多条 bubble 进 messageList（通过 callback CONTENT + chatStatusUpdateHandler false）
      for (let i = 0; i < 6; i++) {
        capturedCallback.value({
          type: 'CONTENT',
          data: { CONTENT: `msg ${i}` }
        })
        mockBotInstance.value.chatStatusUpdateHandler!(false)
      }
      await nextTick()
      // 再 sendMessage 触发 getHistoryMessages
      const textarea = wrapper.find('textarea')
      await textarea.setValue('new msg')
      await nextTick()
      await wrapper.find('.input-container button').trigger('click')
      await nextTick()
      expect(mockBotChat).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'CONTENT',
          history: expect.any(Array)
        })
      )
    })
  })
})
