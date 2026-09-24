import { nextTick } from 'vue'

import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { mountWithApp } from '~~/tests/setup/mount'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { MockSnapshotChatBot, capturedCallback, mockBotChat, mockBotDestruct, mockBotInstance, mockUseI18n, mockT, mockAnalyticsLog, mockParseMarkdownText, mockGetUUID, mockHydrateMermaidDiagrams } =
  vi.hoisted(() => {
    const captured: { value: ((p: any) => void) | null } = { value: null }
    const instance: { value: any } = { value: null }
    const mockBotChat = vi.fn()
    const mockBotDestruct = vi.fn()
    const mockT = vi.fn((key: string, params?: any) => (params ? `${key}__${JSON.stringify(params)}` : key))
    function MockSnapshotChatBot(this: any, params: any, callback: (p: any) => void) {
      captured.value = callback
      this.params = params
      this.chat = mockBotChat
      this.destruct = mockBotDestruct
      this.chatStatusUpdateHandler = null
      instance.value = this
    }
    return {
      MockSnapshotChatBot: MockSnapshotChatBot as any,
      capturedCallback: captured,
      mockBotChat,
      mockBotDestruct,
      mockBotInstance: instance,
      mockUseI18n: vi.fn(() => ({ locale: { value: 'en' }, t: mockT })),
      mockT,
      mockAnalyticsLog: vi.fn(),
      mockParseMarkdownText: vi.fn((s: string) => s),
      mockGetUUID: vi.fn(() => 'test-uuid'),
      mockHydrateMermaidDiagrams: vi.fn(() => Promise.resolve())
    }
  })

mockNuxtImport('ChatBot', () => MockSnapshotChatBot)
mockNuxtImport('ChatResponseType', () => ({ CONTENT: 'CONTENT', FUNCTION: 'FUNCTION', STATUS_UPDATE: 'STATUS_UPDATE' }))
mockNuxtImport('ChatParamsType', () => ({ CONTENT: 'CONTENT', QUESTIONS: 'QUESTIONS', ASK: 'ASK' }))
mockNuxtImport('useI18n', () => mockUseI18n)
mockNuxtImport('analyticsLog', () => mockAnalyticsLog)

vi.mock('@commons/frontend-utils/parse', () => ({ parseMarkdownText: mockParseMarkdownText }))
vi.mock('@commons/frontend-utils/mermaid', () => ({ hydrateMermaidDiagrams: mockHydrateMermaidDiagrams }))
vi.mock('@commons/frontend-utils/random', () => ({ getUUID: mockGetUUID }))

import SnapshotChatPanel from '~~/app/components/Snapshot/SnapshotChatPanel.vue'

const mountPanel = (props: any = {}) =>
  mountWithApp(SnapshotChatPanel, {
    props,
    // attachTo: v-ime-guard 靠 document 捕获阶段拦截 Enter，元素必须真实挂在 document 树上才生效
    attachTo: document.body,
    global: { stubs: { QuestionMessage: true, TipsMessage: true, DotLoading: true, MermaidDiagramOverlay: true } }
  })

// 触发 SSE 回调的辅助
const emit = (payload: any) => capturedCallback.value!(payload)
const setChatting = (v: boolean) => mockBotInstance.value.chatStatusUpdateHandler(v)

describe('SnapshotChatPanel.vue', () => {
  beforeEach(() => {
    mockBotChat.mockReset()
    mockBotDestruct.mockReset()
    mockUseI18n.mockReset().mockReturnValue({ locale: { value: 'en' }, t: mockT })
    mockT.mockReset().mockImplementation((key: string, params?: any) => (params ? `${key}__${JSON.stringify(params)}` : key))
    mockAnalyticsLog.mockReset()
    mockParseMarkdownText.mockReset().mockImplementation((s: string) => s)
    capturedCallback.value = null
    mockBotInstance.value = null
    vi.stubGlobal('navigator', { ...navigator, clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } })
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.useRealTimers()
  })

  describe('A. 空态', () => {
    // 建议问题胶囊功能已从组件移除，空态现仅剩图标 + 标题 + 说明文案
    it('A1: 空态渲染星形图标 + 标题 + 说明文案', () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      expect(wrapper.find('.chat-empty-icon').exists()).toBe(true)
      expect(wrapper.find('.chat-empty-title').exists()).toBe(true)
      expect(wrapper.find('.chat-empty-desc').exists()).toBe(true)
    })

    it('A2: textarea 发送 → bot.chat(CONTENT) + 用户气泡出现', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      const textarea = wrapper.find('textarea')
      await textarea.setValue('hello bot')
      await textarea.trigger('keydown', { key: 'Enter' })
      expect(mockBotChat).toHaveBeenCalledWith(expect.objectContaining({ type: 'CONTENT', content: 'hello bot' }))
      await nextTick()
      const user = wrapper.find('.chat-msg-user')
      expect(user.exists()).toBe(true)
      expect(user.text()).toBe('hello bot')
    })

    it('A3: chatting 中发送不重入', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      setChatting(true)
      await nextTick()
      const textarea = wrapper.find('textarea')
      await textarea.setValue('hi')
      await textarea.trigger('keydown', { key: 'Enter' })
      expect(mockBotChat).not.toHaveBeenCalled()
    })

    it('A4: 有消息后空态消失', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      const textarea = wrapper.find('textarea')
      await textarea.setValue('hi')
      await textarea.trigger('keydown', { key: 'Enter' })
      await nextTick()
      expect(wrapper.find('.chat-empty').exists()).toBe(false)
    })
  })

  describe('B. 构造参数路径', () => {
    it('B1: bookmarkId 路径', () => {
      mountPanel({ bookmarkId: 42 })
      expect(mockBotInstance.value.params).toEqual({ bookmarkId: 42 })
    })
    it('B2: shareCode 路径', () => {
      mountPanel({ shareCode: 'abc' })
      expect(mockBotInstance.value.params).toEqual({ shareCode: 'abc' })
    })
    it('B3: collection 路径', () => {
      mountPanel({ collection: { code: 'c1', cbId: 1 } })
      expect(mockBotInstance.value.params).toEqual({ collection: { code: 'c1', cbId: 1 } })
    })
    it('B4: 无参兜底 { bookmarkId: 0 }', () => {
      mountPanel({})
      expect(mockBotInstance.value.params).toEqual({ bookmarkId: 0 })
    })
  })

  describe('C. 引用块', () => {
    const quote = { source: {}, data: [{ type: 'text' as const, content: '引用片段' }] }
    it('C1: addQuoteData 后引用条出现', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      ;(wrapper.vm as any).addQuoteData(quote)
      await nextTick()
      const q = wrapper.find('.chat-composer-quote')
      expect(q.exists()).toBe(true)
      expect(q.text()).toContain('引用片段')
    })
    it('C2: 点击 ✕ 后引用条消失', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      ;(wrapper.vm as any).addQuoteData(quote)
      await nextTick()
      await wrapper.find('.chat-composer-quote-close').trigger('click')
      await nextTick()
      expect(wrapper.find('.chat-composer-quote').exists()).toBe(false)
    })
  })

  describe('D. 输入框与发送', () => {
    it('D1: 空输入时发送按钮 disabled', () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      expect((wrapper.find('.chat-send-btn').element as HTMLButtonElement).disabled).toBe(true)
    })
    it('D2: chatting 时发送按钮 disabled（非空输入）', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      await wrapper.find('textarea').setValue('hello')
      setChatting(true)
      await nextTick()
      expect((wrapper.find('.chat-send-btn').element as HTMLButtonElement).disabled).toBe(true)
    })
    it('D3: Enter 发送 → bot.chat(CONTENT) + 清空 + 用户气泡', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      const ta = wrapper.find('textarea')
      await ta.setValue('test msg')
      await ta.trigger('keydown', { key: 'Enter' })
      expect(mockBotChat).toHaveBeenCalledWith(expect.objectContaining({ type: 'CONTENT', content: 'test msg' }))
      await nextTick()
      expect((ta.element as HTMLTextAreaElement).value === '' || (wrapper.vm as any).inputText === undefined).toBeTruthy()
      expect(wrapper.find('.chat-msg-user').text()).toBe('test msg')
    })
    it('D4: 带引用发送 → quote 进入 bot.chat 且引用清空', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      const quote = { source: {}, data: [{ type: 'text' as const, content: 'q' }] }
      ;(wrapper.vm as any).addQuoteData(quote)
      await nextTick()
      const ta = wrapper.find('textarea')
      await ta.setValue('ask')
      await ta.trigger('keydown', { key: 'Enter' })
      expect(mockBotChat).toHaveBeenCalledWith(expect.objectContaining({ quote }))
      await nextTick()
      expect(wrapper.find('.chat-composer-quote').exists()).toBe(false)
    })
    it('D5: history 最近 5 条截取', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      // seed 6 条已完成 bubble：交替 user / assistant（通过 CONTENT + finish 制造 assistant，通过发送制造 user）
      // 简化：直接操作 vm.messageList（script setup 不暴露则改用交互式构造）
      // 这里用交互方式：发送 3 轮（每轮 user + assistant）
      for (let i = 0; i < 3; i++) {
        const ta = wrapper.find('textarea')
        await ta.setValue(`u${i}`)
        await ta.trigger('keydown', { key: 'Enter' })
        emit({ type: 'CONTENT', data: { CONTENT: `a${i}` } })
        setChatting(false)
        await nextTick()
      }
      mockBotChat.mockClear()
      const ta = wrapper.find('textarea')
      await ta.setValue('newest')
      await ta.trigger('keydown', { key: 'Enter' })
      const arg = mockBotChat.mock.calls.at(-1)![0]
      expect(arg.history.length).toBe(5)
    })
    it('D6: history 少于 5 条不截断', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      const ta = wrapper.find('textarea')
      await ta.setValue('u0')
      await ta.trigger('keydown', { key: 'Enter' })
      emit({ type: 'CONTENT', data: { CONTENT: 'a0' } })
      setChatting(false)
      await nextTick()
      mockBotChat.mockClear()
      await ta.setValue('u1')
      await ta.trigger('keydown', { key: 'Enter' })
      const arg = mockBotChat.mock.calls.at(-1)![0]
      expect(arg.history.length).toBe(2)
    })
  })

  describe('E. Shift+Enter 与 IME', () => {
    it('E1: Shift+Enter 不发送', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      const ta = wrapper.find('textarea')
      await ta.setValue('line')
      await ta.trigger('keydown', { key: 'Enter', shiftKey: true })
      expect(mockBotChat).not.toHaveBeenCalled()
    })
    it('E2: IME 组合输入中 Enter 不发送', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      const ta = wrapper.find('textarea')
      await ta.setValue('中文')
      await ta.trigger('compositionstart')
      await ta.trigger('keydown', { key: 'Enter' })
      expect(mockBotChat).not.toHaveBeenCalled()
    })
    // Shift+Enter 不应移动光标
    // happy-dom 不模拟原生插入换行
    it('E3: Shift+Enter 不手动挪动光标', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      const ta = wrapper.find('textarea')
      const el = ta.element as HTMLTextAreaElement
      await ta.setValue('asdfghjkl')
      el.selectionStart = 3
      el.selectionEnd = 3
      await ta.trigger('keydown', { key: 'Enter', shiftKey: true })
      await nextTick()
      expect(el.selectionStart).toBe(3)
      expect(el.selectionEnd).toBe(3)
      expect(el.value).toBe('asdfghjkl')
    })
  })

  describe('F. SSE 回调 / buffer', () => {
    const seedBuffer = () => {
      setChatting(true)
      emit({ type: 'CONTENT', data: { CONTENT: 'x' } })
    }

    it('F1: CONTENT 建立 buffer → .chat-msg-ai + caret', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      seedBuffer()
      await nextTick()
      expect(wrapper.find('.chat-msg-ai').exists()).toBe(true)
      expect(wrapper.find('.chat-msg-ai-caret').exists()).toBe(true)
    })
    it('F2: chatStatusUpdateHandler(false) → buffer 落盘，caret 消失 tools 出现', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      seedBuffer()
      setChatting(false)
      await nextTick()
      expect(wrapper.find('.chat-msg-ai-caret').exists()).toBe(false)
      expect(wrapper.find('.chat-msg-ai-tools').exists()).toBe(true)
    })
    it('F3: FUNCTION generateQuestion → question 数量增加 + generateQuestion tips', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      seedBuffer()
      await nextTick()
      const before = wrapper.findAllComponents({ name: 'QuestionMessage' }).length
      emit({ type: 'FUNCTION', data: { FUNCTION: { name: 'generateQuestion', args: ['Q1', 'Q2'] } } })
      await nextTick()
      expect(wrapper.findAllComponents({ name: 'QuestionMessage' }).length).toBeGreaterThan(before)
      const tips = wrapper.findAllComponents({ name: 'TipsMessage' })
      expect(tips.some(c => (c.props('tips') as any).tipsType === 'generateQuestion')).toBe(true)
    })
    it('F4: generateQuestion 点击 → ASK 发送', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      seedBuffer()
      emit({ type: 'FUNCTION', data: { FUNCTION: { name: 'generateQuestion', args: ['Q1'] } } })
      setChatting(false)
      await nextTick()
      const q = wrapper.findAllComponents({ name: 'QuestionMessage' }).find(c => (c.props('question') as any)?.rawContent === 'Q1')
      q!.vm.$emit('question-click', q!.props('question') as any)
      expect(mockBotChat).toHaveBeenCalledWith(expect.objectContaining({ type: 'ASK', questions: 'Q1' }))
    })
    it('F5: FUNCTION search → links 节点', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      seedBuffer()
      emit({ type: 'FUNCTION', data: { FUNCTION: { name: 'search', args: [{ url: 'u', title: 't', content: 'c', icon: 'i' }] } } })
      await nextTick()
      expect(wrapper.find('[data-content-type="links"]').exists()).toBe(true)
    })
    it('F6: FUNCTION searchBookmark → bookmarks 节点，文案非 No Title', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      seedBuffer()
      emit({
        type: 'FUNCTION',
        data: { FUNCTION: { name: 'searchBookmark', args: [{ bookmark_id: 1, highlight_title: '<mark>标题</mark>', highlight_content: '<mark>内容</mark>' }] } }
      })
      await nextTick()
      const node = wrapper.find('[data-content-type="bookmarks"]')
      expect(node.exists()).toBe(true)
      expect(node.text()).not.toContain('No Title')
    })
    it('F7: FUNCTION relatedQuestion → question 数量增加', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      seedBuffer()
      await nextTick()
      const before = wrapper.findAllComponents({ name: 'QuestionMessage' }).length
      emit({ type: 'FUNCTION', data: { FUNCTION: { name: 'relatedQuestion', args: '相关问题' } } })
      await nextTick()
      expect(wrapper.findAllComponents({ name: 'QuestionMessage' }).length).toBeGreaterThan(before)
    })
    it('F8: relatedQuestion 点击 → ASK 发送', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      seedBuffer()
      emit({ type: 'FUNCTION', data: { FUNCTION: { name: 'relatedQuestion', args: '相关问题' } } })
      setChatting(false)
      await nextTick()
      const q = wrapper.findAllComponents({ name: 'QuestionMessage' }).find(c => (c.props('question') as any)?.text === '相关问题')
      q!.vm.$emit('question-click', { content: '相关问题', rawContent: '相关问题' })
      expect(mockBotChat).toHaveBeenCalledWith(expect.objectContaining({ type: 'ASK', questions: '相关问题' }))
    })
    it('F9: processing search → loading tips（空 buffer）', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'search', status: 'processing', tips: 'kw' } } })
      await nextTick()
      expect(wrapper.find('[data-tips-type="search"][data-loading="true"]').exists()).toBe(true)
    })
    it('F10: finished search → loading=false 且节点保留', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'search', status: 'processing', tips: 'kw' } } })
      await nextTick()
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'search', status: 'finished', tips: 'kw' } } })
      await nextTick()
      expect(wrapper.find('[data-tips-type="search"]').exists()).toBe(true)
      expect(wrapper.find('[data-tips-type="search"][data-loading="true"]').exists()).toBe(false)
    })
    it('F11: failed search → loading=false', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'search', status: 'processing', tips: 'kw' } } })
      await nextTick()
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'search', status: 'failed', tips: 'kw' } } })
      await nextTick()
      expect(wrapper.find('[data-tips-type="search"][data-loading="true"]').exists()).toBe(false)
    })
    it('F12: processing browser → loading tips', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'browser', status: 'processing', tips: 'site' } } })
      await nextTick()
      expect(wrapper.find('[data-tips-type="browser"][data-loading="true"]').exists()).toBe(true)
    })
    it('F13: finished browser → loading=false 且节点保留', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'browser', status: 'processing', tips: 'site' } } })
      await nextTick()
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'browser', status: 'finished', tips: 'site' } } })
      await nextTick()
      expect(wrapper.find('[data-tips-type="browser"]').exists()).toBe(true)
      expect(wrapper.find('[data-tips-type="browser"][data-loading="true"]').exists()).toBe(false)
    })
    it('F14: failed browser → loading=false', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'browser', status: 'processing', tips: 'site' } } })
      await nextTick()
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'browser', status: 'failed', tips: 'site' } } })
      await nextTick()
      expect(wrapper.find('[data-tips-type="browser"][data-loading="true"]').exists()).toBe(false)
    })
    it('F15: processing searchBookmark → loading tips', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'searchBookmark', status: 'processing', tips: 'kw' } } })
      await nextTick()
      expect(wrapper.find('[data-tips-type="searchBookmark"][data-loading="true"]').exists()).toBe(true)
    })
    it('F16: finished searchBookmark → loading=false 且节点保留', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'searchBookmark', status: 'processing', tips: 'kw' } } })
      await nextTick()
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'searchBookmark', status: 'finished', tips: 'kw' } } })
      await nextTick()
      expect(wrapper.find('[data-tips-type="searchBookmark"]').exists()).toBe(true)
      expect(wrapper.find('[data-tips-type="searchBookmark"][data-loading="true"]').exists()).toBe(false)
    })
    it('F17: failed searchBookmark → loading=false', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'searchBookmark', status: 'processing', tips: 'kw' } } })
      await nextTick()
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'searchBookmark', status: 'failed', tips: 'kw' } } })
      await nextTick()
      expect(wrapper.find('[data-tips-type="searchBookmark"][data-loading="true"]').exists()).toBe(false)
    })
    it('F18: error → TipsMessage tipsType=error 且 data=err msg', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      emit({ type: 'STATUS_UPDATE', data: { STATUS_UPDATE: { name: 'error', status: 'failed', tips: 'err msg' } } })
      await nextTick()
      const tips = wrapper.findAllComponents({ name: 'TipsMessage' })
      expect(tips.some(c => (c.props('tips') as any).tipsType === 'error' && (c.props('tips') as any).data === 'err msg')).toBe(true)
    })
  })

  describe('G. 流式光标与复制按钮', () => {
    it('G1: 流式中显示光标', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      setChatting(true)
      emit({ type: 'CONTENT', data: { CONTENT: 'x' } })
      await nextTick()
      expect(wrapper.find('.chat-msg-ai-caret').exists()).toBe(true)
    })
    it('G2: 流式完成后光标消失', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      setChatting(true)
      emit({ type: 'CONTENT', data: { CONTENT: 'x' } })
      setChatting(false)
      await nextTick()
      expect(wrapper.find('.chat-msg-ai-caret').exists()).toBe(false)
    })
    it('G3: 复制按钮点击 → writeText(内容) + tooltip 出现后消失', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      setChatting(true)
      emit({ type: 'CONTENT', data: { CONTENT: 'hello world' } })
      setChatting(false)
      await nextTick()
      await wrapper.find('.chat-copy-btn').trigger('click')
      expect(navigator.clipboard.writeText as any).toHaveBeenCalledWith('hello world')
      await nextTick()
      expect(wrapper.find('.chat-copied-tip').exists()).toBe(true)
      vi.advanceTimersByTime(1600)
      await nextTick()
      expect(wrapper.find('.chat-copied-tip').exists()).toBe(false)
    })
  })

  describe('H. 暴露接口', () => {
    it('H1: addQuoteData 暴露', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      ;(wrapper.vm as any).addQuoteData({ source: {}, data: [{ type: 'text', content: 'q' }] })
      await nextTick()
      expect(wrapper.find('.chat-composer-quote').exists()).toBe(true)
    })
    it('H2: focusTextarea 暴露 → 延迟后 focus 被调用', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      const ta = wrapper.find('textarea').element as HTMLTextAreaElement
      const focusSpy = vi.spyOn(ta, 'focus')
      ;(wrapper.vm as any).focusTextarea()
      await nextTick()
      vi.advanceTimersByTime(60)
      expect(focusSpy).toHaveBeenCalled()
    })
  })

  describe('I. 卸载清理', () => {
    it('I1: unmount → destruct 调用 + chatStatusUpdateHandler 置 undefined', () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      const inst = mockBotInstance.value
      wrapper.unmount()
      expect(mockBotDestruct).toHaveBeenCalledTimes(1)
      expect(inst.chatStatusUpdateHandler).toBeUndefined()
    })
  })

  describe('J. mermaid 图表', () => {
    const diagramMarkup = '<div class="mermaid-diagram"><svg viewBox="0 0 10 10"><text>d</text></svg></div>'

    const mountWithDiagram = async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      const box = wrapper.find('.chat-messages')
      box.element.insertAdjacentHTML('beforeend', diagramMarkup)
      await nextTick()
      return wrapper
    }

    it('J1: 每次 v-html 更新后对消息容器补跑 hydration', async () => {
      const wrapper = mountPanel({ bookmarkId: 1 })
      mockHydrateMermaidDiagrams.mockClear()
      emit({ type: 'CONTENT', data: { CONTENT: '```mermaid\ngraph TD;\n```' } })
      // one tick for the update frame, one for hydration's own nextTick
      await nextTick()
      await nextTick()
      expect(mockHydrateMermaidDiagrams).toHaveBeenCalledWith(wrapper.find('.chat-messages').element, expect.objectContaining({ errorNoticeText: expect.any(Function) }))
    })

    it('J2: 点击图表 → 打开全览浮层并传入 svg', async () => {
      const wrapper = await mountWithDiagram()
      expect(wrapper.findComponent({ name: 'MermaidDiagramOverlay' }).exists()).toBe(false)
      await wrapper.find('.mermaid-diagram svg').trigger('click')
      const overlay = wrapper.findComponent({ name: 'MermaidDiagramOverlay' })
      expect(overlay.exists()).toBe(true)
      expect(overlay.props('svg')).toContain('<svg')
    })

    it('J3: 浮层 close → 浮层移除', async () => {
      const wrapper = await mountWithDiagram()
      await wrapper.find('.mermaid-diagram svg').trigger('click')
      wrapper.findComponent({ name: 'MermaidDiagramOverlay' }).vm.$emit('close')
      await nextTick()
      expect(wrapper.findComponent({ name: 'MermaidDiagramOverlay' }).exists()).toBe(false)
    })

    it('J4: 点击非图表区域不打开浮层', async () => {
      const wrapper = await mountWithDiagram()
      await wrapper.find('.chat-messages').trigger('click')
      expect(wrapper.findComponent({ name: 'MermaidDiagramOverlay' }).exists()).toBe(false)
    })
  })
})
