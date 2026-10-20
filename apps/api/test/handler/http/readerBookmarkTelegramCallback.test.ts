import { beforeEach, describe, expect, test, vi } from 'vitest'

const dispatch = vi.hoisted(() => ({ message: null as null | ((ctx: unknown) => Promise<void>), ctx: null as unknown }))
vi.mock('grammy', async importOriginal => {
  const actual = await importOriginal<typeof import('grammy')>()
  return { ...actual, webhookCallback: () => async () => { await dispatch.message!(dispatch.ctx); return new Response('ok') } }
})

import { CallbackController } from '@/handler/http/callbackController'
import { createMockCtx } from '@test/helpers/mockFactory'

const sourceUrl = 'https://reader.example.com/b/123e4567-e89b-42d3-a456-426614174000'

function fixture() {
  const ctxManager = createMockCtx({ hashIds: { encodeId: (id: number) => id * 10, decodeId: (id: number) => id / 10 } })
  ctxManager.env.FRONT_END_URL = 'https://reader.example.com'
  ctxManager.env.TELEGRAM_WEBHOOK_SECRET = 'test-webhook-secret'
  ctxManager.env.HASH_IDS_SALT = 'test-hash-salt'
  const ctx = { from: { language_code: 'en' }, reply: vi.fn() }
  dispatch.ctx = ctx
  const bot = {
    use: vi.fn(), command: vi.fn(), reaction: vi.fn(),
    on: vi.fn((event: string, handler: (ctx: unknown) => Promise<void>) => { if (event === 'message:text') dispatch.message = handler })
  }
  const telegramBotService = {
    initTelegramBot: vi.fn().mockResolvedValue(bot),
    replyText: vi.fn().mockResolvedValue({ url: sourceUrl, userId: 1, chatId: 12, msgId: 34 }),
    sendProcessSuccess: vi.fn(),
    checkFromId: vi.fn(), commandStart: vi.fn(), commandHelp: vi.fn(), commandMe: vi.fn(), commandList: vi.fn(), commandTopics: vi.fn(),
    replyReaction: vi.fn(), notSupportType: vi.fn(), handlePaginationCallback: vi.fn()
  }
  const bookmarkService = { addUrlBookmark: vi.fn().mockResolvedValue({ info: { bookmarkId: 9 } }) }
  const bookmarkAddOrchestrator = { addByUrl: vi.fn().mockResolvedValue({ bookmarkId: 42, workflowParams: null, isShortcut: false, forkResult: { bookmark_id: 420 } }) }
  const crawlService = { createWorkflow: vi.fn() }
  const controller = Object.assign(Object.create(CallbackController.prototype), {
    telegramBotService, bookmarkService, bookmarkAddOrchestrator, crawlService,
    logsService: { track: vi.fn().mockResolvedValue(undefined) }, ga4Client: { trackEvent: vi.fn().mockResolvedValue(undefined) }
  }) as CallbackController
  const invoke = () => controller.handlerTelegramCallback(ctxManager, new Request('https://api.test/callback/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-webhook-secret' }, body: '{}' }))
  return { invoke, ctxManager, ctx, bookmarkService, bookmarkAddOrchestrator, crawlService, telegramBotService }
}

beforeEach(() => { dispatch.message = null; dispatch.ctx = null })

describe('Telegram Reader Fork dispatch', () => {
  test('sends a completed Fork receipt without the direct save or crawl path', async () => {
    const f = fixture()
    expect((await f.invoke()).status).toBe(200)
    expect(f.bookmarkAddOrchestrator.addByUrl).toHaveBeenCalledWith(f.ctxManager, { target_url: sourceUrl, tags: [] }, { idempotencyKey: 'telegram:12:34' })
    expect(f.telegramBotService.sendProcessSuccess).toHaveBeenCalledWith(f.ctx, 420, { chat_id: 12, origin_message_id: 34 })
    expect(f.bookmarkService.addUrlBookmark).not.toHaveBeenCalled()
    expect(f.crawlService.createWorkflow).not.toHaveBeenCalled()
  })

  test('reuses the operation key when Telegram redelivers a message', async () => {
    const f = fixture()
    await f.invoke()
    await f.invoke()
    expect(f.bookmarkAddOrchestrator.addByUrl.mock.calls.map(call => call[2])).toEqual([{ idempotencyKey: 'telegram:12:34' }, { idempotencyKey: 'telegram:12:34' }])
  })

  test('passes the accepted direct-write version into ordinary Telegram capture', async () => {
    const f = fixture()
    f.telegramBotService.replyText.mockResolvedValue({ url: 'https://x.com/a?a=1&b=2', userId: 1, chatId: 12, msgId: 34 })
    f.bookmarkService.addUrlBookmark.mockResolvedValue({ info: { bookmarkId: 9, writeVersion: 7 } } as never)
    await f.invoke()
    expect(f.bookmarkService.addUrlBookmark).toHaveBeenCalledWith(f.ctxManager, { target_url: 'https://x.com/a?a=1&b=2', tags: [] }, expect.anything(), expect.anything())
    expect(f.crawlService.createWorkflow).toHaveBeenCalledWith(f.ctxManager.env, expect.objectContaining({ url: 'https://x.com/a?a=1&b=2', bookmarkId: 9, writeVersion: 7 }))
    expect(f.bookmarkAddOrchestrator.addByUrl).not.toHaveBeenCalled()
  })

  test('keeps a failed Fork out of ordinary URL fetching', async () => {
    const f = fixture()
    f.bookmarkAddOrchestrator.addByUrl.mockRejectedValue(new Error('source access revoked'))
    await f.invoke()
    expect(f.ctx.reply).toHaveBeenCalled()
    expect(f.telegramBotService.sendProcessSuccess).not.toHaveBeenCalled()
    expect(f.bookmarkService.addUrlBookmark).not.toHaveBeenCalled()
    expect(f.crawlService.createWorkflow).not.toHaveBeenCalled()
  })
})
