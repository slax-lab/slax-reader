import { describe, expect, it, vi } from 'vitest'
import { BookmarkConsumer } from '@/handler/queue/bookmarkConsumer'
import { createMockCtx } from '@test/helpers/mockFactory'

describe('legacy capture queue drain', () => {
  it('routes queued captures through the guarded workflow with their original request identity', async () => {
    const createWorkflow = vi.fn().mockResolvedValue(undefined)
    const consumer = new BookmarkConsumer({ createWorkflow } as any, {} as any)
    const ctx = createMockCtx({ userId: 7 })
    const captureRevision = '2026-10-23T12:00:00.000Z'
    await consumer.handleParseThirdPartyURL(ctx, [{id: 'message', info: {userId:7, bookmarkId:11, targetUrl:'https://x.com/user/status/123', captureRevision, callback:1, callbackPayload:{chat_id:123,origin_message_id:456}, ignoreGenerateTag:true}}] as any)
    expect(createWorkflow).toHaveBeenCalledWith(ctx.env, expect.objectContaining({bookmarkId:11, userId:7, captureRevision, callbackChatId:123, callbackOriginMessageId:456, ignoreGenerateTag:true}), 3, ctx)
  })
})
