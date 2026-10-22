import { expect, it, vi } from 'vitest'
import { CallbackController } from '@/handler/http/callbackController'
import { Hashid } from '@/utils/hashids'

vi.mock('grammy', () => ({
  webhookCallback: (bot: any) => async () => {
    await bot.message({ from: { language_code: 'en' } })
    return new Response('ok')
  }
}))

it('encodes the completed Fork ID for the Telegram Reader success link without crawling again', async () => {
  const bot = {
    use: vi.fn(),
    command: vi.fn(),
    reaction: vi.fn(),
    message: undefined as any,
    on: (event: string, callback: any) => {
      if (event === 'message:text') bot.message = callback
    }
  }
  const noop = vi.fn()
  const telegram = {
    initTelegramBot: async () => bot,
    replyText: async () => ({ userId: 7, url: 'https://reader.test/b/source', chatId: 9, msgId: 11 }),
    sendProcessSuccess: vi.fn(),
    checkFromId: noop,
    commandStart: noop,
    commandHelp: noop,
    commandMe: noop,
    commandList: noop,
    commandTopics: noop,
    replyReaction: noop,
    notSupportType: noop
  }
  const createWorkflow = vi.fn()
  const controller = new CallbackController(
    telegram as any,
    { addUrlBookmark: async () => ({ kind: 'completed', bookmark_id: 123, bookmark_uid: 'destination' }) } as any,
    {} as any,
    {} as any,
    {} as any,
    { createWorkflow } as any,
    {} as any,
    {} as any,
    {} as any
  )
  const env = { TELEGRAM_WEBHOOK_SECRET: 'test-only', HASH_IDS_SALT: 'test-only' } as Env
  await controller.handlerTelegramCallback(
    { env, setHashIds: noop, setUserInfo: noop } as any,
    new Request('https://api.test/callback/telegram', { method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'test-only' } })
  )
  expect(telegram.sendProcessSuccess).toHaveBeenCalledOnce()
  const encodedId = telegram.sendProcessSuccess.mock.calls[0]![1]
  expect(new Hashid(env, 7).decodeId(encodedId)).toBe(123)
  expect(createWorkflow).not.toHaveBeenCalled()
})
