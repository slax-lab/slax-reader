import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { NewsletterService } from '@/domain/newsletter'
import { NewsletterError } from '@/utils/newsletter'
import type { ContextManager } from '@/utils/context'
import type { Container } from '@/decorators/di'
import type { NewsletterTiming } from '@/utils/newsletterTiming'

const state = vi.hoisted(() => ({ cleanupFails: false, receive: 'ready', cleaned: 0 }))
vi.mock('@/di/generated/dependency', () => ({
  initializeCore() {},
  initializeInfrastructure(ctx: ContextManager, container: Container) {
    ctx.onCleanup(async () => {
      state.cleaned++
      if (state.cleanupFails) throw new Error('postgresql://private:secret@example.invalid/db')
    })
    container.registerInstance(NewsletterService, {
      async receive(_message: unknown, _env: unknown, timing: NewsletterTiming) {
        if (state.receive === 'failed') throw new Error('private connection details')
        if (state.receive === 'rejected') throw new NewsletterError('not_found')
        timing.outcome = state.receive as 'ready' | 'duplicate' | 'cancelled'
      }
    })
  }
}))
vi.mock('@/di/router', () => ({ getRouter: vi.fn() }))
vi.mock('@/di/generated/consumer', () => ({ handleMessage: vi.fn() }))
vi.mock('@/di/generated/cronjob', () => ({ handleCronjob: vi.fn() }))
vi.mock('@/handler/http/contentHandler', () => ({ handleContentRequest: vi.fn(), isContentRequest: vi.fn() }))
vi.mock('@/utils/hybridSearch/jieba', () => ({ SlaxJieba: class {} }))
vi.mock('@/infra/message/websocket', () => ({ SlaxWebSocketServer: class {} }))
vi.mock('@/domain/orchestrator/mcp', () => ({ SlaxMcpServer: class {} }))
vi.mock('@/entry/core/screenshotBrowser', () => ({ ScreenshotBrowser: class {} }))

import { handleEmailEvent } from '@/entry/core'

beforeEach(() => {
  state.cleanupFails = true
  state.receive = 'ready'
  state.cleaned = 0
})
afterEach(() => vi.restoreAllMocks())

test.each(['ready', 'duplicate', 'cancelled', 'rejected'])('cleanup cannot replace the %s receiving outcome', async outcome => {
  state.receive = outcome
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  const error = vi.spyOn(console, 'error').mockImplementation(() => {})
  const message = { rawSize: 10, setReject: vi.fn() } as unknown as ForwardableEmailMessage
  await expect(handleEmailEvent(message, {} as Env, {} as ExecutionContext)).resolves.toBeUndefined()
  expect(state.cleaned).toBe(1)
  expect(log).toHaveBeenCalledOnce()
  expect(log.mock.calls[0][1]).toMatchObject({ outcome, cleanup_failed: true, phases_ms: { cleanup: expect.any(Number) } })
  expect(error).not.toHaveBeenCalled()
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/private|secret|postgresql|example\.invalid/)
})

test('cleanup cannot replace the original sanitized receive failure', async () => {
  state.receive = 'failed'
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  await expect(handleEmailEvent({ rawSize: 10 } as ForwardableEmailMessage, {} as Env, {} as ExecutionContext)).rejects.toThrow('Newsletter admission unavailable')
  expect(log).toHaveBeenCalledOnce()
  expect(log.mock.calls[0][1]).toMatchObject({ outcome: 'failed', cleanup_failed: true })
  expect(state.cleaned).toBe(1)
})

test('successful cleanup reports a successful receive without a cleanup failure', async () => {
  state.cleanupFails = false
  const log = vi.spyOn(console, 'info').mockImplementation(() => {})
  await handleEmailEvent({ rawSize: 10 } as ForwardableEmailMessage, {} as Env, {} as ExecutionContext)
  expect(log.mock.calls[0][1]).toMatchObject({ outcome: 'ready', cleanup_failed: false })
})
