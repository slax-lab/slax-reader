import { describe, expect, test, vi } from 'vitest'
import { getRouter } from '../../src/di/router'
import { handleMessage } from '../../src/di/generated/consumer'

vi.mock('../../src/di/generated/readerRouter', () => ({ getRouter: () => 'reader-router' }))
vi.mock('../../src/handler/queue/bookmarkConsumer', () => ({ BookmarkConsumer: class {} }))
vi.mock('../../src/handler/queue/subscriptionConsumer', () => ({ SubscriptionConsumer: class {} }))
vi.mock('../../src/handler/queue/userDeletionConsumer', () => ({ UserDeletionConsumer: class {} }))

describe('configured installation routing', () => {
  test('accepts the exact configured host and keeps legacy hosts', () => {
    expect(getRouter('reader.example.com', {} as any, 'https://reader.example.com')).toBe('reader-router')
    expect(getRouter('reader.example.com.attacker.test', {} as any, 'https://reader.example.com')).toBeNull()
    expect(getRouter('reader.example.com:8443', {} as any, 'https://reader.example.com')).toBeNull()
    expect(getRouter('arbitrary.test', {} as any, 'invalid')).toBeNull()
    expect(getRouter('reader-api.slax.com', {} as any)).toBe('reader-router')
  })
  test.each([
    ['slax-reader-parser-twitter', 'handleParseThirdPartyURL', true],
    ['slax-reader-parser-fetch-retry-prod', 'handleImportOther', false],
    ['slax-reader-import-other', 'handleImportOther', false],
    ['slax-reader-import-other-slow', 'handleImportOtherSlow', false],
    ['slax-reader-import-other-dql', 'handleImportOtherDQL', false],
    ['slax-reader-parser-stripe', 'handleStripeEvent', false],
    ['slax-reader-user-deletion', 'handleUserDeletion', false]
  ])('custom and legacy %s deliver the same payload to the same handler', async (logical, method, batch) => {
    for (const custom of [false, true]) {
      const handler = vi.fn(async () => {}),
        ack = vi.fn()
      const queue = custom ? 'operator-queue' : logical
      const env = custom ? { API_QUEUE_CHANNELS: JSON.stringify({ [queue]: logical }) } : {}
      const resolve = vi.fn(() => ({ [method]: handler }))
      await handleMessage({ resolve } as any, { queue, messages: [{ id: 'job-1', body: { content: 1 }, ack }] } as any, env as Env, {} as ExecutionContext)
      expect(handler).toHaveBeenCalledOnce()
      const payload = { id: 'job-1', info: { content: 1 } }
      expect(handler.mock.calls[0][1]).toEqual(batch ? [payload] : payload)
      expect(ack).toHaveBeenCalledOnce()
    }
  })
  test.each([undefined, '{', '{}', '{"unknown":"invalid-handler"}'])('unknown queue or invalid map rejects without acknowledging (%s)', async mapping => {
    const resolve = vi.fn(),
      ack = vi.fn()
    await expect(
      handleMessage({ resolve } as any, { queue: 'unknown', messages: [{ ack }] } as any, { API_QUEUE_CHANNELS: mapping } as Env, {} as ExecutionContext)
    ).rejects.toThrow()
    expect(resolve).not.toHaveBeenCalled()
    expect(ack).not.toHaveBeenCalled()
  })
})
