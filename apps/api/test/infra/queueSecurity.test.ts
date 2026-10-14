import { describe, expect, test, vi } from 'vitest'

vi.mock('@/handler/queue/bookmarkConsumer', () => ({ BookmarkConsumer: class {} }))
vi.mock('@/handler/queue/subscriptionConsumer', () => ({ SubscriptionConsumer: class {} }))
vi.mock('@/handler/queue/userDeletionConsumer', () => ({ UserDeletionConsumer: class {} }))

import { handleMessage } from '@/di/generated/consumer'
import { QueueClient } from '@/infra/queue/queueClient'

describe('queue delivery failures', () => {
  test.each(['STRIPE_QUEUE', 'TWITTER_PARSER', 'IMPORT_OTHER', 'FETCH_RETRY_PARSER'])('propagates %s enqueue failures', async binding => {
    const send = vi.fn().mockRejectedValue(new Error('unavailable'))
    const client = new QueueClient({ [binding]: { send } } as unknown as Env)
    const methods: Record<string, () => Promise<void>> = {
      STRIPE_QUEUE: () => client.pushStripeEvent(1),
      TWITTER_PARSER: () => client.pushParseThirdPartyMessage({} as never, {} as never),
      IMPORT_OTHER: () => client.pushImportMessage({} as never, {} as never),
      FETCH_RETRY_PARSER: () => client.pushRetryMessage({} as never, {} as never)
    }
    await expect(methods[binding]()).rejects.toThrow('unavailable')
  })

  test('acks successful messages but leaves the failing message unacknowledged', async () => {
    const handler = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('database unavailable'))
    const messages = [1, 2].map(id => ({ id: String(id), body: { eventId: id }, ack: vi.fn() }))
    const container = { resolve: () => ({ handleStripeEvent: handler }) }
    await expect(handleMessage(container as never, { queue: 'slax-reader-parser-stripe', messages } as never, {} as Env, {} as ExecutionContext)).rejects.toThrow(
      'database unavailable'
    )
    expect(messages[0].ack).toHaveBeenCalledOnce()
    expect(messages[1].ack).not.toHaveBeenCalled()
  })

  test('does not acknowledge a failed batch', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('batch failed'))
    const messages = [1, 2].map(id => ({ id: String(id), body: {}, ack: vi.fn() }))
    const container = { resolve: () => ({ handleParseThirdPartyURL: handler }) }
    await expect(handleMessage(container as never, { queue: 'slax-reader-parser-twitter', messages } as never, {} as Env, {} as ExecutionContext)).rejects.toThrow('batch failed')
    for (const message of messages) expect(message.ack).not.toHaveBeenCalled()
  })
})
