import { afterEach, expect, test, vi } from 'vitest'
import { NewsletterTiming } from '@/utils/newsletterTiming'
import { NewsletterError } from '@/utils/newsletter'
import { receiveNewsletterEmail } from '@/domain/newsletter'

afterEach(() => vi.restoreAllMocks())

test('records stage wall time, total duration and the five-second observation flag', async () => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const timing = new NewsletterTiming(123)
  await timing.measure('parse', async () => {
    now = 120
    return 'parsed'
  })
  now = 6000
  await timing.measure('cleanup', async () => {
    now = 6050
  })
  timing.outcome = 'ready'
  timing.log()
  const summary = log.mock.calls[0][1] as any
  expect(summary).toMatchObject({ bytes: 123, outcome: 'ready', total_ms: 6050, slow: true, phases_ms: { parse: 120, cleanup: 50 } })
  expect(typeof summary.event_id).toBe('string')
  expect(Object.keys(summary).sort()).toEqual(['bytes', 'cleanup_failed', 'event_id', 'outcome', 'phases_ms', 'slow', 'total_ms'])
})

test('failed phases and policy rejections retain timing without logging infrastructure or mail data', async () => {
  let now = 0
  vi.spyOn(performance, 'now').mockImplementation(() => now)
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const timing = new NewsletterTiming(100)
  const message = { rawSize: 100, to: 'private@example.com', setReject: vi.fn() } as unknown as ForwardableEmailMessage
  const service = {
    receive: () =>
      timing.measure('admit', async () => {
        now = 60
        throw new NewsletterError('not_found', 404)
      })
  }
  await receiveNewsletterEmail(message, {} as Env, service as any, timing)
  timing.log()
  expect(log.mock.calls[0][1]).toMatchObject({ outcome: 'rejected', slow: false, phases_ms: { admit: 60 } })
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|@example/)
})

test('email cleanup suppresses raw infrastructure errors while attempting every real callback', async () => {
  const { ContextManager } = await import('@/utils/context')
  const ctx = new ContextManager({} as ExecutionContext, {} as Env)
  const raw = new Error('postgresql://private-user:private-password@example.invalid/db')
  const next = vi.fn(async () => {})
  ctx.onCleanup(async () => {
    throw raw
  })
  ctx.onCleanup(next)
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  let failed = false
  await ctx.cleanup(() => {
    failed = true
  })
  expect(failed).toBe(true)
  expect(next).toHaveBeenCalledOnce()
  expect(error).not.toHaveBeenCalled()
})
