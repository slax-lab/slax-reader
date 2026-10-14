import { addDays, addMonths, addWeeks, addYears, addMinutes } from 'date-fns'
import { inject, singleton } from '../../decorators/di'
import { PRISIMA_HYPERDRIVE_CLIENT } from '../../const/symbol'
import type { LazyInstance } from '../../decorators/lazy'
import { PrismaClient as HyperdrivePrismaClient } from '@prisma/hyperdrive-client'

export enum subscriptionType {
  STRIPE = 1,
  STRIPE_TRIAL = 2,
  APPLE = 3,
  INVITE = 4,
  INVITE_CONSUMPTION = 5,
  STRIPE_ROLLBACK = 6,
  REDEEM_CODE = 7,
  REDEEM_CODE_CONSUMPTION = 8,
  APPLE_ROLLBACK = 9,
  GOOGLE = 10,
  GOOGLE_ROLLBACK = 11
}

export enum subscriptionInterval {
  DAY = 'day',
  WEEK = 'week',
  MONTH = 'month',
  YEAR = 'year',
  MINUTE = 'minute'
}

export interface subscriptionPeriod {
  id?: number
  user_id: number
  type: subscriptionType
  source: string
  interval: subscriptionInterval
  interval_count: number
  created_at: Date
}

export interface subscriptionPO {
  userId: number
  stripeCurrency?: string
  stripeSubId: string
  stripeCustomerId?: string
  endTime: Date
  nextInvoiceAt: Date
  autoRenew: boolean
  subscribed?: boolean
  stripeCredit?: number
  first_subscription_time?: Date
  sourceType: string
}

export enum receiveActivityType {
  PLATFORM_0527 = 'platform_0527',
  BLOGGER = 'blogger'
}

@singleton()
export class SubscriptionRepo {
  constructor(@inject(PRISIMA_HYPERDRIVE_CLIENT) private prismaPg: LazyInstance<HyperdrivePrismaClient>) {}

  async createSubscriptionEvent(eventId: string, eventType: string, eventData: string, previousData: string, liveMode: boolean, eventAccount: string) {
    const key = `stripe:${liveMode}:${eventAccount}:${eventId}`
    return this.prismaPg().$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
      const existing = await tx.sr_payment_job.findUnique({ where: { key } })
      if (existing) return tx.sr_stripe_event.findUniqueOrThrow({ where: { id: (existing.payload as { eventId: number }).eventId } })
      const event = await tx.sr_stripe_event.create({
        data: { event_data: eventData, event_id: eventId, event_type: eventType, event_account: eventAccount, live_mode: liveMode, previous_event_data: previousData || '{}' }
      })
      await tx.sr_payment_job.create({ data: { key, kind: 'stripe_event', payload: { eventId: event.id } } })
      return event
    })
  }

  async paymentTransaction<T>(userId: number, work: (repo: SubscriptionRepo, tx: import('@prisma/hyperdrive-client').Prisma.TransactionClient) => Promise<T>) {
    return this.prismaPg().$transaction(
      async tx => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(73181, ${userId}::integer)`
        await tx.$queryRaw`SELECT id FROM sr_user WHERE id = ${userId} FOR UPDATE`
        return work(new SubscriptionRepo((() => tx) as LazyInstance<HyperdrivePrismaClient>), tx)
      },
      { maxWait: 10000, timeout: 15000 }
    )
  }

  private async activePaymentUser(userId: number, key: string) {
    const user = await this.prismaPg().sr_user.findUnique({ where: { id: userId } })
    if (user && !user.deleted_at) return true
    await this.reconcilePayment(`inactive:${key}`, 'Payment user is missing or deleted; entitlement suppressed', { userId })
    return false
  }

  private retainedMinutes(minutes: number, amount: number, refunded: number) {
    if (![minutes, amount, refunded].every(Number.isSafeInteger) || minutes < 0 || amount < 0 || refunded < 0) throw new Error('Invalid payment arithmetic')
    return amount ? Number((BigInt(minutes) * BigInt(Math.max(0, amount - refunded))) / BigInt(amount)) : minutes
  }

  async writePaymentState(input: {
    key: string
    userId: number
    provider: 'stripe' | 'apple'
    source: string
    autoRenew: boolean
    version: number
    eventId: string
    deleted?: boolean
    expectedRevision?: string | null
  }) {
    return this.paymentTransaction(input.userId, async (repo, tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${input.key}, 0))`
      const state = await repo.getPaymentJob(input.key)
      const prior = state?.payload as { revision?: string; version: number; eventId: string; deleted?: boolean } | undefined
      if (input.expectedRevision !== undefined && (prior?.revision || null) !== input.expectedRevision) return 'conflict' as const
      if (prior && (prior.version > input.version || prior.eventId === input.eventId || (prior.deleted && !input.deleted))) return 'ignored' as const
      const { expectedRevision: _expectedRevision, ...data } = input
      const payload = { ...data, revision: crypto.randomUUID() }
      await tx.sr_payment_job.upsert({ where: { key: input.key }, create: { key: input.key, kind: 'payment_state', status: 'done', payload }, update: { payload } })
      if (!(await repo.activePaymentUser(input.userId, input.key))) return
      if (!input.autoRenew)
        await repo.enqueuePaymentJob(`telemetry:state:${input.key}:${input.eventId}`, 'payment_telemetry', {
          userId: input.userId,
          provider: input.key.startsWith('apple:') ? 'apple' : 'stripe',
          autoRenew: false,
          offer: false,
          action: input.deleted ? 'cancel' : 'auto_renew_off'
        })
      await tx.sr_user_subscription.updateMany({
        where: {
          user_id: input.userId,
          source_type: input.provider,
          ...(input.provider === 'stripe' ? { stripe_subscription_id: input.source } : { apple_original_transaction_id: input.source })
        },
        data: { auto_renew: input.autoRenew }
      })
    })
  }

  async applyPaymentGrant(input: {
    key: string
    userId: number
    provider: 'stripe' | 'apple'
    source: string
    amount: number
    interval: subscriptionInterval
    count: number
    at: Date
    customerId?: string
    currency?: string
    nextInvoiceAt?: Date
    autoRenew: boolean
    appleTransactionId?: string
    notificationType?: string
    consumeBonus?: boolean
    scope?: string
    telemetryType?: 'initial_subscription' | 'auto_renewal' | 'once'
  }) {
    if (
      !input.key ||
      !Number.isSafeInteger(input.userId) ||
      input.userId <= 0 ||
      !Number.isSafeInteger(input.amount) ||
      input.amount < 0 ||
      !Number.isFinite(input.count) ||
      input.count <= 0 ||
      !Number.isFinite(input.at.getTime())
    )
      throw new Error('Invalid payment grant')
    return this.paymentTransaction(input.userId, async (repo, tx) => {
      if (!(await repo.activePaymentUser(input.userId, input.key))) return null
      const scope = input.scope || input.key.slice(0, input.key.lastIndexOf(':'))
      if (input.provider === 'stripe' && input.customerId) {
        const binding = await repo.getUserSubscriptionInfo(input.userId)
        if (!binding || binding.stripe_customer_id !== input.customerId) {
          await repo.reconcilePayment(`ownership:${input.key}`, 'Stripe customer binding missing/mismatched', { userId: input.userId, customerId: input.customerId })
          return null
        }
      }
      let grant = await tx.sr_payment_grant.findUnique({ where: { key: input.key } })
      if (grant && grant.user_id !== input.userId) throw new Error('Payment grant owner mismatch')
      if (grant?.period_id || grant?.status === 'reconciliation') return repo.getUserSubscriptionInfo(input.userId)
      if (input.appleTransactionId && (await tx.sr_apple_transaction_processed.findUnique({ where: { transaction_id: input.appleTransactionId } }))) {
        await repo.reconcilePayment(input.key, 'Legacy Apple transaction requires entitlement reconciliation', {
          ...input,
          at: input.at.toISOString(),
          nextInvoiceAt: input.nextInvoiceAt?.toISOString() || ''
        })
        return repo.getUserSubscriptionInfo(input.userId)
      }
      const legacy = await tx.sr_user_subscription_period.findFirst({
        where: { user_id: input.userId, source: input.source, type: input.provider === 'apple' ? subscriptionType.APPLE : subscriptionType.STRIPE }
      })
      const cutover = await tx.sr_payment_job.findUnique({ where: { key: 'payment:cutover' } })
      if (legacy && cutover && legacy.created_at < cutover.created_at && input.at < cutover.created_at) {
        await repo.reconcilePayment(input.key, 'Historical grant cannot be reliably mapped', { source: input.source, userId: input.userId })
        return repo.getUserSubscriptionInfo(input.userId)
      }
      const current = await repo.getUserSubscriptionInfo(input.userId)
      const coverage = await tx.sr_payment_grant.aggregate({
        where: { user_id: input.userId, provider: 'apple', scope, revoked: false, minutes: { gt: 0 }, period_id: { not: null } },
        _max: { covered_end: true }
      })
      const previousAppleEnd = coverage._max.covered_end?.getTime() || 0
      if (input.provider === 'apple' && input.nextInvoiceAt && input.nextInvoiceAt.getTime() <= previousAppleEnd) return current
      const periods = await repo.getUserSubscriptionPeriod(input.userId)
      const start = input.provider === 'apple' ? new Date(Math.max(Date.now(), input.at.getTime())) : input.at
      const convertBonus = input.provider === 'stripe' && !!input.customerId
      if ((input.consumeBonus || convertBonus) && !grant?.revoked && !(input.amount > 0 && grant && grant.refunded >= input.amount)) {
        const bonuses = periods.filter(p => [subscriptionType.INVITE, subscriptionType.REDEEM_CODE].includes(p.type) && p.interval_count > 0)
        if (bonuses.length && periods.some(p => [subscriptionType.INVITE_CONSUMPTION, subscriptionType.REDEEM_CODE_CONSUMPTION].includes(p.type))) {
          await repo.reconcilePayment(`bonus:${input.key}`, 'Legacy unlinked bonus consumption requires reconciliation', { userId: input.userId })
        } else {
          const before = this.projectPaymentPeriods([...periods]).getTime()
          for (const bonus of bonuses) {
            await repo.enqueuePaymentJob(`bonus:consumed:${bonus.id}`, 'bonus_consumption', {
              grantKey: input.key,
              periodId: bonus.id!,
              interval: bonus.interval,
              count: bonus.interval_count
            })
            await tx.sr_user_subscription_period.update({ where: { id: bonus.id }, data: { interval_count: 0 } })
            bonus.interval_count = 0
          }
          const removed = Math.max(0, Math.max(Date.now(), before) - Math.max(Date.now(), this.projectPaymentPeriods([...periods]).getTime()))
          if (convertBonus && removed > 0)
            await repo.enqueuePaymentJob(`${scope}:credit:bonus:${input.key}`, 'stripe_credit', {
              customerId: input.customerId!,
              amount: -Math.ceil((599 * removed) / (30 * 86400000)),
              currency: 'usd',
              description: 'Bonus Day'
            })
        }
        if (input.consumeBonus)
          await tx.sr_user_receive_activity_record.upsert({
            where: { user_id_activity_type: { user_id: input.userId, activity_type: receiveActivityType.PLATFORM_0527 } },
            create: { user_id: input.userId, activity_type: receiveActivityType.PLATFORM_0527 },
            update: {}
          })
      }
      const ends = { day: addDays, week: addWeeks, month: addMonths, year: addYears, minute: addMinutes }
      const add = ends[input.interval]
      if (!add) throw new Error('Invalid payment interval')
      let minutes = Math.floor((add(start, input.count).getTime() - start.getTime()) / 60000)
      if (input.provider === 'apple' && input.nextInvoiceAt) {
        minutes = Math.max(0, Math.floor((input.nextInvoiceAt.getTime() - Math.max(start.getTime(), previousAppleEnd)) / 60000))
      }
      grant = await tx.sr_payment_grant.upsert({
        where: { key: input.key },
        create: { key: input.key, scope, covered_end: input.nextInvoiceAt, user_id: input.userId, provider: input.provider, source: input.source, amount: input.amount, minutes },
        update: { amount: input.amount, minutes, scope, covered_end: input.nextInvoiceAt }
      })
      if (input.provider === 'stripe' && input.customerId && current?.stripe_credit && current.stripe_stripe_currency && !grant.revoked && grant.refunded < input.amount) {
        await repo.enqueuePaymentJob(`stripe:credit:return:${input.key}`, 'stripe_credit', {
          customerId: input.customerId,
          amount: current.stripe_credit,
          currency: current.stripe_stripe_currency,
          description: 'Credit Return'
        })
        await tx.sr_user_subscription.update({ where: { user_id: input.userId }, data: { stripe_credit: 0 } })
      }
      const retained = grant.revoked ? 0 : this.retainedMinutes(minutes, input.amount, grant.refunded)
      const period = await tx.sr_user_subscription_period.create({
        data: {
          user_id: input.userId,
          type: input.provider === 'apple' ? subscriptionType.APPLE : subscriptionType.STRIPE,
          source: input.key,
          interval: 'minute',
          interval_count: retained,
          created_at: start
        }
      })
      await tx.sr_payment_grant.update({ where: { key: input.key }, data: { period_id: period.id, status: 'applied' } })
      if (input.appleTransactionId)
        await tx.sr_apple_transaction_processed.create({
          data: { transaction_id: input.key, original_transaction_id: input.source, user_id: input.userId, notification_type: input.notificationType || '' }
        })
      const endTime = this.projectPaymentPeriods([...periods, period] as subscriptionPeriod[])
      await repo.enqueuePaymentJob(`notice:grant:${input.key}`, 'payment_notice', {
        channel: 'stripe',
        content: `Payment grant ${input.key} processed for user ${input.userId}; entitlement ends ${endTime.toISOString()}`
      })
      await repo.enqueuePaymentJob(`telemetry:grant:${input.key}`, 'payment_telemetry', {
        userId: input.userId,
        provider: input.provider,
        autoRenew: input.autoRenew,
        offer: !!input.consumeBonus,
        subscriptionType: input.telemetryType || (input.autoRenew ? 'auto_renewal' : 'initial_subscription')
      })
      if (!retained) {
        if (current) return current
        return repo.upsertUserSubscriptionRecord({
          userId: input.userId,
          stripeSubId: '',
          endTime: new Date(0),
          nextInvoiceAt: new Date(0),
          autoRenew: false,
          subscribed: false,
          sourceType: input.provider
        })
      }
      const state = await repo.getPaymentJob(`${scope}:state:${input.source}`)
      if (state) input.autoRenew = !!(state.payload as any).autoRenew
      const newer = !current || !input.nextInvoiceAt || input.nextInvoiceAt >= current.next_invoice_time
      if (input.provider === 'apple' && newer) {
        return repo.upsertUserAppleSubscription({
          userId: input.userId,
          originalTransactionId: input.source,
          endTime,
          nextInvoiceAt: input.nextInvoiceAt || endTime,
          autoRenew: input.autoRenew && !grant.revoked,
          subscribed: !grant.revoked
        })
      }
      if (current && !newer) return tx.sr_user_subscription.update({ where: { user_id: input.userId }, data: { subscription_end_time: endTime } })
      return repo.upsertUserSubscriptionRecord({
        userId: input.userId,
        stripeSubId: input.source,
        stripeCustomerId: input.customerId,
        stripeCurrency: input.currency,
        endTime,
        nextInvoiceAt: input.nextInvoiceAt || endTime,
        autoRenew: input.autoRenew && !grant.revoked,
        subscribed: !grant.revoked,
        sourceType: input.provider
      })
    })
  }

  private projectPaymentPeriods(periods: subscriptionPeriod[]) {
    let end = new Date(0)
    const adds = { day: addDays, week: addWeeks, month: addMonths, year: addYears, minute: addMinutes }
    for (const period of periods.sort((a, b) => a.created_at.getTime() - b.created_at.getTime() || (a.id || 0) - (b.id || 0))) {
      if (!period.interval_count) continue
      const add = adds[period.interval]
      if (!add) throw new Error('Invalid stored subscription interval')
      end = add(new Date(Math.max(end.getTime(), period.created_at.getTime())), period.interval_count)
    }
    return end
  }

  async applyPaymentRefund(input: {
    key: string
    userId: number
    provider: 'stripe' | 'apple'
    source: string
    total: number
    cumulative: number
    refundIds: { id: string; amount: number }[]
    revoked?: boolean
    scope?: string
    customerId?: string
  }) {
    if (!Number.isSafeInteger(input.total) || input.total < 0 || !Number.isSafeInteger(input.cumulative) || input.cumulative < 0) throw new Error('Invalid refund amount')
    return this.paymentTransaction(input.userId, async (repo, tx) => {
      let grant = await tx.sr_payment_grant.findUnique({ where: { key: input.key } })
      if (grant && grant.user_id !== input.userId) throw new Error('Refund owner mismatch')
      if (!grant)
        grant = await tx.sr_payment_grant.create({
          data: { key: input.key, scope: input.scope || '', user_id: input.userId, provider: input.provider, source: input.source, amount: input.total }
        })
      for (const refund of input.refundIds) {
        await tx.sr_payment_refund.upsert({
          where: { key: `${input.key}:${refund.id}` },
          create: { key: `${input.key}:${refund.id}`, grant_key: input.key, amount: refund.amount },
          update: {}
        })
      }
      const refunded = Math.min(grant.amount, Math.max(grant.refunded, input.cumulative))
      await tx.sr_payment_grant.update({ where: { key: input.key }, data: { refunded, revoked: grant.revoked || !!input.revoked } })
      if (!grant.period_id) {
        await repo.reconcilePayment(`refund:${input.key}`, 'Refund retained as tombstone; grant missing or historical mapping unavailable', {
          userId: input.userId,
          grantKey: input.key
        })
        return
      }
      if (!(await repo.activePaymentUser(input.userId, input.key))) return
      if (input.customerId && (await repo.getUserSubscriptionInfo(input.userId))?.stripe_customer_id !== input.customerId) {
        await repo.reconcilePayment(`ownership:${input.key}`, 'Refund customer binding mismatch', { userId: input.userId })
        return
      }
      const retained = grant.revoked || input.revoked ? 0 : this.retainedMinutes(grant.minutes, grant.amount, refunded)
      await tx.sr_user_subscription_period.update({ where: { id: grant.period_id }, data: { interval_count: retained } })
      const endTime = this.projectPaymentPeriods(await repo.getUserSubscriptionPeriod(input.userId))
      await tx.sr_user_subscription.updateMany({ where: { user_id: input.userId }, data: { subscription_end_time: endTime } })
      if (input.provider === 'apple') {
        const coverage = await tx.sr_payment_grant.aggregate({
          where: { user_id: input.userId, provider: 'apple', scope: grant.scope, revoked: false, minutes: { gt: 0 }, period_id: { not: null } },
          _max: { covered_end: true }
        })
        await tx.sr_user_subscription.updateMany({ where: { user_id: input.userId, source_type: 'apple' }, data: { next_invoice_time: coverage._max.covered_end || new Date(0) } })
      }
      await repo.enqueuePaymentJob(`telemetry:refund:${input.key}:${refunded}:${!!input.revoked}`, 'payment_telemetry', {
        userId: input.userId,
        provider: input.provider,
        autoRenew: false,
        offer: false,
        action: 'refund'
      })
    })
  }

  async claimReward(input: {
    userId: number
    key: string
    code?: string
    activity?: receiveActivityType
    activityId?: string
    interval: subscriptionInterval
    count: number
    credit: number
    liveMode?: boolean
  }) {
    return this.paymentTransaction(input.userId, async (repo, tx) => {
      if (!(await repo.activePaymentUser(input.userId, input.key))) return { credit: false, endTime: new Date(0).toISOString() }
      const existing = await repo.getPaymentJob(input.key)
      if (existing) return existing.payload as { credit: boolean; endTime: string }
      if (input.code) {
        const used = await tx.sr_user_redeem_code.updateMany({ where: { code: input.code, user_id: 0 }, data: { user_id: input.userId, updated_at: new Date() } })
        if (!used.count) throw new Error('REWARD_ALREADY_CLAIMED')
      }
      const sub = await repo.getUserSubscriptionInfo(input.userId)
      if (input.activity) {
        if (sub?.source_type === 'apple' && sub.subscription_end_time > new Date()) throw new Error('REWARD_ALREADY_CLAIMED')
        const prior = await tx.sr_user_receive_activity_record.findUnique({ where: { user_id_activity_type: { user_id: input.userId, activity_type: input.activity } } })
        if (prior) throw new Error('REWARD_ALREADY_CLAIMED')
        await tx.sr_user_receive_activity_record.create({
          data: { user_id: input.userId, activity_type: input.activity, metadata: input.activityId ? { koc: input.activityId } : {} }
        })
        if (input.activity === receiveActivityType.BLOGGER)
          await tx.sr_user_receive_activity_record.upsert({
            where: { user_id_activity_type: { user_id: input.userId, activity_type: receiveActivityType.PLATFORM_0527 } },
            create: { user_id: input.userId, activity_type: receiveActivityType.PLATFORM_0527 },
            update: {}
          })
      }
      const credit = !!sub?.stripe_customer_id && sub.source_type === 'stripe' && sub.subscription_end_time > new Date()
      let endTime = sub?.subscription_end_time || new Date(0)
      if (credit) {
        if (input.liveMode === undefined) throw new Error('Stripe reward mode must be explicit')
        await repo.enqueuePaymentJob(`stripe:${input.liveMode}::credit:${input.key}`, 'stripe_credit', {
          customerId: sub!.stripe_customer_id,
          amount: -input.credit,
          currency: 'usd',
          description: 'Subscription reward'
        })
      } else {
        await repo.createUserSubscriptionRecord(input.userId, subscriptionType.REDEEM_CODE, input.key, input.interval, input.count)
        endTime = this.projectPaymentPeriods(await repo.getUserSubscriptionPeriod(input.userId))
        if (sub) await tx.sr_user_subscription.update({ where: { user_id: input.userId }, data: { subscription_end_time: endTime } })
        else
          await repo.upsertUserSubscriptionRecord({
            userId: input.userId,
            stripeSubId: '',
            endTime,
            nextInvoiceAt: endTime,
            autoRenew: false,
            subscribed: false,
            sourceType: 'system'
          })
      }
      const payload = { credit, endTime: endTime.toISOString() }
      await tx.sr_payment_job.create({ data: { key: input.key, kind: 'reward', status: 'done', payload } })
      await repo.enqueuePaymentJob(`notice:${input.key}`, 'payment_notice', { channel: 'stripe', content: `Subscription reward ${input.key} applied for user ${input.userId}` })
      return payload
    })
  }

  async enqueuePaymentJob(key: string, kind: string, payload: import('@prisma/hyperdrive-client').Prisma.InputJsonValue) {
    return this.prismaPg().sr_payment_job.upsert({ where: { key }, create: { key, kind, payload }, update: {} })
  }

  async reconcilePayment(key: string, reason: string, payload: import('@prisma/hyperdrive-client').Prisma.InputJsonValue) {
    return this.prismaPg().sr_payment_job.upsert({ where: { key }, create: { key, kind: 'reconciliation', payload, status: 'reconciliation', error: reason }, update: {} })
  }

  async claimPaymentJob(key: string) {
    const token = crypto.randomUUID()
    const now = new Date()
    const result = await this.prismaPg().sr_payment_job.updateMany({
      where: { key, status: { in: ['pending', 'running'] }, OR: [{ lease_until: null }, { lease_until: { lt: now } }] },
      data: { status: 'running', lease_token: token, lease_until: new Date(now.getTime() + 300000), attempts: { increment: 1 }, updated_at: now }
    })
    return result.count ? token : null
  }

  async finishPaymentJob(key: string, token: string, error?: string) {
    await this.prismaPg().sr_payment_job.updateMany({
      where: { key, lease_token: token },
      data: { status: error ? 'pending' : 'done', error: error || '', lease_until: null, lease_token: null, updated_at: new Date() }
    })
  }

  async parkPaymentJob(key: string, error: string, token: string) {
    return this.prismaPg().sr_payment_job.updateMany({
      where: { key, status: 'running', lease_token: token },
      data: { status: 'reconciliation', error, lease_until: null, lease_token: null, updated_at: new Date() }
    })
  }

  async createPaymentCommand(base: string, payload: import('@prisma/hyperdrive-client').Prisma.InputJsonValue) {
    return this.prismaPg().$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${base}, 0))`
      const prior = await tx.sr_payment_job.findFirst({
        where: { key: { startsWith: `${base}:` }, kind: 'stripe_cancel', status: { not: 'done' } },
        orderBy: { created_at: 'desc' }
      })
      if (prior) return prior.key
      const key = `${base}:${crypto.randomUUID()}`
      await tx.sr_payment_job.create({ data: { key, kind: 'stripe_cancel', payload } })
      return key
    })
  }

  async getPaymentJob(key: string) {
    return this.prismaPg().sr_payment_job.findUnique({ where: { key } })
  }

  async pendingPaymentJobs() {
    return this.prismaPg().sr_payment_job.findMany({
      where: {
        kind: { in: ['stripe_event', 'apple_event', 'stripe_cancel', 'stripe_credit', 'payment_notice', 'payment_telemetry'] },
        status: { in: ['pending', 'running'] },
        OR: [{ lease_until: null }, { lease_until: { lt: new Date() } }]
      },
      orderBy: { updated_at: 'asc' },
      take: 100
    })
  }

  async getEventById(id: number) {
    return await this.prismaPg().sr_stripe_event.findFirst({
      where: { id }
    })
  }

  async getUserSubscriptionInfo(userId: number) {
    return await this.prismaPg().sr_user_subscription.findFirst({
      where: { user_id: userId }
    })
  }

  async getUserIdByStripeCustomerId(customerId: string): Promise<number | undefined> {
    if (!customerId) return undefined
    const res = await this.prismaPg().sr_user_subscription.findFirst({
      where: { stripe_customer_id: customerId },
      select: { user_id: true }
    })
    return res?.user_id
  }

  async hasActivePaymentGrant(key: string, userId: number) {
    const grant = await this.prismaPg().sr_payment_grant.findUnique({ where: { key } })
    const user = await this.prismaPg().sr_user.findUnique({ where: { id: userId } })
    return !!user && !user.deleted_at && grant?.user_id === userId && !grant.revoked && !!grant.period_id && grant.minutes > 0 && (grant.covered_end?.getTime() || 0) > Date.now()
  }

  async getUserSubscriptionInfoPO(userId: number): Promise<subscriptionPO | undefined> {
    const res = await this.getUserSubscriptionInfo(userId)
    if (!res) return undefined
    return {
      userId: res.user_id,
      stripeCurrency: res.stripe_stripe_currency,
      stripeSubId: res.stripe_subscription_id,
      stripeCustomerId: res.stripe_customer_id,
      first_subscription_time: res.first_subscription_time,
      endTime: res.subscription_end_time,
      nextInvoiceAt: res.next_invoice_time,
      autoRenew: res.auto_renew,
      sourceType: res.source_type
    }
  }

  async getUserSubscriptionPeriodBySubscriptionId(subId: string) {
    return await this.prismaPg().sr_user_subscription_period.findMany({
      where: { source: subId, type: subscriptionType.STRIPE },
      orderBy: { id: 'desc' }
    })
  }

  async createUserSubscriptionRecord(userId: number, type: subscriptionType, source: string, interval: subscriptionInterval, count: number) {
    return await this.prismaPg().sr_user_subscription_period.create({
      data: {
        user_id: userId,
        type,
        source,
        interval,
        interval_count: count
      }
    })
  }

  async createUserSubscriptionRecordAndGetAll(
    userId: number,
    type: subscriptionType,
    source: string,
    interval: subscriptionInterval,
    count: number
  ): Promise<subscriptionPeriod[]> {
    return await this.prismaPg().$transaction(async tx => {
      await tx.sr_user_subscription_period.create({
        data: {
          user_id: userId,
          type,
          source,
          interval,
          interval_count: count
        }
      })

      return (await tx.sr_user_subscription_period.findMany({
        where: { user_id: userId },
        orderBy: { id: 'asc' }
      })) as subscriptionPeriod[]
    })
  }

  async createUserSubscriptionRecordMany(data: subscriptionPeriod[]) {
    return await this.prismaPg().sr_user_subscription_period.createMany({
      data: data
    })
  }

  async upsertUserSubscriptionRecord(data: subscriptionPO) {
    const update = {
      stripe_customer_id: data.stripeCustomerId,
      stripe_stripe_currency: data.stripeCurrency,
      stripe_subscription_id: data.stripeSubId,
      first_subscription_time: !!data.first_subscription_time ? data.first_subscription_time : undefined,
      subscription_end_time: data.endTime,
      next_invoice_time: data.nextInvoiceAt,
      auto_renew: data.autoRenew,
      subscribed: data.subscribed,
      source_type: data.sourceType
    }
    return await this.prismaPg().sr_user_subscription.upsert({
      where: { user_id: data.userId },
      create: {
        source_type: data.sourceType,
        user_id: data.userId,
        first_subscription_time: new Date(),
        stripe_subscription_id: data.stripeSubId,
        stripe_customer_id: data.stripeCustomerId,
        subscription_end_time: data.endTime,
        auto_renew: data.autoRenew,
        stripe_stripe_currency: data.stripeCurrency,
        next_invoice_time: data.nextInvoiceAt,
        subscribed: data.subscribed ?? false,
        stripe_credit: data.stripeCredit
      },
      update
    })
  }

  async updateUserSubscriptionAutoRenew(userId: number, autoRenew: boolean) {
    return await this.prismaPg().sr_user_subscription.update({
      where: { user_id: userId },
      data: { auto_renew: autoRenew }
    })
  }

  async getUserSubscriptionPeriod(userId: number): Promise<subscriptionPeriod[]> {
    return (await this.prismaPg().sr_user_subscription_period.findMany({
      where: { user_id: userId },
      orderBy: { id: 'asc' }
    })) as subscriptionPeriod[]
  }

  async createAppleTransactionProcessed(params: { transactionId: string; originalTransactionId: string; userId: number; notificationType: string }): Promise<boolean> {
    try {
      await this.prismaPg().sr_apple_transaction_processed.create({
        data: {
          transaction_id: params.transactionId,
          original_transaction_id: params.originalTransactionId,
          user_id: params.userId,
          notification_type: params.notificationType
        }
      })
      return true
    } catch (error) {
      if ((error as { code?: string }).code !== 'P2002') throw error
      return false
    }
  }

  async upsertUserSubscription(userId: number, customerId: string) {
    const defaultTime = new Date(0)
    return await this.prismaPg().sr_user_subscription.upsert({
      where: { user_id: userId },
      create: {
        user_id: userId,
        source_type: '',
        first_subscription_time: defaultTime,
        stripe_customer_id: customerId,
        subscription_end_time: defaultTime,
        next_invoice_time: defaultTime
      },
      update: {
        stripe_customer_id: customerId
      }
    })
  }

  async createInviteRecord(userId: number, inviteUserId: number, code: string) {
    return await this.prismaPg().sr_user_invite.create({
      data: {
        user_id: userId,
        invite_user_id: inviteUserId,
        code,
        source: 'invite',
        is_valid: true,
        created_at: new Date()
      }
    })
  }

  async updateUserSubscriptionCredit(userId: number, credit: number) {
    return await this.prismaPg().sr_user_subscription.update({
      where: { user_id: userId },
      data: {
        stripe_credit: credit
      }
    })
  }

  async createRedeemCode(codes: { code: string; creator_id: number }[]) {
    return await this.prismaPg().sr_user_redeem_code.createMany({
      data: codes.map(item => {
        return {
          code: item.code,
          creator_id: item.creator_id,
          created_at: new Date()
        }
      })
    })
  }

  async useRedeemCode(userId: number, code: string) {
    try {
      return await this.prismaPg().sr_user_redeem_code.update({
        where: {
          code: code,
          user_id: 0
        },
        data: {
          user_id: userId,
          updated_at: new Date()
        }
      })
    } catch (error) {
      return undefined
    }
  }

  async hasReceivedAcitivityRecord(userId: number) {
    return (
      (await this.prismaPg().sr_user_receive_activity_record.findFirst({
        where: { user_id: userId }
      })) !== null
    )
  }

  async findReceiveActivityRecord(userId: number, activityType: receiveActivityType) {
    return await this.prismaPg().sr_user_receive_activity_record.findFirst({
      where: { user_id: userId, activity_type: activityType }
    })
  }

  async createReceiveActivityRecord(userId: number, activityType: receiveActivityType, inviteKoc?: string) {
    try {
      const metadata = inviteKoc ? JSON.stringify({ koc: inviteKoc }) : '{}'
      const result = await this.prismaPg().$queryRaw`
        INSERT INTO "sr_user_receive_activity_record" (user_id, activity_type, metadata)
        VALUES (${userId}, ${activityType}, ${metadata}::jsonb)
        ON CONFLICT (user_id, activity_type)
        DO NOTHING
        RETURNING *;
      `
      return Array.isArray(result) && result.length > 0 ? result[0] : null
    } catch (err) {
      console.error(`createReceiveActivityRecord error: ${err}`)
      return null
    }
  }

  async createAppleIAPNotificationEvent(params: {
    notificationUuid: string
    appAccountToken: string
    productId: string
    subType: string
    bundleId: string
    bundleVersion: string
    notificationEnv: string
    transactionInfo: string
    renewalInfo: string
  }) {
    return await this.prismaPg().sr_apple_notification_event.create({
      data: {
        notification_uuid: params.notificationUuid,
        app_account_token: params.appAccountToken,
        product_id: params.productId,
        sub_type: params.subType,
        bundle_id: params.bundleId,
        bundle_version: params.bundleVersion,
        notification_env: params.notificationEnv,
        transaction_info: params.transactionInfo,
        renewal_info: params.renewalInfo
      }
    })
  }

  async findAppleIAPNotificationEvent(appAccountToken: string, productId: string) {
    return await this.prismaPg().sr_apple_notification_event.findFirst({
      where: {
        app_account_token: appAccountToken,
        product_id: productId
      }
    })
  }

  async upsertUserAppleSubscription(params: {
    userId: number
    originalTransactionId: string
    endTime: Date
    nextInvoiceAt: Date
    autoRenew: boolean
    firstSubscriptionTime?: Date
    subscribed: boolean
  }) {
    return await this.prismaPg().sr_user_subscription.upsert({
      where: { user_id: params.userId },
      create: {
        user_id: params.userId,
        apple_original_transaction_id: params.originalTransactionId,
        source_type: 'apple',
        first_subscription_time: params.firstSubscriptionTime || new Date(),
        subscription_end_time: params.endTime,
        next_invoice_time: params.nextInvoiceAt,
        auto_renew: params.autoRenew,
        stripe_subscription_id: '',
        stripe_customer_id: '',
        stripe_stripe_currency: '',
        subscribed: params.subscribed
      },
      update: {
        apple_original_transaction_id: params.originalTransactionId,
        source_type: 'apple',
        first_subscription_time: params.firstSubscriptionTime,
        subscription_end_time: params.endTime,
        next_invoice_time: params.nextInvoiceAt,
        auto_renew: params.autoRenew,
        stripe_subscription_id: '',
        subscribed: params.subscribed
      }
    })
  }
}
