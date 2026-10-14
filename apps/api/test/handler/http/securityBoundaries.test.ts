import { describe, expect, test, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { SubscriptionController } from '@/handler/http/subscriptionController'
import { PromotionController } from '@/handler/http/promotionController'
import { CallbackController } from '@/handler/http/callbackController'
import { SubscriptionServiceMain } from '@/domain/subscriptionMain'
import { receiveActivityType } from '@/infra/repository/dbSubscription'
import { readConfig, workerConfig, CONFIG_TEMPLATE } from '../../../script/deploy/config'
import { isWhitelisted } from '@/middleware/auth'

const context = { env: {}, getUserId: () => 1 } as never
const jsonRequest = (data: unknown) => new Request('https://api.example/', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) })

describe('subscription grants', () => {
  test.each(['random-campaign', 'blogger', '__proto__'])('rejects activity %s before calling grant service', async activity => {
    const receiveSubscription = vi.fn()
    const controller = new SubscriptionController({ receiveSubscription } as never, {} as never, {} as never, {} as never)
    await controller.receiveSubscription(context, jsonRequest({ activity }))
    expect(receiveSubscription).not.toHaveBeenCalled()
  })

  test('domain service rejects arbitrary activities before any database access', async () => {
    const getUserSubscriptionInfo = vi.fn()
    const service = new SubscriptionServiceMain({} as never, {} as never, {} as never, { getUserSubscriptionInfo } as never, {} as never, {} as never, {} as never, {} as never)
    await expect(service.receiveSubscription(context, 'random' as receiveActivityType)).rejects.toBeDefined()
    await expect(service.receiveSubscription(context, receiveActivityType.BLOGGER)).rejects.toBeDefined()
    expect(getUserSubscriptionInfo).not.toHaveBeenCalled()
  })

  test.each(['__proto__', 'constructor', 'toString'])('rejects inherited blogger name %s', async activity_id => {
    const receiveSubscription = vi.fn()
    const controller = new PromotionController({ receiveSubscription } as never)
    await controller.handleReceiveRequest(context, jsonRequest({ activity_type: receiveActivityType.BLOGGER, activity_id }))
    expect(receiveSubscription).not.toHaveBeenCalled()
  })

  test.each(['manual', 'subscription_update', 'subscription_threshold', null])('ignores non-renewal invoice reason %s', async billing_reason => {
    const service = new SubscriptionServiceMain({} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    await expect(service.subscriptionUpdate({ billing_reason } as never)).resolves.toBeUndefined()
  })
})

describe('callback and deployment boundaries', () => {
  test.each([undefined, '', 'wrong'])('rejects Telegram secret %s before initializing bot', async header => {
    const initTelegramBot = vi.fn()
    const controller = new CallbackController({ initTelegramBot } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    const headers = header === undefined ? {} : { 'X-Telegram-Bot-Api-Secret-Token': header }
    const response = await controller.handlerTelegramCallback(
      { env: { TELEGRAM_WEBHOOK_SECRET: 'expected' } } as never,
      new Request('https://api.example/callback/telegram', { method: 'POST', headers })
    )
    expect(response.status).toBe(401)
    expect(initTelegramBot).not.toHaveBeenCalled()
  })

  test('fails closed when Telegram webhook secret is unconfigured', async () => {
    const initTelegramBot = vi.fn()
    const controller = new CallbackController({ initTelegramBot } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never)
    expect((await controller.handlerTelegramCallback(context, jsonRequest({}))).status).toBe(401)
    expect(initTelegramBot).not.toHaveBeenCalled()
  })

  test('only the supported Stripe callback is public', () => {
    expect(isWhitelisted('/callback/stripe')).toBe(true)
    expect(isWhitelisted('/callback/stripe_connect')).toBe(false)
    expect(isWhitelisted('/callback/stripe_forged')).toBe(false)
  })

  test('browser deployment has no public or preview routes', () => {
    for (const config of [workerConfig(readConfig(CONFIG_TEMPLATE), 'browser')]) {
      expect(config.workers_dev).toBe(false)
      expect(config.preview_urls).toBe(false)
      expect(config.routes).toEqual([])
      expect(config.compatibility_flags).toContain('global_fetch_strictly_public')
    }
  })

  test('generated Reader routes contain no Note login controller', () => {
    const router = readFileSync(new URL('../../../src/di/generated/readerRouter.ts', import.meta.url), 'utf8')
    expect(router).not.toContain('SlaxNoteController')
    expect(router).not.toContain('/v1/user/sessions')
    expect(router).not.toContain('/v1/user/silent/sessions')
  })
})
