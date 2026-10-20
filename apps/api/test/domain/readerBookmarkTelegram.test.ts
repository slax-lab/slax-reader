import { describe, expect, test, vi } from 'vitest'
import { TelegramBotService } from '@/domain/telegram'

const origin = 'https://reader.example.com'
const uuid = '123e4567-e89b-42d3-a456-426614174000'
const sourceUrl = `${origin}/b/${uuid}`

function fixture() {
  const userRepo = { getUserByPlatform: vi.fn().mockResolvedValue({ user_id: 7 }) }
  const service = Object.assign(Object.create(TelegramBotService.prototype), {
    env: { FRONT_END_URL: origin, RUN_ENV: 'prod' },
    userRepo,
    t: { telegramBlockedUrl: () => 'blocked', telegramBindGuide: () => 'bind' }
  }) as TelegramBotService
  const context = (text: string) => ({ from: { id: 123 }, msg: { text }, chatId: 456, msgId: 789, reply: vi.fn() })
  return { service, userRepo, context }
}

describe('Telegram Reader URL admission', () => {
  test('allows a canonical Reader source through the pre-save URL policy', async () => {
    const f = fixture()
    const ctx = f.context(`Save ${sourceUrl}`)
    expect(await f.service.replyText(ctx as never)).toEqual({ url: sourceUrl, userId: 7, chatId: 456, msgId: 789 })
    expect(ctx.reply).not.toHaveBeenCalled()
  })

  test.each([`${sourceUrl}?`, `${sourceUrl}#`, `${sourceUrl}?source=share`, `${sourceUrl}/`, `https://name:password@reader.example.com/b/${uuid}`])(
    'does not strip or normalize a malformed Reader token into a valid source: %s', async url => {
      const f = fixture()
      const ctx = f.context(`Save ${url}`)
      expect(await f.service.replyText(ctx as never)).toBeUndefined()
      expect(ctx.reply).toHaveBeenCalledWith('blocked')
      expect(f.userRepo.getUserByPlatform).not.toHaveBeenCalled()
    }
  )

  test.each(['https://example.com/article?part=1', 'https://x.com/a?a=1&b=2', 'https://mp.weixin.qq.com/s?__biz=article&poc_token=token&mid=123'])(
    'preserves the full normal article URL: %s', async target => {
      const f = fixture()
      expect(await f.service.replyText(f.context(`Save ${target}`) as never)).toMatchObject({ url: target, userId: 7 })
    }
  )
})
