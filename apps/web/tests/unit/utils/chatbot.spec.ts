// utils/chatbot.ts ChatBot 测试套件 —— 第二期 sprint 6.2 Task 1
//
// 关键约束（详见 .claude/test-framework/phase2/sprint6.2-chatbot.md）：
// 1. SSEDecoder / LineDecoder 直接用真实实现（spec §3.2）—— 不 vi.mock，
//    真实 decoder 是纯逻辑无外部依赖；stub 偏差易致假阳性。
// 2. partialParse 用 vi.mock 替成可控 vi.fn，默认透传 JSON.parse；
//    Task 1 不直接断言（createMessages 不调），但 mock 已挂好供 Task 2 复用。
// 3. request() 是 Nuxt auto-import → 用 mockNuxtImport('request', ...) 拦截。
//    request().stream 通过 hoisted mockStream 注册 subscriber 到 streamCallbackHolder。
// 4. useNuxtApp().$i18n.t 用 vi.spyOn 局部替换（sprint 2.2 范式）。
//    Task 1 不调 i18n（createMessages 不用），但 spy 已挂方便 Task 2。
// 5. chat() async：调 request().stream 拿到 callback subscribe fn 后立即 resolve。
//    Task 1 范围内不触发流式 chunk，仅断言 mockStream 收到的 body 形状。
// 6. 每个 it 必须重置 hoisted holder + mock 调用记录（codex 第 1 轮 P2 第 5 条修订）：
//    vi.restoreAllMocks 不清独立 vi.fn，需手动 mockReset / 手动清 holder。

import { RequestMethodType } from '@commons/frontend-utils/request'

import { RESTMethodPath } from '@slax-reader/contracts/const'
import { mockNuxtImport } from '@nuxt/test-utils/runtime'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const { mockStream, streamCallbackHolder, partialParseMock } = vi.hoisted(() => {
  const streamCallbackHolder: {
    subscriber: ((text: string, isDone: boolean) => void) | null
    settle: { resolve: () => void; reject: (reason?: unknown) => void } | null
  } = { subscriber: null, settle: null }

  const mockStream = vi.fn(async () => {
    return (subscriber: (text: string, isDone: boolean) => void) => {
      streamCallbackHolder.subscriber = subscriber
      // The real consumer settles only when the stream ends, so a test drives the stream
      // after chat() returns and completes the consumer explicitly.
      return new Promise<void>((resolve, reject) => {
        streamCallbackHolder.settle = { resolve, reject }
      })
    }
  })
  const partialParseMock = vi.fn((s: string) => JSON.parse(s))
  return { mockStream, streamCallbackHolder, partialParseMock }
})

const { mockRequest } = vi.hoisted(() => ({
  mockRequest: vi.fn(() => ({
    stream: mockStream,
    post: vi.fn(),
    get: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    upgrade: vi.fn(),
    uploadFile: vi.fn()
  }))
}))

mockNuxtImport('request', () => mockRequest)

vi.mock('@commons/frontend-utils/json', () => ({ partialParse: partialParseMock }))

// 注意：不 mock @commons/frontend-utils/decoder（spec §3.2 决议直接用真实 LineDecoder + SSEDecoder）

import { ChatBot, ChatParamsType, ChatResponseType } from '~~/app/utils/chatbot'

import type { QuoteData } from '~/components/Chat/type'

beforeEach(() => {
  // hoisted holder + mock 调用记录每个 it 重置
  streamCallbackHolder.subscriber = null
  streamCallbackHolder.settle = null
  mockStream.mockClear()
  mockRequest.mockClear()
  partialParseMock.mockReset().mockImplementation((s: string) => JSON.parse(s))

  // sprint 2.2 范式：useNuxtApp().$i18n.t 局部 spy；afterEach 的 vi.restoreAllMocks 自动还原
  vi.spyOn(useNuxtApp().$i18n, 't').mockImplementation(((key: string) => `__T__${key}`) as never)
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('ChatBot constructor', () => {
  it('bookmarkId 分支 → 仅 bookmarkId 被挂', () => {
    const cb = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, cb)
    expect(bot.bookmarkId).toBe(1)
    expect(bot.shareCode).toBeUndefined()
    expect(bot.collection).toBeUndefined()
    expect(bot.responseCallback).toBe(cb)
  })

  it('shareCode 分支 → 仅 shareCode 被挂', () => {
    const cb = vi.fn()
    const bot = new ChatBot({ shareCode: 'sc-001' }, cb)
    expect(bot.shareCode).toBe('sc-001')
    expect(bot.bookmarkId).toBeUndefined()
    expect(bot.collection).toBeUndefined()
    expect(bot.responseCallback).toBe(cb)
  })

  it('collection 分支 → 仅 collection 被挂（{ code, cbId }）', () => {
    const cb = vi.fn()
    const bot = new ChatBot({ collection: { code: 'col-1', cbId: 42 } }, cb)
    expect(bot.collection).toEqual({ code: 'col-1', cbId: 42 })
    expect(bot.bookmarkId).toBeUndefined()
    expect(bot.shareCode).toBeUndefined()
    expect(bot.responseCallback).toBe(cb)
  })
})

describe('ChatBot chat — createMessages 路径', () => {
  it('CONTENT + bookmarkId + history 拼接 + quote.data 长度=0 → undefined', async () => {
    const cb = vi.fn()
    const bot = new ChatBot({ bookmarkId: 42 }, cb)
    const emptyQuote: QuoteData = { source: {}, data: [] }
    await bot.chat({
      type: ChatParamsType.CONTENT,
      content: '你好',
      history: [{ role: 'user', content: '前一条' }],
      quote: emptyQuote
    })

    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(mockStream).toHaveBeenCalledWith({
      url: RESTMethodPath.BOT_CHAT,
      method: RequestMethodType.post,
      signal: expect.any(AbortSignal),
      body: {
        bm_id: 42,
        share_code: undefined,
        messages: [
          { role: 'user', content: '前一条' },
          { role: 'user', content: '你好' }
        ],
        quote: undefined,
        platform: 'desktop'
      }
    })
  })

  it('CONTENT + shareCode + 无 history → messages 仅含当前 content', async () => {
    const cb = vi.fn()
    const bot = new ChatBot({ shareCode: 'sc-X' }, cb)
    await bot.chat({
      type: ChatParamsType.CONTENT,
      content: 'hi share'
    })

    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(mockStream).toHaveBeenCalledWith({
      url: RESTMethodPath.BOT_CHAT,
      method: RequestMethodType.post,
      signal: expect.any(AbortSignal),
      body: {
        bm_id: undefined,
        share_code: 'sc-X',
        messages: [{ role: 'user', content: 'hi share' }],
        quote: undefined,
        platform: 'desktop'
      }
    })
  })

  it('CONTENT + collection 上下文（透传 collection_code + cb_id）+ quote.data 长度>0 → 透传 quote.data', async () => {
    const cb = vi.fn()
    const bot = new ChatBot({ collection: { code: 'col-A', cbId: 7 } }, cb)
    const quoteWithData: QuoteData = {
      source: { id: 's1' },
      data: [
        { type: 'text', content: '引用片段 1' },
        { type: 'image', content: 'https://example.com/img.png' }
      ]
    }
    await bot.chat({
      type: ChatParamsType.CONTENT,
      content: '基于引用回答',
      quote: quoteWithData
    })

    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(mockStream).toHaveBeenCalledWith({
      url: RESTMethodPath.BOT_CHAT,
      method: RequestMethodType.post,
      signal: expect.any(AbortSignal),
      body: {
        bm_id: undefined,
        share_code: undefined,
        collection_code: 'col-A',
        cb_id: 7,
        messages: [{ role: 'user', content: '基于引用回答' }],
        quote: quoteWithData.data,
        platform: 'desktop'
      }
    })
  })

  it('QUESTIONS + bookmarkId → messages 含 generateQuestion tool_call', async () => {
    const cb = vi.fn()
    const bot = new ChatBot({ bookmarkId: 99 }, cb)
    await bot.chat({ type: ChatParamsType.QUESTIONS })

    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(mockStream).toHaveBeenCalledWith({
      url: RESTMethodPath.BOT_CHAT,
      method: RequestMethodType.post,
      signal: expect.any(AbortSignal),
      body: {
        bm_id: 99,
        share_code: undefined,
        messages: [
          {
            role: 'assistant',
            tool_calls: [{ id: '1', type: 'function', function: { name: 'generateQuestion' } }]
          }
        ]
      }
    })
  })

  it('ASK + shareCode + questions 文本 → messages 含 assistant content', async () => {
    const cb = vi.fn()
    const bot = new ChatBot({ shareCode: 'sc-ask' }, cb)
    await bot.chat({ type: ChatParamsType.ASK, questions: '请问这是什么？' })

    expect(mockStream).toHaveBeenCalledTimes(1)
    expect(mockStream).toHaveBeenCalledWith({
      url: RESTMethodPath.BOT_CHAT,
      method: RequestMethodType.post,
      signal: expect.any(AbortSignal),
      body: {
        bm_id: undefined,
        share_code: 'sc-ask',
        messages: [{ role: 'assistant', content: '请问这是什么？' }]
      }
    })
  })
})

// 工具函数：按真实 SSE 协议构造 chunk（data: <json>\n\n 双换行结束）
// SSEDecoder 收到空行才 emit ServerSentEvent —— 单换行 SSEDecoder 不 emit
const sendChunk = (subscriber: (text: string, isDone: boolean) => void, payload: object) => {
  subscriber(`data: ${JSON.stringify(payload)}\n\n`, false)
}

describe('chat — handleData 流式分支', () => {
  // 用例 1：assistant + content → CONTENT callback
  it('assistant + content → CONTENT callback', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: '你好' })
    const subscriber = streamCallbackHolder.subscriber!
    expect(subscriber).toBeTruthy()

    sendChunk(subscriber, {
      choices: [{ delta: [{ role: 'assistant', content: 'Hello!' }] }]
    })

    expect(callback).toHaveBeenCalledWith({
      type: ChatResponseType.CONTENT,
      data: { [ChatResponseType.CONTENT]: 'Hello!' }
    })
  })

  // 用例 2：tool generateQuestion processing → STATUS_UPDATE
  it('tool generateQuestion processing → STATUS_UPDATE', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    sendChunk(subscriber, {
      choices: [
        {
          delta: [{ role: 'tool', name: 'generateQuestion', content: '["问题1"]' }],
          status: 'processing'
        }
      ]
    })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      type: ChatResponseType.STATUS_UPDATE,
      data: {
        [ChatResponseType.STATUS_UPDATE]: {
          name: 'generateQuestion',
          tips: '__T__util.chatbot.generate_question',
          status: 'processing'
        }
      }
    })
  })

  // 用例 3：tool generateQuestion finished_successfully → STATUS_UPDATE + FUNCTION（2 个 callback）
  it('tool generateQuestion finished_successfully → STATUS_UPDATE + FUNCTION', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    sendChunk(subscriber, {
      choices: [
        {
          delta: [{ role: 'tool', name: 'generateQuestion', content: '["问题1","问题2"]' }],
          status: 'finished_successfully'
        }
      ]
    })

    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenNthCalledWith(1, {
      type: ChatResponseType.STATUS_UPDATE,
      data: {
        [ChatResponseType.STATUS_UPDATE]: {
          name: 'generateQuestion',
          tips: '__T__util.chatbot.generate_question_finished',
          status: 'finished'
        }
      }
    })
    expect(callback).toHaveBeenNthCalledWith(2, {
      type: ChatResponseType.FUNCTION,
      data: {
        [ChatResponseType.FUNCTION]: { name: 'generateQuestion', args: ['问题1', '问题2'] }
      }
    })
  })

  // 用例 4：tool browser processing → STATUS_UPDATE
  it('tool browser processing → STATUS_UPDATE', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    sendChunk(subscriber, {
      choices: [
        {
          delta: [{ role: 'tool', name: 'browser', content: 'https://example.com' }],
          status: 'processing'
        }
      ]
    })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      type: ChatResponseType.STATUS_UPDATE,
      data: {
        [ChatResponseType.STATUS_UPDATE]: {
          name: 'browser',
          tips: 'https://example.com',
          status: 'processing'
        }
      }
    })
  })

  // 用例 5：tool browser finished_successfully → STATUS_UPDATE
  it('tool browser finished_successfully → STATUS_UPDATE', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    sendChunk(subscriber, {
      choices: [
        {
          delta: [{ role: 'tool', name: 'browser', content: '{}' }],
          status: 'finished_successfully'
        }
      ]
    })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      type: ChatResponseType.STATUS_UPDATE,
      data: {
        [ChatResponseType.STATUS_UPDATE]: {
          name: 'browser',
          tips: '__T__util.chatbot.browser_finished',
          status: 'finished'
        }
      }
    })
  })

  // 用例 6：tool browser finished_failed → STATUS_UPDATE
  it('tool browser finished_failed → STATUS_UPDATE', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    sendChunk(subscriber, {
      choices: [
        {
          delta: [{ role: 'tool', name: 'browser', content: '{}' }],
          status: 'finished_failed'
        }
      ]
    })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      type: ChatResponseType.STATUS_UPDATE,
      data: {
        [ChatResponseType.STATUS_UPDATE]: {
          name: 'browser',
          tips: '__T__util.chatbot.browser_finished',
          status: 'failed'
        }
      }
    })
  })

  // 用例 7：tool search processing → STATUS_UPDATE
  it('tool search processing → STATUS_UPDATE', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    sendChunk(subscriber, {
      choices: [
        {
          delta: [{ role: 'tool', name: 'search', content: 'keyword' }],
          status: 'processing'
        }
      ]
    })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      type: ChatResponseType.STATUS_UPDATE,
      data: {
        [ChatResponseType.STATUS_UPDATE]: {
          name: 'search',
          tips: 'keyword',
          status: 'processing'
        }
      }
    })
  })

  // 用例 8：tool search finished_successfully → STATUS_UPDATE + FUNCTION
  it('tool search finished_successfully → STATUS_UPDATE + FUNCTION', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    const searchResults = [{ url: 'https://a.com', title: 'A', content: '内容', icon: 'a.ico' }]
    sendChunk(subscriber, {
      choices: [
        {
          delta: [{ role: 'tool', name: 'search', content: JSON.stringify(searchResults) }],
          status: 'finished_successfully'
        }
      ]
    })

    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenNthCalledWith(1, {
      type: ChatResponseType.STATUS_UPDATE,
      data: {
        [ChatResponseType.STATUS_UPDATE]: {
          name: 'search',
          tips: '__T__util.chatbot.search_finished',
          status: 'finished'
        }
      }
    })
    expect(callback).toHaveBeenNthCalledWith(2, {
      type: ChatResponseType.FUNCTION,
      data: { [ChatResponseType.FUNCTION]: { name: 'search', args: searchResults } }
    })
  })

  // 用例 9：tool search finished_failed → STATUS_UPDATE（codex 第 1 轮 P2 第 3 条修订）
  // 源码 line 230-234：tips 复用 search_finished，status='finished'（与官方设计一致）
  it('tool search finished_failed → STATUS_UPDATE', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    sendChunk(subscriber, {
      choices: [
        {
          delta: [{ role: 'tool', name: 'search', content: '[]' }],
          status: 'finished_failed'
        }
      ]
    })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      type: ChatResponseType.STATUS_UPDATE,
      data: {
        [ChatResponseType.STATUS_UPDATE]: {
          name: 'search',
          tips: '__T__util.chatbot.search_finished',
          status: 'finished'
        }
      }
    })
  })

  // 用例 10：tool relatedQuestion finished_successfully → FUNCTION（不调 partialParse）
  // 源码 line 179：if (args !== null && funcName !== 'relatedQuestion') 才调 partialParse
  it('tool relatedQuestion finished_successfully → FUNCTION（不调 partialParse）', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    sendChunk(subscriber, {
      choices: [
        {
          delta: [{ role: 'tool', name: 'relatedQuestion', content: '"接下来想问什么？"' }],
          status: 'finished_successfully'
        }
      ]
    })

    expect(partialParseMock).not.toHaveBeenCalled()
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      type: ChatResponseType.FUNCTION,
      data: { [ChatResponseType.FUNCTION]: { name: 'relatedQuestion', args: '"接下来想问什么？"' } }
    })
  })

  // 用例 11：tool searchBookmark processing → STATUS_UPDATE
  it('tool searchBookmark processing → STATUS_UPDATE', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    sendChunk(subscriber, {
      choices: [
        {
          delta: [{ role: 'tool', name: 'searchBookmark', content: '关键字' }],
          status: 'processing'
        }
      ]
    })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      type: ChatResponseType.STATUS_UPDATE,
      data: {
        [ChatResponseType.STATUS_UPDATE]: {
          name: 'searchBookmark',
          tips: '关键字',
          status: 'processing'
        }
      }
    })
  })

  // 用例 12：tool searchBookmark finished_successfully → STATUS_UPDATE + FUNCTION
  it('tool searchBookmark finished_successfully → STATUS_UPDATE + FUNCTION', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    sendChunk(subscriber, {
      choices: [
        {
          delta: [{ role: 'tool', name: 'searchBookmark', content: '"BMResult"' }],
          status: 'finished_successfully'
        }
      ]
    })

    expect(callback).toHaveBeenCalledTimes(2)
    expect(callback).toHaveBeenNthCalledWith(1, {
      type: ChatResponseType.STATUS_UPDATE,
      data: {
        [ChatResponseType.STATUS_UPDATE]: {
          name: 'searchBookmark',
          tips: '__T__util.chatbot.search_bookmark_finished',
          status: 'finished'
        }
      }
    })
    // partialParse 默认透传 JSON.parse('"BMResult"') === 'BMResult'
    expect(callback).toHaveBeenNthCalledWith(2, {
      type: ChatResponseType.FUNCTION,
      data: { [ChatResponseType.FUNCTION]: { name: 'searchBookmark', args: 'BMResult' } }
    })
  })

  // 用例 13：tool searchBookmark finished_failed → STATUS_UPDATE
  it('tool searchBookmark finished_failed → STATUS_UPDATE', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    sendChunk(subscriber, {
      choices: [
        {
          delta: [{ role: 'tool', name: 'searchBookmark', content: '""' }],
          status: 'finished_failed'
        }
      ]
    })

    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback).toHaveBeenCalledWith({
      type: ChatResponseType.STATUS_UPDATE,
      data: {
        [ChatResponseType.STATUS_UPDATE]: {
          name: 'searchBookmark',
          tips: '__T__util.chatbot.search_bookmark_failed',
          status: 'failed'
        }
      }
    })
  })
})

describe('chat — 边界 + isChatting + destruct', () => {
  // 用例 1：chat 开始时 isChatting=true，subscriber 触发 done 后 isChatting=false（断言两次状态）
  it('chat 开始 isChatting=true，done 后 isChatting=false', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)

    expect(bot.isChatting).toBe(false)

    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    // chat() 内部调 updateChatStatus(true)
    expect(bot.isChatting).toBe(true)

    const subscriber = streamCallbackHolder.subscriber!
    subscriber('', true)
    // done 路径同步触发 updateChatStatus(false)
    expect(bot.isChatting).toBe(false)
  })

  // 用例 2：chat 期间触发 chatStatusUpdateHandler（设 bot.chatStatusUpdateHandler = vi.fn()，断言被调 true→false）
  it('chat 期间触发 chatStatusUpdateHandler（true→false）', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    const statusHandler = vi.fn()
    bot.chatStatusUpdateHandler = statusHandler

    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    expect(statusHandler).toHaveBeenNthCalledWith(1, true)

    const subscriber = streamCallbackHolder.subscriber!
    subscriber('', true)
    expect(statusHandler).toHaveBeenNthCalledWith(2, false)
    expect(statusHandler).toHaveBeenCalledTimes(2)
  })

  // 用例 3：handleData 收到 Error 实例 → STATUS_UPDATE 'error'
  // 通过 done 路径残留行非 NOT_SUBSCRIPTION 的错误 JSON 触发（走 data.message 默认）
  it('handleData 收到 Error → STATUS_UPDATE error（走默认 data.message）', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    // 残留行（无 \n）+ done 触发 flush；data.data 非 NOT_SUBSCRIPTION → 走 data.message 默认
    const errorJson = JSON.stringify({ data: 'OTHER_ERROR', message: '其它错误', code: 500 })
    subscriber(errorJson, false)
    subscriber('', true)

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ChatResponseType.STATUS_UPDATE,
        data: { [ChatResponseType.STATUS_UPDATE]: { name: 'error', tips: '其它错误', status: 'failed' } }
      })
    )
  })

  // 用例 4：data.choices.length=0 → responseCallback 不被调
  it('data.choices.length=0 → responseCallback 不被调', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    sendChunk(subscriber, { choices: [] })

    expect(callback).not.toHaveBeenCalled()
  })

  // 用例 5：destruct() 后 responseCallback=undefined，后续 chunk 不调 callback
  it('destruct() 后 responseCallback=undefined，后续 chunk 不调 callback', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    bot.destruct()
    expect(bot.responseCallback).toBeUndefined()

    sendChunk(subscriber, {
      choices: [{ delta: [{ role: 'assistant', content: 'X' }] }]
    })

    expect(callback).not.toHaveBeenCalled()
  })

  // 用例 6：done 时 lineDecoder.flush 残留 + 错误 JSON 走 NOT_SUBSCRIPTION 错误映射
  it('done 时 lineDecoder.flush 残留 + 错误 JSON 走 NOT_SUBSCRIPTION 错误映射', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    // 推一段不带 \n 的"残留"文本（buffer 留住）+ done 触发 flush
    const errorJson = JSON.stringify({ data: 'NOT_SUBSCRIPTION', message: '需要订阅', code: 403 })
    subscriber(errorJson, false)
    subscriber('', true)

    expect(callback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ChatResponseType.STATUS_UPDATE,
        data: {
          [ChatResponseType.STATUS_UPDATE]: {
            name: 'error',
            tips: '__T__util.chatbot.error_not_subscription',
            status: 'failed'
          }
        }
      })
    )
  })
})

// 本轮修复：无论流以何种方式结束都必须离开 loading 态，且失败必须对用户可见。
type StatusUpdateParams = { data?: { STATUS_UPDATE?: { name?: string; tips?: string } } }

describe('chat — 终止兜底与失败可见性', () => {
  const flushTasks = () => new Promise(resolve => setTimeout(resolve, 0))

  const errorTipsCalls = (callback: ReturnType<typeof vi.fn>) =>
    callback.mock.calls.filter(([params]) => (params as StatusUpdateParams | undefined)?.data?.STATUS_UPDATE?.name === 'error')

  const errorTips = (callback: ReturnType<typeof vi.fn>) => ((errorTipsCalls(callback)[0]?.[0] as StatusUpdateParams | undefined)?.data?.STATUS_UPDATE?.tips ?? '')

  const settle = (kind: 'resolve' | 'reject', reason?: unknown) => {
    const holder = streamCallbackHolder.settle
    if (!holder) throw new Error('stream consumer was not started')
    if (kind === 'resolve') holder.resolve()
    else holder.reject(reason)
  }

  it('消费者 reject（连接中断）→ loading 复位并提示失败', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)
    const statusHandler = vi.fn()
    bot.chatStatusUpdateHandler = statusHandler

    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    expect(bot.isChatting).toBe(true)

    settle('reject', new Error('connection dropped'))
    await flushTasks()

    expect(bot.isChatting).toBe(false)
    expect(statusHandler).toHaveBeenLastCalledWith(false)
    expect(errorTipsCalls(callback)).toHaveLength(1)
    expect(errorTips(callback)).toBe('__T__util.chatbot.error_request_failed')
  })

  it('流结束但一个帧都没有 → loading 复位并提示无响应', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)

    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    settle('resolve')
    await flushTasks()

    expect(bot.isChatting).toBe(false)
    expect(errorTipsCalls(callback)).toHaveLength(1)
    expect(errorTips(callback)).toBe('__T__util.chatbot.error_no_response')
  })

  it('流正常结束且有内容 → loading 复位且不额外报错', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)

    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!
    sendChunk(subscriber, { choices: [{ delta: [{ role: 'assistant', content: '答案' }] }] })
    subscriber('', true)
    settle('resolve')
    await flushTasks()

    expect(bot.isChatting).toBe(false)
    expect(errorTipsCalls(callback)).toHaveLength(0)
  })

  it('流中出现的完整错误行（带换行的裸 JSON）也会被识别并结束 loading', async () => {
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)

    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!

    // 服务端写入的 {data, message, code} 错误帧：非 SSE 帧，且以完整行到达
    subscriber(`${JSON.stringify({ data: 'AI_PROVIDER_UNAVAILABLE', message: '服务暂时不可用', code: 503 })}\n`, false)
    subscriber('', true)
    settle('resolve')
    await flushTasks()

    expect(bot.isChatting).toBe(false)
    expect(errorTipsCalls(callback)).toHaveLength(1)
    expect(errorTips(callback)).toBe('服务暂时不可用')
  })

  it('request().stream 直接失败 → loading 复位并提示失败', async () => {
    mockStream.mockRejectedValueOnce(new Error('network down'))
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)

    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })

    expect(bot.isChatting).toBe(false)
    expect(errorTipsCalls(callback)).toHaveLength(1)
  })

  it('request().stream 没有返回消费者 → loading 复位并提示失败', async () => {
    mockStream.mockResolvedValueOnce(undefined as never)
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)

    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })

    expect(bot.isChatting).toBe(false)
    expect(errorTipsCalls(callback)).toHaveLength(1)
  })

  it('读流空闲超过上限 → 中止请求并提示超时', async () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)

    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const signal = mockStream.mock.calls[0]![0]!.signal as AbortSignal
    expect(signal.aborted).toBe(false)

    await vi.advanceTimersByTimeAsync(60_000)

    expect(signal.aborted).toBe(true)
    expect(bot.isChatting).toBe(false)
    expect(errorTipsCalls(callback)).toHaveLength(1)
    expect(errorTips(callback)).toBe('__T__util.chatbot.error_timeout')
  })

  it('数据持续到达时不会触发空闲上限', async () => {
    vi.useFakeTimers()
    const callback = vi.fn()
    const bot = new ChatBot({ bookmarkId: 1 }, callback)

    await bot.chat({ type: ChatParamsType.CONTENT, content: 'q' })
    const subscriber = streamCallbackHolder.subscriber!
    const signal = mockStream.mock.calls[0]![0]!.signal as AbortSignal

    await vi.advanceTimersByTimeAsync(50_000)
    sendChunk(subscriber, { choices: [{ delta: [{ role: 'assistant', content: 'a' }] }] })
    await vi.advanceTimersByTimeAsync(50_000)

    expect(signal.aborted).toBe(false)
  })
})
