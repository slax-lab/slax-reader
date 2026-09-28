import { afterEach, describe, expect, test, vi } from 'vitest'

const { stream } = vi.hoisted(() => ({ stream: vi.fn() }))

vi.mock('@/bridge/request', () => ({ request: { stream } }))
vi.mock('@/utils/locale', () => ({ $t: (key: string) => key }))

import { ChatBot, ChatParamsType, ChatResponseType } from '@/components/Chat/chatbot'

afterEach(() => {
  vi.clearAllMocks()
})

describe('ChatBot SSE completion', () => {
  test.each(['data: [DONE]\n\n', '[DONE]'] as const)('ignores the %s completion sentinel', async sentinel => {
    stream.mockResolvedValue((callback: (text: string, isDone: boolean) => void) => {
      callback(sentinel, false)
      callback('', true)
    })

    const responseCallback = vi.fn()
    const statusCallback = vi.fn()
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const bot = new ChatBot({ bookmarkId: 1 }, responseCallback)
    bot.chatStatusUpdateHandler = statusCallback

    await bot.chat({ type: ChatParamsType.CONTENT, content: 'hello' })

    expect(responseCallback).not.toHaveBeenCalled()
    expect(error).not.toHaveBeenCalled()
    expect(bot.isChatting).toBe(false)
    expect(statusCallback.mock.calls).toEqual([[true], [false]])
  })
})

describe('ChatBot failure envelopes', () => {
  type StatusUpdateParams = { data?: { STATUS_UPDATE?: { name?: string } } }

  const errorTips = (responseCallback: ReturnType<typeof vi.fn>) =>
    responseCallback.mock.calls.filter(([params]) => (params as StatusUpdateParams | undefined)?.data?.STATUS_UPDATE?.name === 'error')

  test('renders an envelope that arrives as a complete line mid-stream', async () => {
    // The server writes the terminal failure as a bare JSON line before closing, so the
    // streaming branch consumes it; handling envelopes only at end-of-stream loses it and the
    // user is left with a blank answer (the regression this covers).
    stream.mockResolvedValue((callback: (text: string, isDone: boolean) => void) => {
      callback(`${JSON.stringify({ data: 'AI_PROVIDER_UNAVAILABLE', message: 'temporarily unavailable', code: 503 })}\n`, false)
      callback('', true)
    })

    const responseCallback = vi.fn()
    const statusCallback = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const bot = new ChatBot({ bookmarkId: 1 }, responseCallback)
    bot.chatStatusUpdateHandler = statusCallback

    await bot.chat({ type: ChatParamsType.CONTENT, content: 'hello' })

    expect(errorTips(responseCallback)).toHaveLength(1)
    expect(responseCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        type: ChatResponseType.STATUS_UPDATE,
        data: { [ChatResponseType.STATUS_UPDATE]: { name: 'error', tips: 'temporarily unavailable', status: 'failed' } }
      })
    )
    expect(bot.isChatting).toBe(false)
    expect(statusCallback.mock.calls).toEqual([[true], [false]])
  })

  test('still renders an envelope that only arrives at end of stream', async () => {
    stream.mockResolvedValue((callback: (text: string, isDone: boolean) => void) => {
      callback(JSON.stringify({ data: 'NOT_SUBSCRIPTION', message: 'subscription required', code: 403 }), false)
      callback('', true)
    })

    const responseCallback = vi.fn()
    vi.spyOn(console, 'error').mockImplementation(() => undefined)
    const bot = new ChatBot({ bookmarkId: 1 }, responseCallback)

    await bot.chat({ type: ChatParamsType.CONTENT, content: 'hello' })

    expect(errorTips(responseCallback)).toHaveLength(1)
    // The existing code-to-message mapping still wins over the server message.
    expect(responseCallback).toHaveBeenCalledWith(
      expect.objectContaining({
        data: { [ChatResponseType.STATUS_UPDATE]: { name: 'error', tips: 'util.chatbot.error_not_subscription', status: 'failed' } }
      })
    )
  })
})
