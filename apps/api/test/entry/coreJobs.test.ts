import { describe, expect, test, vi } from 'vitest'

const handlers = vi.hoisted(() => ({
  queue: vi.fn<(batch: MessageBatch, env: Env, ctx: ExecutionContext) => Promise<void>>(),
  cron: vi.fn<(event: { cron: string; scheduledTime: number }, env: Env, ctx: ExecutionContext) => Promise<void>>(),
  email: vi.fn<(message: ForwardableEmailMessage, env: Env, ctx: ExecutionContext) => Promise<void>>()
}))
vi.mock('@/entry/core/handlers', () => ({ handleQueueEvent: handlers.queue, handleScheduledEvent: handlers.cron, handleEmailEvent: handlers.email }))

import { handleJobsRequest, isJobsRequest } from '@/entry/core/jobs'
import { forwardEmail, forwardQueue, forwardScheduled } from '@/entry/edge/jobs'
import { EDGE_SECRET_HEADER } from '@/const/edge'

const SECRET = 'shared-secret'
const parent = { waitUntil: vi.fn(), passThroughOnException: vi.fn(), props: {}, tracing: {}, abort: vi.fn() } as unknown as ExecutionContext
// Edge's CORE binding behaves as a fetch to Core's entry, which routes the jobs host to handleJobsRequest.
const edgeEnv = (secret = SECRET) => {
  const fetch = vi.fn(async (input: string, init?: RequestInit) => {
    const request = new Request(input, { ...init, duplex: 'half' } as RequestInit)
    expect(isJobsRequest(request)).toBe(true)
    return handleJobsRequest(request, { EDGE_SHARED_SECRET: SECRET } as Env, parent)
  })
  return { env: { EDGE_SHARED_SECRET: secret, CORE: { fetch } } as unknown as Env, fetch }
}

const message = (id: string) => ({ id, timestamp: new Date(0), body: { id }, attempts: 2, ack: vi.fn(), retry: vi.fn() })
const batchOf = (messages: ReturnType<typeof message>[]) =>
  ({ queue: 'slax-reader-parser-twitter', metadata: { metrics: { backlogCount: 1, backlogBytes: 1 } }, messages, ackAll: vi.fn(), retryAll: vi.fn() }) as unknown as MessageBatch

describe('Edge forwards job events to Core over fetch, where placement applies', () => {
  test('queue decisions made in Core settle the real messages on Edge', async () => {
    handlers.queue.mockImplementationOnce(async batch => {
      expect(batch.queue).toBe('slax-reader-parser-twitter')
      expect(batch.messages.map(item => [item.body, item.attempts, item.timestamp.getTime()])).toEqual([
        [{ id: 'a' }, 2, 0],
        [{ id: 'b' }, 2, 0],
        [{ id: 'c' }, 2, 0]
      ])
      batch.messages[0].ack()
      batch.messages[1].retry({ delaySeconds: 30 })
    })
    const messages = [message('a'), message('b'), message('c')]
    const { env, fetch } = edgeEnv()
    await forwardQueue(batchOf(messages), env)
    expect(fetch.mock.calls[0][0]).toBe('https://jobs.internal/queue')
    expect(messages[0].ack).toHaveBeenCalledOnce()
    expect(messages[1].retry).toHaveBeenCalledWith({ delaySeconds: 30 })
    // A message the handler neither acked nor retried falls back to the batch's implicit outcome, as before.
    expect(messages[2].ack).not.toHaveBeenCalled()
    expect(messages[2].retry).not.toHaveBeenCalled()
  })

  test('a failing queue handler fails the Edge call without leaking its message, so the queue retries the batch', async () => {
    handlers.queue.mockRejectedValueOnce(new Error('postgresql://user:secret@db.invalid'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    await expect(forwardQueue(batchOf([message('a')]), edgeEnv().env)).rejects.toThrow('Core job /queue failed with HTTP 500')
    error.mockRestore()
  })

  test('batch-wide ack and retry are applied on Edge', async () => {
    handlers.queue.mockImplementationOnce(async batch => batch.retryAll({ delaySeconds: 5 }))
    const batch = batchOf([message('a')])
    await forwardQueue(batch, edgeEnv().env)
    expect(batch.retryAll).toHaveBeenCalledWith({ delaySeconds: 5 })
    handlers.queue.mockImplementationOnce(async batch => batch.ackAll())
    await forwardQueue(batch, edgeEnv().env)
    expect(batch.ackAll).toHaveBeenCalledOnce()
  })

  test('a cron tick runs in Core and waits for the work its jobs start with waitUntil', async () => {
    let finished = false
    handlers.cron.mockImplementationOnce(async (event, _env, ctx) => {
      expect(event).toMatchObject({ cron: '*/5 * * * *', scheduledTime: 42 })
      ctx.waitUntil(new Promise<void>(resolve => setTimeout(() => ((finished = true), resolve()), 20)))
    })
    await forwardScheduled({ cron: '*/5 * * * *', scheduledTime: 42, noRetry: vi.fn() } as unknown as ScheduledController, edgeEnv().env)
    expect(finished).toBe(true)
  })

  test('email reaches Core with its recipient and raw body, and a rejection returns to Edge', async () => {
    handlers.email.mockImplementationOnce(async message => {
      expect([message.to, message.rawSize]).toEqual(['订阅+x@news.example', 5])
      expect(await new Response(message.raw).text()).toBe('hello')
      message.setReject('Newsletter delivery is not available for this message.')
    })
    // Email Routing exposes decoded values, which may hold any Unicode, unlike HTTP header values. Headers of any
    // size stay in the raw MIME, which the handler parses; none travel in request headers.
    const huge = new Map([['subject', 'Hello, 世界 '.repeat(4000)]])
    const incoming = {
      from: '发件人@example.com',
      to: '订阅+x@news.example',
      headers: { [Symbol.iterator]: () => huge[Symbol.iterator](), get: (name: string) => huge.get(name) ?? null },
      raw: new Response('hello').body,
      rawSize: 5,
      setReject: vi.fn()
    } as unknown as ForwardableEmailMessage
    const { env, fetch } = edgeEnv()
    await forwardEmail(incoming, env)
    expect(incoming.setReject).toHaveBeenCalledWith('Newsletter delivery is not available for this message.')
    expect(JSON.stringify([...new Headers(fetch.mock.calls[0][1]!.headers).keys()])).not.toContain('subject')
    handlers.email.mockImplementationOnce(async () => {})
    const accepted = { ...incoming, raw: new Response('hello').body, setReject: vi.fn() } as unknown as ForwardableEmailMessage
    await forwardEmail(accepted, edgeEnv().env)
    expect(accepted.setReject).not.toHaveBeenCalled()
  })

  test('an email that Core cannot admit fails on Edge, so Email Routing reports the failure', async () => {
    handlers.email.mockRejectedValueOnce(new Error('Newsletter admission unavailable'))
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const incoming = { from: 'a', to: 'b', headers: new Headers(), raw: new Response('x').body, rawSize: 1, setReject: vi.fn() } as unknown as ForwardableEmailMessage
    await expect(forwardEmail(incoming, edgeEnv().env)).rejects.toThrow('Core job /email failed with HTTP 500')
    expect(incoming.setReject).not.toHaveBeenCalled()
    error.mockRestore()
  })

  test('the jobs route rejects a request without the shared secret and runs no handler', async () => {
    for (const headers of [{}, { [EDGE_SECRET_HEADER]: 'wrong' }]) {
      const response = await handleJobsRequest(new Request('https://jobs.internal/cron', { method: 'POST', headers, body: '{}' }), { EDGE_SHARED_SECRET: SECRET } as Env, parent)
      expect(response.status).toBe(403)
    }
    const unset = await handleJobsRequest(new Request('https://jobs.internal/cron', { method: 'POST', headers: { [EDGE_SECRET_HEADER]: '' }, body: '{}' }), {} as Env, parent)
    expect(unset.status).toBe(403)
    await expect(forwardScheduled({ cron: '* * * * *', scheduledTime: 1 } as unknown as ScheduledController, edgeEnv('wrong').env)).rejects.toThrow('HTTP 403')
    expect(handlers.cron).not.toHaveBeenCalledWith(expect.objectContaining({ cron: '* * * * *' }), expect.anything(), expect.anything())
    expect(isJobsRequest(new Request('https://reader-api.slax.dev/queue'))).toBe(false)
  })

  test('an email request missing its recipient or size header is rejected before any handler runs', async () => {
    const send = (headers: Record<string, string>) =>
      handleJobsRequest(
        new Request('https://jobs.internal/email', { method: 'POST', headers: { [EDGE_SECRET_HEADER]: SECRET, ...headers }, body: 'x' }),
        { EDGE_SHARED_SECRET: SECRET } as Env,
        parent
      )
    handlers.email.mockClear()
    expect((await send({ 'x-slax-email-size': '1' })).status).toBe(400)
    expect((await send({ 'x-slax-email-to': 'a%40b' })).status).toBe(400)
    expect((await send({ 'x-slax-email-to': 'a%40b', 'x-slax-email-size': 'NaN' })).status).toBe(400)
    expect(handlers.email).not.toHaveBeenCalled()
  })
})
