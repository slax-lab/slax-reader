import { describe, expect, it, vi } from 'vitest'
import { BookmarkConsumer } from '@/handler/queue/bookmarkConsumer'
import { handleMessage } from '@/di/generated/consumer'
import { Hashid } from '@/utils/hashids'

const env = { HASH_IDS_SALT: 'queue-test-only' } as Env
const captureRevision = '2026-10-23T12:00:00.000Z'
const message = (id: number) => ({
  id: String(id),
  body: {
    userId: id,
    bookmarkId: id + 10,
    targetUrl: 'https://x.com/user/status/123',
    captureRevision,
    callback: 1,
    callbackPayload: { chat_id: 123, origin_message_id: 456 },
    ignoreGenerateTag: true
  },
  ack: vi.fn(),
  retry: vi.fn()
})

describe('legacy capture queue drain through generated wiring', () => {
  it('initializes each real context with that message owner and retains callback and revision', async () => {
    const createWorkflow = vi.fn().mockResolvedValue(undefined)
    const consumer = new BookmarkConsumer({ createWorkflow } as any, {} as any)
    await handleMessage({ resolve: () => consumer } as any, { queue: 'slax-reader-parser-twitter', messages: [message(7), message(8)] } as any, env, {} as ExecutionContext)
    expect(createWorkflow).toHaveBeenCalledTimes(2)
    for (const [index, userId] of [7, 8].entries()) {
      const [, params, , ctx] = createWorkflow.mock.calls[index]
      expect(params).toMatchObject({
        userId,
        enUserId: new Hashid(env).encodeId(userId),
        captureRevision,
        callbackChatId: 123,
        callbackOriginMessageId: 456,
        ignoreGenerateTag: true
      })
      expect(ctx.getUserId()).toBe(userId)
      expect(ctx.hashIds.encodeId(11)).toBe(new Hashid(env, userId).encodeId(11))
    }
  })

  it('retries a rejected message without blocking or retrying successful siblings', async () => {
    const createWorkflow = vi.fn().mockRejectedValueOnce(new Error('dispatch rejected')).mockResolvedValue(undefined)
    const consumer = new BookmarkConsumer({ createWorkflow } as any, {} as any)
    const messages = [message(7), message(8)]
    await handleMessage({ resolve: () => consumer } as any, { queue: 'slax-reader-parser-twitter', messages } as any, env, {} as ExecutionContext)
    expect(createWorkflow).toHaveBeenCalledTimes(2)
    expect(messages[0].retry).toHaveBeenCalledOnce()
    expect(messages[0].ack).not.toHaveBeenCalled()
    expect(messages[1].ack).toHaveBeenCalledOnce()
    expect(messages[1].retry).not.toHaveBeenCalled()
  })
})
