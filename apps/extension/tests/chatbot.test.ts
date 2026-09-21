import { afterEach, describe, expect, test, vi } from 'vitest'

const { stream } = vi.hoisted(() => ({ stream: vi.fn() }))

vi.mock('@/bridge/request', () => ({ request: { stream } }))
vi.mock('@/utils/locale', () => ({ $t: (key: string) => key }))

import { ChatBot, ChatParamsType } from '@/components/Chat/chatbot'

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
