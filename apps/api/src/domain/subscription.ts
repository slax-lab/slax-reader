import Stripe from 'stripe'
import { ContextManager } from '@/utils/context'
import { subscriptionPeriod, SubscriptionRepo } from '../infra/repository/dbSubscription'
import { SaveStripeEventFail, StripeSignCheckFail } from '../const/err'
import { collectionSubscribePeriodPO } from '../infra/repository/dbCollection'
import { addDays, addWeeks, addMonths, addYears, max, addMinutes } from 'date-fns'
import type { LazyInstance } from '../decorators/lazy'
import { inject, injectable } from '../decorators/di'
import { processStripeEventMap } from './subscriptionMain'
import { StripeClient } from '../infra/external/stripe'
import { QueueClient } from '../infra/queue/queueClient'

export enum subscriptionCancelReason {
  CANCEL_RIGTH_NOW = '立即取消',
  CANCEL_AT_PERIOD_END = '周期结束时取消',
  PAID_FAILD = '支付失败',
  CYCLE_PERIOD_END = '系统自动取消',
  UNKNOWN = '未知取消原因'
}

export type SlaxEvent = Stripe.WebhookEndpointCreateParams.EnabledEvent | 'slax.event.invite'

export interface SlaxEventResult {
  push: {
    content: string
    bot: any
  }
  notification?: {
    type: 'subscribe' | 'cancel' | 'rollback'
    params: {
      [key: string]: string
    }
  }
}

@injectable()
export class SubscriptionService {
  constructor(
    @inject(StripeClient) private stripeClient: LazyInstance<StripeClient>,
    @inject(SubscriptionRepo) private subscriptionRepo: SubscriptionRepo,
    @inject(QueueClient) private queueClient: LazyInstance<QueueClient>
  ) {}

  /** 解密stripe回调事件 */
  public async decryptCallbackEvent(ctx: ContextManager, body: string, sign: string) {
    const stripe = await this.stripeClient()
    let eventRes: Stripe.Event | undefined
    try {
      eventRes = await stripe.webhooks.constructEventAsync(body, sign, ctx.env.STRIPE_CALLBACK_SECRET)
      if (eventRes.account) throw new Error('Connected-account events are unsupported')
      if (eventRes.type !== 'invoice.paid' && !processStripeEventMap.has(eventRes.type)) {
        console.log(`skip event type: ${eventRes.type}`)
        return
      }
    } catch (err) {
      if (err instanceof stripe.errors.StripeSignatureVerificationError) {
        console.log(`⚠️  Webhook signature verification failed, err: ${err.message}`)
        throw StripeSignCheckFail()
      }
      console.log(`⚠️  Webhook Error: ${err}`)
      throw StripeSignCheckFail()
    }

    try {
      const configured = (ctx.env as Env & { STRIPE_LIVE_MODE?: string }).STRIPE_LIVE_MODE
      if (configured !== 'true' && configured !== 'false') throw new Error('STRIPE_LIVE_MODE must explicitly be true or false')
      if (eventRes.livemode !== (configured === 'true')) throw new Error('Stripe event livemode mismatch')
      const object = eventRes.data.object as { metadata?: Record<string, string>; subscription_details?: { metadata?: Record<string, string> } }
      const metadata = object.subscription_details?.metadata || object.metadata
      const ownershipRequired = eventRes.type.startsWith('invoice.') || eventRes.type.startsWith('customer.subscription.') || eventRes.type === 'payment_intent.succeeded'
      if ((ownershipRequired && metadata?.platform !== 'reader') || metadata?.collection_id || metadata?.owner_id || (metadata?.platform && metadata.platform !== 'reader')) {
        await this.subscriptionRepo.reconcilePayment(`stripe:${eventRes.livemode}::rejected:${eventRes.id}`, 'Webhook is not explicitly a Reader payment', {
          eventId: eventRes.id,
          eventType: eventRes.type
        })
        return
      }
      const obj = JSON.stringify({ ...eventRes.data.object, _paymentEventCreated: eventRes.created, _paymentEventId: eventRes.id })
      const previous = JSON.stringify(eventRes.data.previous_attributes)
      const res = await this.subscriptionRepo.createSubscriptionEvent(eventRes.id, eventRes.type, obj, previous, eventRes.livemode, eventRes.account || '')
      await this.queueClient().pushStripeEvent(res.id)
    } catch (err) {
      console.error(`save stripe event failed: ${JSON.stringify(err)}`)
      throw SaveStripeEventFail()
    }
  }

  public async getEventById(eventId: number) {
    return await this.subscriptionRepo.getEventById(eventId)
  }

  public static calculationExpiredTimeByEntity = (subscriptions: subscriptionPeriod[] | collectionSubscribePeriodPO[]) => {
    subscriptions.sort((a, b) => a.created_at.getTime() - b.created_at.getTime())
    let currentExpirationDate = new Date(subscriptions[0].created_at)
    for (const sub of subscriptions) {
      let nextExpiration: Date

      const startDate = max([currentExpirationDate, sub.created_at])

      switch (sub.interval) {
        case 'minute':
          nextExpiration = addMinutes(startDate, sub.interval_count)
          break
        case 'day':
          nextExpiration = addDays(startDate, sub.interval_count)
          break
        case 'week':
          nextExpiration = addWeeks(startDate, sub.interval_count)
          break
        case 'month':
          nextExpiration = addMonths(startDate, sub.interval_count)
          break
        case 'year':
          nextExpiration = addYears(startDate, sub.interval_count)
          break
        default:
          throw new Error(`Invalid interval: ${sub}`)
      }
      currentExpirationDate = nextExpiration
    }

    return currentExpirationDate
  }
}
