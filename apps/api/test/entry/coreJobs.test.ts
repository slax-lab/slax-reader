import { describe, expect, test, vi } from 'vitest'

vi.mock('cloudflare:workers', () => ({
  WorkerEntrypoint: class {
    constructor(
      protected ctx: ExecutionContext,
      protected env: Env
    ) {}
  },
  DurableObject: class {}
}))

const handlers = vi.hoisted(() => ({
  queue: vi.fn<(batch: MessageBatch, env: Env, ctx: ExecutionContext) => Promise<void>>(),
  cron: vi.fn<(event: { cron: string; scheduledTime: number }, env: Env, ctx: ExecutionContext) => Promise<void>>(),
  email: vi.fn<(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) => Promise<void>>()
}))
vi.mock('@/entry/core/index', () => ({ handleQueueEvent: handlers.queue, handleScheduledEvent: handlers.cron, handleEmailEvent: handlers.email }))

import { CoreJobs } from '@/entry/core/jobs'
import { forwardEmail, forwardQueue, forwardScheduled } from '@/entry/edge/jobs'

const parent = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {}, tracing: {}, abort: vi.fn() } as unknown as ExecutionContext
// Edge's binding behaves as an RPC stub that calls the entrypoint in Core.
const edgeEnv = () => ({ CORE_JOBS: new (CoreJobs as unknown as new (ctx: ExecutionContext, env: Env) => CoreJobs)(parent, {} as Env) }) as unknown as Env

const message = (id: string) => ({ id, timestamp: new Date(0), body: { id }, attempts: 1, ack: vi.fn(), retry: vi.fn() })

describe('Edge forwards job events to Core', () => {
  test('queue decisions made in Core settle the real messages on Edge', async () => {
    handlers.queue.mockImplementationOnce(async batch => {
      expect(batch.queue).toBe('slax-reader-parser-twitter')
      expect(batch.messages.map(item => item.body)).toEqual([{ id: 'a' }, { id: 'b' }, { id: 'c' }])
      batch.messages[0].ack()
      batch.messages[1].retry({ delaySeconds: 30 })
    })
    const messages = [message('a'), message('b'), message('c')]
    const batch = { queue: 'slax-reader-parser-twitter', metadata: { metrics: {} }, messages, ackAll: vi.fn(), retryAll: vi.fn() } as unknown as MessageBatch
    await forwardQueue(batch, edgeEnv())
    expect(messages[0].ack).toHaveBeenCalledOnce()
    expect(messages[1].retry).toHaveBeenCalledWith({ delaySeconds: 30 })
    // A message the handler neither acked nor retried falls back to the batch's implicit outcome, as before.
    expect(messages[2].ack).not.toHaveBeenCalled()
    expect(messages[2].retry).not.toHaveBeenCalled()
  })

  test('a failing queue handler fails the Edge invocation, so the queue retries the batch', async () => {
    handlers.queue.mockRejectedValueOnce(new Error('database unavailable'))
    const batch = { queue: 'q', metadata: { metrics: {} }, messages: [message('a')], ackAll: vi.fn(), retryAll: vi.fn() } as unknown as MessageBatch
    await expect(forwardQueue(batch, edgeEnv())).rejects.toThrow('database unavailable')
  })

  test('batch-wide ack and retry are applied on Edge', async () => {
    handlers.queue.mockImplementationOnce(async batch => batch.retryAll({ delaySeconds: 5 }))
    const batch = { queue: 'q', metadata: { metrics: {} }, messages: [message('a')], ackAll: vi.fn(), retryAll: vi.fn() } as unknown as MessageBatch
    await forwardQueue(batch, edgeEnv())
    expect(batch.retryAll).toHaveBeenCalledWith({ delaySeconds: 5 })
    handlers.queue.mockImplementationOnce(async batch => batch.ackAll())
    await forwardQueue(batch, edgeEnv())
    expect(batch.ackAll).toHaveBeenCalledOnce()
  })

  test('a cron tick runs in Core and waits for the work its jobs start with waitUntil', async () => {
    let finished = false
    handlers.cron.mockImplementationOnce(async (event, _env, ctx) => {
      expect(event).toMatchObject({ cron: '*/5 * * * *', scheduledTime: 42 })
      ctx.waitUntil(new Promise<void>(resolve => setTimeout(() => ((finished = true), resolve()), 20)))
    })
    await forwardScheduled({ cron: '*/5 * * * *', scheduledTime: 42, noRetry: vi.fn() } as unknown as ScheduledController, edgeEnv())
    expect(finished).toBe(true)
  })

  test('email reaches Core with its envelope, headers and body, and a rejection returns to Edge', async () => {
    handlers.email.mockImplementationOnce(async message => {
      expect([message.from, message.to, message.rawSize, message.headers.get('subject')]).toEqual(['a@example.com', 'feed@news.example', 5, 'Hello'])
      expect(await new Response(message.raw).text()).toBe('hello')
      message.setReject('Newsletter delivery is not available for this message.')
    })
    const incoming = {
      from: 'a@example.com',
      to: 'feed@news.example',
      headers: new Headers({ Subject: 'Hello' }),
      raw: new Response('hello').body,
      rawSize: 5,
      setReject: vi.fn()
    } as unknown as ForwardableEmailMessage
    await forwardEmail(incoming, edgeEnv())
    expect(incoming.setReject).toHaveBeenCalledWith('Newsletter delivery is not available for this message.')
    handlers.email.mockImplementationOnce(async () => {})
    const accepted = { ...incoming, setReject: vi.fn() } as unknown as ForwardableEmailMessage
    await forwardEmail(accepted, edgeEnv())
    expect(accepted.setReject).not.toHaveBeenCalled()
  })

  test('an email that Core cannot admit fails on Edge, so Email Routing reports the failure', async () => {
    handlers.email.mockRejectedValueOnce(new Error('Newsletter admission unavailable'))
    const incoming = { from: 'a', to: 'b', headers: new Headers(), raw: new Response('x').body, rawSize: 1, setReject: vi.fn() } as unknown as ForwardableEmailMessage
    await expect(forwardEmail(incoming, edgeEnv())).rejects.toThrow('Newsletter admission unavailable')
    expect(incoming.setReject).not.toHaveBeenCalled()
  })
})
