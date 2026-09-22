import { receiveActivityType, subscriptionInterval } from '../infra/repository/dbSubscription'
import { differenceInDays, differenceInMilliseconds } from 'date-fns'
import Stripe from 'stripe'
import { ErrorParam, NotSubscriptionError, ReceiveActivityAlreadyReceivedError, SubscriptionNotExpired, UnknownStripePriceId, UserNotFoundError } from '../const/err'
import { SlaxEvent, SlaxEventResult, subscriptionCancelReason, SubscriptionService } from './subscription'
import { ISubDatabase, IUserDatabase } from '../infra/repository/interface'
import { ContextManager } from '@/utils/context'
import { inject, injectable } from '../decorators/di'
import type { LazyInstance } from '../decorators/lazy'
import { UserRepo } from '../infra/repository/dbUser'
import { SubscriptionRepo } from '../infra/repository/dbSubscription'
import { KVClient } from '../infra/repository/KVClient'
import { SlaxAlertBotClient } from '../infra/external/slaxAlertBot'
import { StripeClient } from '../infra/external/stripe'
import { RedeemCodeNotFoundOrUsedError } from '@/const/err'
import { i18n } from '@/const/i18n'
import moment from 'moment-timezone'
import { GA4AnalyticsClient } from '@/infra/external/ga4Analytics'
import { LogsService } from './logs'

export interface consumptionRecord {
  count: number
  remark: string
}

/** 兑换码赠送时长: 6个月 */
const REDEEM_CODE_INTERVAL = subscriptionInterval.MONTH
const REDEEM_CODE_INTERVAL_COUNT = 6
/** 兑换码等值credit: 5.99usd/月 × 6个月 */
const REDEEM_CODE_CREDIT = 599 * REDEEM_CODE_INTERVAL_COUNT

type EventHandler<T = any> = (this: SubscriptionServiceMain, event: T, previousEvent: string) => Promise<SlaxEventResult | undefined>

@injectable()
export class SubscriptionServiceMain {
  constructor(
    @inject(StripeClient) private stripeClient: LazyInstance<StripeClient>,
    @inject(KVClient) private kvClient: LazyInstance<KVClient>,
    @inject(UserRepo) private userRepo: UserRepo,
    @inject(SubscriptionRepo) private subscriptionRepo: SubscriptionRepo,
    @inject(SlaxAlertBotClient) private alertBot: SlaxAlertBotClient,
    @inject(GA4AnalyticsClient) private ga4Client: GA4AnalyticsClient,
    @inject(LogsService) private logsService: LogsService
  ) {}

  /** 收到订阅付款, 时机: 订阅第一次付款时/ 每次订阅续期时 / 如果订阅有试用期，则在试用期结束后的第一次付款时 */
  async subscriptionUpdate(event: Stripe.Invoice, previous?: string) {
    const { SubscriptionPaymentService } = await import('./subscriptionPayment')
    await new SubscriptionPaymentService(this.stripeClient, this.subscriptionRepo).handle('invoice.payment_succeeded', event)
    return undefined
  }

  /** 计算剩余赠送时长转换为credit */
  async calculationRemainingBonusDay(userId: number, subId: string) {
    await this.subscriptionRepo.reconcilePayment(`legacy:bonus:${userId}:${subId}`, 'Bonus consumption requires an associated payment grant', { userId, source: subId })
    return { count: 0, remark: '> 赠送时长仅在支付权益事务中转换' }
  }

  /** 消耗掉获赠的时长 */
  async consumptionInviteScripition(userId: number, subId: string): Promise<consumptionRecord> {
    return this.calculationRemainingBonusDay(userId, subId)
  }

  async readerOneTimeSubscription(event: Stripe.Charge, previous?: string) {
    return this.readerSubscriptionRefund(event, previous)
  }

  async readerSubscriptionRefund(event: Stripe.Charge, previous?: string) {
    const { SubscriptionPaymentService } = await import('./subscriptionPayment')
    await new SubscriptionPaymentService(this.stripeClient, this.subscriptionRepo).handle('charge.refunded', event)
    return undefined
  }

  async subscriptionRefundReader(event: Stripe.Charge, previous?: string): Promise<SlaxEventResult | undefined> {
    const customerId = typeof event.customer === 'string' ? event.customer : event.customer?.id || ''
    const invoiceId = typeof event.invoice === 'string' ? event.invoice : event.invoice?.id || ''
    const paymentIntentId = typeof event.payment_intent === 'string' ? event.payment_intent : event.payment_intent?.id || ''
    if (customerId && invoiceId) {
      return await this.readerSubscriptionRefund(event, previous)
    }
    if (customerId && paymentIntentId) {
      return await this.readerOneTimeSubscription(event, previous)
    }
  }

  async subscriptionRefund(event: Stripe.Charge, previous?: string) {
    return this.subscriptionRefundReader(event, previous)
  }

  /** 订单争议 **/
  async subscriptionCharge(event: Stripe.Charge, previous?: string) {
    return {
      push: {
        bot: this.alertBot.stripe.pushMessage,
        content: `⚠️用户${event.metadata.user_id}发起订单争议⚠️`
      }
    }
  }

  /** 用户支付失败 **/
  async customerPaymentFailed(event: Stripe.Charge, previous?: string) {
    if (!event.description?.includes('update')) return
    let payment = ''
    if (event.payment_method_details?.card) {
      payment = `${event.payment_method_details?.card?.brand}-${event.payment_method_details?.card?.network}-${event.payment_method_details?.card?.funding}`
    }
    return {
      push: {
        bot: this.alertBot.stripe.pushMessage,
        content: `😭😭😭 用户续订支付失败 😭😭😭
        > customer: ${event.customer}
        > 金额: ${event.amount / 100} ${event.currency.toUpperCase()}
        > failCode: ${event.failure_code}
        > failMsg: ${event.failure_message}
        > bankMsg: ${event.outcome?.network_status} - ${event.outcome?.reason}
        > sellerMsg: ${event.outcome?.type} - ${event.outcome?.seller_message}
        > riskLevel: ${event.outcome?.risk_level} - ${event.outcome?.risk_score}
        > payment: ${payment}
        > [点我查看](https://dashboard.stripe.com/events/${event.id})`
      }
    }
  }

  // 订阅支付失败
  async invoicePaymentFailed(event: Stripe.Invoice, previous?: string) {
    const billingReason = event.billing_reason || ''
    if (!['subscription_create', 'subscription_cycle'].includes(billingReason)) return

    const subType = billingReason === 'subscription_create' ? 'initial_subscription' : 'auto_renewal'

    let userId = parseInt(event.subscription_details?.metadata?.user_id || '0')
    if (userId < 1) {
      const customerId = typeof event.customer === 'string' ? event.customer : event.customer?.id || ''
      userId = (await this.subscriptionRepo.getUserIdByStripeCustomerId(customerId)) || 0
    }
    if (userId > 0) {
      await this.logsService.track(userId, 'subscribe', {
        status: 'failed',
        source: 'stripe',
        subscription_type: subType,
        fail_message: event.last_finalization_error?.message || undefined
      })
    }
  }

  /** 用户取消订阅 - 获取用户取消订阅原因 */
  getCancelReason(subscription: Stripe.Subscription): subscriptionCancelReason {
    if (subscription.status !== 'canceled') return subscriptionCancelReason.UNKNOWN
    if (subscription.current_period_end !== subscription.canceled_at) return subscriptionCancelReason.CANCEL_RIGTH_NOW
    if (subscription.current_period_end === subscription.canceled_at) return subscriptionCancelReason.CANCEL_AT_PERIOD_END
    return subscriptionCancelReason.UNKNOWN
  }

  /** 用户取消订阅 - 回滚订阅 */
  async customerCancelSubscriptionRollbackSubscription(databaseClass: ISubDatabase, subId: string): Promise<string> {
    await this.subscriptionRepo.reconcilePayment(`legacy:rollback:${subId}`, 'Subscription-chain rollback rejected; an invoice or payment intent and refund are required', {
      source: subId
    })
    return '> 订阅取消不回滚已支付权益；历史退款需要对账'
  }

  /** 用户取消订阅 - 检查到期时间 */
  async customerCancelSubscriptionCheckSubscriptionEndTime(event: Stripe.Subscription): Promise<string> {
    const userId = parseInt(event.metadata.user_id || '')
    if (!userId) {
      return `> 检查到期时间: 用户未找到, eventId: ${event.id}`
    }
    const user = await this.subscriptionRepo.getUserSubscriptionInfo(userId)
    if (!user) {
      return `> 检查到期时间: 用户未找到, eventId: ${event.id}`
    }
    const checkEndTime = Date.now() > user.subscription_end_time.getTime() / 1000
    if (checkEndTime) return `> 检查到期时间: ✅`
    return `> 检查到期时间: ❌
      > 当前到期时间: ${user.subscription_end_time.toISOString()}
      > 订阅到期时间: ${new Date(event.current_period_end * 1000).toISOString()}`
  }

  /** 用户取消订阅 - 转换credit */
  async customerCancelSubscriptionTransferCredit(event: Stripe.Subscription): Promise<string> {
    return '> Stripe credit保留在原客户账户，不因取消订阅清零'
  }

  /** 用户取消订阅 **/
  async customerCancelSubscription(event: Stripe.Subscription, previous?: string) {
    const { SubscriptionPaymentService } = await import('./subscriptionPayment')
    await new SubscriptionPaymentService(this.stripeClient, this.subscriptionRepo).handle('customer.subscription.deleted', event)
    return undefined
  }

  /** 用户订阅即将结束 **/
  async customerTrialWillEnd(event: Stripe.Subscription, previous?: string) {
    const userId = parseInt(event.metadata.user_id || '')
    const customerId = typeof event.customer === 'string' ? event.customer : event.customer?.id || ''
    const amount = (event.items.data[0].price.unit_amount ?? 0) / 100
    return {
      push: {
        bot: this.alertBot.stripe.pushMessage,
        content: `😁😁😁 试用订阅即将结束 😁😁😁
        > 用户: ${userId} (${customerId})
        > 订阅ID: ${event.id} 
        > 收款金额: ${amount} ${event.currency.toUpperCase()}
        > 收款日期: ${new Date(event.billing_cycle_anchor * 1000).toISOString()}
  
        💰💰💰 钱速来钱速来 💰💰💰`
      }
    }
  }

  /** 计算到期时间 */
  async calculationExpiredTime(database: ISubDatabase, userId: number): Promise<Date> {
    const subscriptions = await database.getUserSubscriptionPeriod(userId)
    if (!subscriptions || subscriptions.length < 1) {
      console.error(`calculation expired time failed: records not found`)
      return new Date()
    }
    return SubscriptionService.calculationExpiredTimeByEntity(subscriptions)
  }

  /** 非关注订阅变更 */
  async subscriptionChange(event: Stripe.Subscription, previous?: string) {
    const { SubscriptionPaymentService } = await import('./subscriptionPayment')
    await new SubscriptionPaymentService(this.stripeClient, this.subscriptionRepo).handle('customer.subscription.updated', event)
    return undefined
  }

  /** payment intent */
  async paymentIntentSucceeded(event: Stripe.PaymentIntent, previous?: string) {
    return this.processReaderPaymentIntentSuccess(event, previous)
  }

  async processReaderPaymentIntentSuccess(event: Stripe.PaymentIntent, previous?: string) {
    const { SubscriptionPaymentService } = await import('./subscriptionPayment')
    await new SubscriptionPaymentService(this.stripeClient, this.subscriptionRepo).handle('payment_intent.succeeded', event)
    return undefined
  }

  /** 即将下一次扣款 */
  async subscriptionUpcoming(event: Stripe.Invoice, previous?: string) {
    const subId = typeof event.subscription === 'string' ? event.subscription : event.subscription?.id || ''
    return {
      push: {
        bot: this.alertBot.stripe.pushMessage,
        content: `😁😁😁 用户${event.subscription_details?.metadata?.user_id}即将开始下一次扣款 😁😁😁
        > 订阅ID: ${subId}
        > 收款金额: ${event.total / 100}${event.currency.toUpperCase()}
        > 收款日期: ${new Date((event.next_payment_attempt ?? 0) * 1000).toISOString()}
        > 详情: ${event.lines.data[0].description}
        💰💰💰 钱速来钱速来 💰💰💰`
      }
    }
  }

  /** 价格变更 */
  async priceChange(event: Stripe.Price, previous?: string) {
    return await this.kvClient().kv.delete('stripe_price_' + (event as Stripe.Price).id)
  }

  /** 客户信息变更 */
  async customerUpdate(event: Stripe.Customer, previous?: string) {
    if (!previous || previous === '{}') return

    const prev = JSON.parse(previous)
    if (!prev || !prev.balance) return

    const userId = parseInt(event.metadata.user_id || '0')
    return {
      push: {
        bot: this.alertBot.stripe.pushMessage,
        content: `用户${userId} (${event.id}) credit变更
        > 客户名称: ${event.name} (${event.email})
        > 变更额度: ${(event.balance - prev.balance) / 100} ${event.currency?.toUpperCase() || '?'}
        > 变更前额度: ${prev.balance / 100} ${event.currency?.toUpperCase() || '?'}
        > 变更后额度: ${event.balance / 100} ${event.currency?.toUpperCase() || '?'}`
      }
    }
  }

  /** 构建支付链接参数 */
  buildSubscriptionPaymentParams(userId: number, price: Stripe.Price, isFisrtTrailed: boolean, remainingBonusDay: number): Stripe.PaymentLinkCreateParams {
    // TODO. i18N信息支持
    let trialDays = remainingBonusDay
    if (price.metadata && isFisrtTrailed && price.metadata.trial_day) {
      trialDays += parseInt(price.metadata.trial_day)
    }
    const params: Stripe.PaymentLinkCreateParams = {
      // 指定价格及产品
      line_items: [
        {
          price: price.id,
          quantity: 1
        }
      ],
      // 付款后不跳转，直接显示自定义消息
      after_completion: {
        type: 'hosted_confirmation',
        hosted_confirmation: {
          custom_message: 'Thank you for your purchase!'
        }
      },
      // 允许使用优惠码
      allow_promotion_codes: true,
      // 订阅信息
      subscription_data: {
        description: 'Monthly subscription',
        metadata: {
          user_id: userId,
          platform: 'reader',
          trial_days: trialDays,
          bonus_period: Math.ceil(remainingBonusDay / 7)
        },
        trial_period_days: isFisrtTrailed || remainingBonusDay > 0 ? trialDays : undefined,
        trial_settings:
          isFisrtTrailed || remainingBonusDay > 0
            ? {
                end_behavior: {
                  missing_payment_method: 'cancel'
                }
              }
            : undefined
      }
    }
    return params
  }

  /** 获取价格信息 */
  async getStripePrice(instance: Stripe, priceId: string): Promise<Stripe.Price> {
    const cache = await this.kvClient().kv.get('stripe_price_' + priceId)
    if (cache) return JSON.parse(cache)

    try {
      const price = await instance.prices.retrieve(priceId, {
        expand: ['currency_options']
      })
      if (!price) {
        console.error(`get stripe price failed: ${priceId}`)
        throw UnknownStripePriceId()
      }
      await this.kvClient().kv.put('stripe_price_' + priceId, JSON.stringify(price), { expirationTtl: 86400 })
      return price
    } catch (e) {
      console.error(`get stripe price failed: ${priceId}`)
      throw UnknownStripePriceId()
    }
  }

  /** 创建支付链接 */
  async createPaymentLink(ctx: ContextManager, priceId: string): Promise<string> {
    const subscriptionInfo = await this.subscriptionRepo.getUserSubscriptionInfo(ctx.getUserId())

    // 如果目前已有stripe订阅且未过期，则不允许发起新的订阅
    // 如果目前已有免费邀请的订阅且未到期，则把未使用部分天数转化为credit发放到客户余额
    let remainingBonusDay = 0
    if (subscriptionInfo && subscriptionInfo.subscription_end_time.getTime() > Date.now()) {
      if (subscriptionInfo.stripe_subscription_id !== '') {
        throw SubscriptionNotExpired()
      }
      const now = new Date()
      const diffInDays = differenceInDays(subscriptionInfo.subscription_end_time, now)
      const diffInMs = differenceInMilliseconds(subscriptionInfo.subscription_end_time, now)
      remainingBonusDay = diffInDays + (diffInMs > 0 ? 1 : 0)
    }

    // 是否第一次订阅
    const isFisrtTrailed = !subscriptionInfo || !subscriptionInfo.subscribed

    // 判断Prices的信息
    const client = await this.stripeClient()
    const price = await this.getStripePrice(client, priceId)
    if (!price) {
      console.error(`get stripe price failed: ${priceId}`)
      throw UnknownStripePriceId()
    }

    // 创建支付链接
    const params = this.buildSubscriptionPaymentParams(ctx.getUserId(), price, isFisrtTrailed, remainingBonusDay)
    try {
      const link = await client.paymentLinks.create(params)
      return link.url
    } catch (err) {
      console.error(`create payment link failed: ${JSON.stringify(err)}`)
      throw UnknownStripePriceId()
    }
  }

  /** 创建customer */
  async getOrCreateStripeCustomer(ctx: ContextManager, client: Stripe, subItf: ISubDatabase, userItf: IUserDatabase): Promise<string> {
    const subscriptionInfo = await subItf.getUserSubscriptionInfo(ctx.getUserId())

    // 如果当前存在正常的订阅，则直接报错
    if (subscriptionInfo && subscriptionInfo.stripe_subscription_id && subscriptionInfo.subscribed) {
      // 如果未过期则直接报错
      if (subscriptionInfo.subscription_end_time.getTime() > Date.now()) throw SubscriptionNotExpired()
      // 如果已过期则取消订阅
      await this.cancelSubscripiton(subscriptionInfo.stripe_customer_id, subscriptionInfo.stripe_subscription_id, 'Remove lapsed subscriptions')
    }

    if (subscriptionInfo && subscriptionInfo.stripe_customer_id) {
      return subscriptionInfo.stripe_customer_id
    }
    const user = await userItf.getInfoByUserId(ctx.getUserId())
    if (!user) throw UserNotFoundError()

    const customer = await client.customers.create({
      email: user.email,
      name: user.name,
      metadata: {
        user_id: ctx.getUserId()
      }
    })
    if (!customer || !customer.id) {
      console.error(`create stripe customer failed: ${JSON.stringify(customer)}`)
      throw UnknownStripePriceId()
    }
    await subItf.upsertUserSubscription(ctx.getUserId(), customer.id)
    return customer.id
  }

  async createOncePaymentIntent(ctx: ContextManager, priceId: string): Promise<string> {
    const client = await this.stripeClient()
    const userItf = this.userRepo
    const subItf = this.subscriptionRepo

    const customerId = await this.getOrCreateStripeCustomer(ctx, client, subItf, userItf)

    // 校验Prices后创建payment intent
    const prices = await this.getStripePrice(client, priceId)
    if (!prices) {
      console.error(`get stripe price failed: ${priceId}`)
      throw UnknownStripePriceId()
    }

    // 获取CNY的价格信息
    if (!prices.currency_options?.cny?.unit_amount) {
      console.error(`CNY price not found for price: ${priceId}`)
      throw UnknownStripePriceId()
    }

    const paymentIntent = await client.paymentIntents.create({
      amount: prices.currency_options.cny.unit_amount,
      currency: 'cny',
      customer: customerId,
      payment_method_types: ['card', 'alipay'],
      metadata: {
        user_id: ctx.getUserId(),
        platform: 'reader',
        price_id: priceId
      }
    })
    return paymentIntent.client_secret || ''
  }

  /** 创建支付意向 */
  async createPaymentIntent(ctx: ContextManager, oncePriceId: string, subPriceId: string): Promise<string> {
    // TODO 速率限制
    const client = await this.stripeClient()
    // 创建customer
    const subItf = this.subscriptionRepo
    const userItf = this.userRepo
    const customerId = await this.getOrCreateStripeCustomer(ctx, client, subItf, userItf)

    // 判断Prices的信息
    let price: Stripe.Price | null = null
    try {
      if (oncePriceId) {
        const priceRes = await this.getStripePrice(client, oncePriceId)
        if (!priceRes || !priceRes.unit_amount) {
          console.error(`get stripe price failed: ${oncePriceId}`)
          throw UnknownStripePriceId()
        }
        price = priceRes
      }
    } catch (err) {
      console.error(`get stripe price failed: ${oncePriceId}`)
      throw UnknownStripePriceId()
    }

    let sub: Stripe.Subscription
    const trial_period_days = !!price ? parseInt(price.metadata.trial_day || '0') : undefined

    try {
      sub = await client.subscriptions.create({
        customer: customerId,
        items: [{ price: subPriceId }],
        add_invoice_items: oncePriceId ? [{ price: oncePriceId }] : [],
        payment_behavior: 'default_incomplete',
        payment_settings: {
          save_default_payment_method: 'on_subscription',
          payment_method_types: ['card', 'link'],
          payment_method_options: {
            card: {
              request_three_d_secure: 'automatic'
            }
          }
        },
        metadata: {
          user_id: ctx.getUserId(),
          platform: 'reader'
        },
        trial_period_days,
        expand: ['latest_invoice.payment_intent'],
        off_session: true
      })
    } catch (e) {
      console.log(`create payment intent subscription fail: ${e}`)
      throw UnknownStripePriceId()
    }
    const pi = (sub.latest_invoice as Stripe.Invoice).payment_intent as Stripe.PaymentIntent
    if (!pi.client_secret) {
      console.log(`create payment intent subscription fail: ${JSON.stringify(sub)}`)
      throw UnknownStripePriceId()
    }
    return pi.client_secret
  }

  /** 发放免费天数 */
  async issuanceScripitionRecord(userId: number, inviteId: number, resId: string) {
    const reward = await this.subscriptionRepo.claimReward({ userId, key: `invite:${userId}:${resId}`, interval: subscriptionInterval.DAY, count: 7, credit: 0 })
    const subInfo = { subscription_end_time: new Date(reward.endTime) }
    return {
      push: {
        bot: this.alertBot.stripe.pushMessage,
        content: `🔥🔥🔥 免费订阅下发成功 🔥🔥🔥
      > 用户id: ${userId}
      > 被邀请人: ${inviteId}
      > 时长: 7${subscriptionInterval.DAY}
      > 到期时间: ${subInfo.subscription_end_time.toISOString()}`
      }
    }
  }

  /** 发放邀请好友奖励 */
  // async issuanceInviteGrant(event: { affCode: string; invitedUserId: number }, previous?: string) {
  //   const user = await this.userRepo.getInfo({ invite_code: event.affCode })
  //   if (user instanceof MultiLangError) return user
  //   if (!user || !user.id) {
  //     console.error(`issuance invite grant failed: user not found, affCode: ${event.affCode}, invitedUserId: ${event.invitedUserId}`)
  //     return
  //   }

  //   // 禁止左脚踩右脚
  //   if (user.id === event.invitedUserId) return

  //   // 保存邀请记录
  //   const res = await this.subscriptionRepo.createInviteRecord(user.id, event.invitedUserId, event.affCode)

  //   // 查询订阅
  //   const subInfo = await this.subscriptionRepo.getUserSubscriptionInfo(user.id)
  //   if (!subInfo || !subInfo.subscribed || !subInfo.stripe_subscription_id || !subInfo.stripe_customer_id) {
  //     await this.issuanceScripitionRecord(user.id, event.invitedUserId, res.id.toString())
  //     return
  //   }
  //   // await this.issuanceStripeCredit(user.id, subInfo.stripe_customer_id, subInfo.stripe_stripe_currency, `邀请好友${event.invitedUserId}`)
  // }

  /** 取消订阅 */
  async cancelSubscripiton(customerId: string, subscriptionId: string, cancelReason: string) {
    const { SubscriptionPaymentService } = await import('./subscriptionPayment')
    await new SubscriptionPaymentService(this.stripeClient, this.subscriptionRepo).cancel(subscriptionId, cancelReason, customerId)
  }

  /** 用户主动取消订阅 */
  public async cancelUserSubscription(ctx: ContextManager) {
    const subInfo = await this.subscriptionRepo.getUserSubscriptionInfo(ctx.getUserId())
    if (!subInfo || !subInfo.stripe_subscription_id || !subInfo.stripe_customer_id) {
      console.error(`cancel user subscription failed: subscription not found`)
      throw NotSubscriptionError()
    }
    if (!['true', 'false'].includes(ctx.env.STRIPE_LIVE_MODE || '')) throw new Error('Stripe deployment mode missing')
    const { SubscriptionPaymentService } = await import('./subscriptionPayment')
    await new SubscriptionPaymentService(this.stripeClient, this.subscriptionRepo).cancel(
      subInfo.stripe_subscription_id,
      'User-initiated unsubscription',
      subInfo.stripe_customer_id,
      ctx.env.STRIPE_LIVE_MODE === 'true'
    )
  }

  public async deliverPaymentNotice(channel: string, content: string) {
    if (!content) return
    await this.alertBot.stripe.pushMessage(content)
  }

  /** 处理stripe事件 */
  public async handleEvent(eventType: SlaxEvent, eventData: any, previousEvent?: any) {
    const { SubscriptionPaymentService } = await import('./subscriptionPayment')
    if (await new SubscriptionPaymentService(this.stripeClient, this.subscriptionRepo).handle(eventType, eventData)) return
    const handle = processStripeEventMap.get(eventType)
    if (handle) {
      return await handle.call(this, eventData, previousEvent)
    }
    console.log(`event type not found: ${eventType}`)
    return
  }

  public async checkReceiveStatus(ctx: ContextManager, activityType: string): Promise<boolean> {
    if (activityType !== receiveActivityType.PLATFORM_0527 && activityType !== receiveActivityType.BLOGGER) return false

    // 检查用户是否有 Apple IAP 订阅且在订阅期内，如果是则视为已领取
    const subInfo = await this.subscriptionRepo.getUserSubscriptionInfo(ctx.getUserId())
    if (subInfo && subInfo.subscription_end_time.getTime() > Date.now() && subInfo.source_type === 'apple') {
      return true
    }

    const res = await this.subscriptionRepo.findReceiveActivityRecord(ctx.getUserId(), activityType)
    return !!res
  }

  public async receiveSubscription(ctx: ContextManager, activityType: receiveActivityType, activityId?: string) {
    if (![receiveActivityType.PLATFORM_0527, receiveActivityType.BLOGGER].includes(activityType) || (activityType === receiveActivityType.BLOGGER && !activityId)) {
      throw ErrorParam()
    }
    const $i = i18n(ctx.getlang())
    const blogger = activityType === receiveActivityType.BLOGGER
    const key = `reward:activity:${ctx.getUserId()}:${activityType}`
    let result: { credit: boolean; endTime: string }
    try {
      result = await this.subscriptionRepo.claimReward({
        key,
        userId: ctx.getUserId(),
        activity: activityType,
        activityId,
        interval: subscriptionInterval.DAY,
        count: blogger ? 60 : 30,
        credit: blogger ? 1198 : 599,
        liveMode: ctx.env.STRIPE_LIVE_MODE === 'true' ? true : ctx.env.STRIPE_LIVE_MODE === 'false' ? false : undefined
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'REWARD_ALREADY_CLAIMED') throw ReceiveActivityAlreadyReceivedError()
      throw error
    }
    if (result.credit) {
      const { SubscriptionPaymentService } = await import('./subscriptionPayment')
      await new SubscriptionPaymentService(this.stripeClient, this.subscriptionRepo).runOperation(`stripe:${ctx.env.STRIPE_LIVE_MODE}::credit:${key}`)
      return {
        title: $i.receiveActivityToCreditTitle({}),
        message: $i.receiveActivityToCreditResult({ credit: `$${(blogger ? 1198 : 599) / 100}` }),
        subMessage: $i.receiveActivitySubMessage({})
      }
    }
    return { title: $i.receiveActivityTitle({}), message: $i.receiveActivityResult({ end_time: moment(result.endTime).format('YYYY-MM-DD') }), subMessage: '' }
  }

  public async redeemSubscription(ctx: ContextManager, code: string) {
    const key = `reward:redeem:${ctx.getUserId()}:${code}`
    let result: { credit: boolean; endTime: string }
    try {
      result = await this.subscriptionRepo.claimReward({
        key,
        userId: ctx.getUserId(),
        code,
        interval: REDEEM_CODE_INTERVAL,
        count: REDEEM_CODE_INTERVAL_COUNT,
        credit: REDEEM_CODE_CREDIT,
        liveMode: ctx.env.STRIPE_LIVE_MODE === 'true' ? true : ctx.env.STRIPE_LIVE_MODE === 'false' ? false : undefined
      })
    } catch (error) {
      if (error instanceof Error && error.message === 'REWARD_ALREADY_CLAIMED') throw RedeemCodeNotFoundOrUsedError()
      throw error
    }
    if (result.credit) {
      const { SubscriptionPaymentService } = await import('./subscriptionPayment')
      await new SubscriptionPaymentService(this.stripeClient, this.subscriptionRepo).runOperation(`stripe:${ctx.env.STRIPE_LIVE_MODE}::credit:${key}`)
    }
  }
}

export const processStripeEventMap = new Map<SlaxEvent, EventHandler>([
  // 取消订阅
  ['customer.subscription.deleted', SubscriptionServiceMain.prototype.customerCancelSubscription as EventHandler<Stripe.Subscription>],
  // 试用即将结束
  ['customer.subscription.trial_will_end', SubscriptionServiceMain.prototype.customerTrialWillEnd as EventHandler<Stripe.Subscription>],
  // 订阅变更
  ['customer.subscription.updated', SubscriptionServiceMain.prototype.subscriptionChange as EventHandler<Stripe.Subscription>],
  // 创建订阅
  ['customer.subscription.created', SubscriptionServiceMain.prototype.subscriptionChange as EventHandler<Stripe.Subscription>],
  // 订阅付款
  ['invoice.payment_succeeded', SubscriptionServiceMain.prototype.subscriptionUpdate as EventHandler<Stripe.Invoice>],
  // 退款
  ['charge.refunded', SubscriptionServiceMain.prototype.subscriptionRefund as EventHandler<Stripe.Charge>],
  // 付款失败
  ['charge.failed', SubscriptionServiceMain.prototype.customerPaymentFailed as EventHandler<Stripe.Charge>],
  // 支付失败
  ['invoice.payment_failed', SubscriptionServiceMain.prototype.invoicePaymentFailed as EventHandler<Stripe.Invoice>],
  // 订单争议
  ['charge.dispute.created', SubscriptionServiceMain.prototype.subscriptionCharge as EventHandler<Stripe.Charge>],
  // 即将下一次扣款
  ['invoice.upcoming', SubscriptionServiceMain.prototype.subscriptionUpcoming as EventHandler<Stripe.Invoice>],
  // 价格变更
  ['price.updated', SubscriptionServiceMain.prototype.priceChange as EventHandler<Stripe.Price>],
  ['price.deleted', SubscriptionServiceMain.prototype.priceChange as EventHandler<Stripe.Price>],
  // 客户变更
  ['customer.updated', SubscriptionServiceMain.prototype.customerUpdate as EventHandler<Stripe.Customer>],
  // 支付意向-付款成功
  ['payment_intent.succeeded', SubscriptionServiceMain.prototype.paymentIntentSucceeded as EventHandler<Stripe.PaymentIntent>]
])
