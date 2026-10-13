import { ChatBot, ChatResponseType } from '../src/components/Chat/chatbot'
import { expect, it, vi } from 'vitest'
vi.mock('../src/bridge/request', () => ({ request: {} }))
it.each(['search', 'browser', 'searchBookmark'])('preserves the failed status from a %s tool stream', tool => {
  const response = vi.fn()
  const bot = new ChatBot({ bookmarkId: 1 }, response)
  // Exercise the wire decoder boundary; no network or translated copy in the assertion.
  ;(bot as unknown as { handleData(data: unknown, sessionId: number): void }).handleData(
    { choices: [{ status: 'finished_failed', delta: [{ role: 'tool', name: tool, content: '{}' }] }] },
    1
  )
  expect(response).toHaveBeenCalledWith(expect.objectContaining({ data: { [ChatResponseType.STATUS_UPDATE]: expect.objectContaining({ name: tool, status: 'failed' }) } }))
})
