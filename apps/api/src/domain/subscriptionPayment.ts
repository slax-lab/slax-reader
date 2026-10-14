import Stripe from 'stripe'
import { inject, injectable } from '../decorators/di'
import type { LazyInstance } from '../decorators/lazy'
import { StripeClient } from '../infra/external/stripe'
import { SubscriptionRepo, subscriptionInterval } from '../infra/repository/dbSubscription'

@injectable()
export class SubscriptionPaymentService {
  constructor(
    @inject(StripeClient) private stripeClient: LazyInstance<StripeClient>,
    @inject(SubscriptionRepo) private repo: SubscriptionRepo
  ) {}

  private reader(metadata: Stripe.Metadata | null | undefined) {
    return metadata?.platform === 'reader' && !metadata.collection_id && !metadata.owner_id
  }

  private id(value: string | { id: string } | null | undefined) {
    return typeof value === 'string' ? value : value?.id || ''
  }

  async handle(type: string, event: any): Promise<boolean> {
    const scope = `stripe:${event.livemode === true}:`
    if (['customer.subscription.updated', 'customer.subscription.created', 'customer.subscription.deleted'].includes(type)) {
      const key = `${scope}:state:${event.id}`
      for (let attempt = 0; attempt < 3; attempt++) {
        const state = await this.repo.getPaymentJob(key)
        const expectedRevision = (state?.payload as { revision?: string } | undefined)?.revision || null
        const latest = type === 'customer.subscription.deleted' ? event : await this.stripeClient().subscriptions.retrieve(event.id)
        const userId = Number(latest.metadata?.user_id)
        if (!this.reader(latest.metadata) || !Number.isSafeInteger(userId) || userId <= 0) {
          await this.repo.reconcilePayment(`ownership:${key}`, 'Subscription is not explicitly bound to Reader', { subscriptionId: event.id })
          return true
        }
        const sub = await this.repo.getUserSubscriptionInfo(userId)
        if (!sub || sub.stripe_customer_id !== this.id(latest.customer)) {
          await this.repo.reconcilePayment(`ownership:${key}`, 'Stripe customer binding missing or mismatched', { userId })
          return true
        }
        const result = await this.repo.writePaymentState({
          key,
          userId,
          provider: 'stripe',
          source: event.id,
          autoRenew: ['active', 'trialing'].includes(latest.status) && !latest.cancel_at_period_end,
          version: Number(event._paymentEventCreated || 0),
          eventId: event._paymentEventId || `${type}:${event.id}:${event._paymentEventCreated}`,
          deleted: type === 'customer.subscription.deleted',
          expectedRevision
        })
        if (result !== 'conflict') return true
      }
      throw new Error('Stripe subscription state changed during retrieval; retry event')
    }
    if (!['invoice.payment_succeeded', 'invoice.paid', 'payment_intent.succeeded', 'charge.refunded'].includes(type)) return false
    if (type === 'charge.refunded') {
      await this.refund(event, scope)
      return true
    }
    if (type === 'payment_intent.succeeded') {
      if (event.invoice) return true
      const userId = Number(event.metadata?.user_id)
      if (!this.reader(event.metadata) || !Number.isSafeInteger(userId) || userId <= 0) {
        await this.repo.reconcilePayment(`${scope}:pi:${event.id}`, 'Payment is not explicitly bound to Reader', { paymentIntent: event.id })
        return true
      }
      const price = await this.stripeClient().prices.retrieve(event.metadata.price_id)
      await this.repo.applyPaymentGrant({
        key: `${scope}:pi:${event.id}`,
        scope,
        userId,
        provider: 'stripe',
        source: event.id,
        amount: event.amount_received,
        interval: price.metadata.duration_type as subscriptionInterval,
        count: Number(price.metadata.duration),
        at: new Date(event.created * 1000),
        customerId: this.id(event.customer),
        currency: event.currency,
        autoRenew: false,
        telemetryType: 'once'
      })
      return true
    }
    if (!['subscription_create', 'subscription_cycle'].includes(event.billing_reason || '')) return true
    const metadata = event.subscription_details?.metadata
    const userId = Number(metadata?.user_id)
    const line = event.lines?.data?.[0]
    if (!this.reader(metadata) || !Number.isSafeInteger(userId) || userId <= 0 || !line?.price || event.lines.has_more || event.lines.data.length !== 1) {
      await this.repo.reconcilePayment(`${scope}:invoice:${event.id}`, 'Invoice Reader ownership or single entitlement line cannot be established', { invoiceId: event.id })
      return true
    }
    const interval = line.type === 'invoiceitem' ? subscriptionInterval.DAY : line.price.recurring?.interval
    const count = line.type === 'invoiceitem' ? Number(line.price.metadata?.trial_day) : line.price.recurring?.interval_count
    await this.repo.applyPaymentGrant({
      key: `${scope}:invoice:${event.id}`,
      scope,
      userId,
      provider: 'stripe',
      source: this.id(event.subscription),
      amount: event.amount_paid,
      interval,
      count,
      at: new Date(line.period.start * 1000),
      customerId: this.id(event.customer),
      currency: event.currency,
      nextInvoiceAt: new Date(line.period.end * 1000),
      autoRenew: true,
      telemetryType: event.billing_reason === 'subscription_create' ? 'initial_subscription' : 'auto_renewal'
    })
    return true
  }

  private async refund(charge: Stripe.Charge, scope: string) {
    const invoiceId = this.id(charge.invoice)
    const pi = this.id(charge.payment_intent)
    let metadata: Stripe.Metadata | null | undefined
    let source = pi
    if (invoiceId) {
      const invoice = await this.stripeClient().invoices.retrieve(invoiceId)
      if (invoice.amount_paid !== charge.amount || this.id(invoice.charge) !== charge.id || this.id(invoice.customer) !== this.id(charge.customer)) {
        await this.repo.reconcilePayment(`${scope}:refund:${charge.id}`, 'Invoice payment allocation cannot be reliably mapped to this charge', { invoiceId, chargeId: charge.id })
        return
      }
      metadata = invoice.subscription_details?.metadata
      source = this.id(invoice.subscription)
    } else if (pi) {
      const intent = await this.stripeClient().paymentIntents.retrieve(pi)
      if (this.id(intent.customer) !== this.id(charge.customer) || intent.amount_received !== charge.amount) {
        await this.repo.reconcilePayment(`${scope}:refund:${charge.id}`, 'Payment intent customer or amount mismatch', { paymentIntent: pi })
        return
      }
      metadata = intent.metadata
    }
    const userId = Number(metadata?.user_id)
    if (!this.reader(metadata) || !Number.isSafeInteger(userId) || userId <= 0 || (!invoiceId && !pi)) {
      await this.repo.reconcilePayment(`${scope}:refund:${charge.id}`, 'Refund is not explicitly bound to a Reader payment', { chargeId: charge.id })
      return
    }
    const refunds: { id: string; amount: number }[] = []
    for await (const refund of this.stripeClient().refunds.list({ charge: charge.id, limit: 100 })) {
      if (refund.status === 'succeeded') refunds.push({ id: refund.id, amount: refund.amount })
    }
    await this.repo.applyPaymentRefund({
      key: `${scope}:${invoiceId ? 'invoice' : 'pi'}:${invoiceId || pi}`,
      scope,
      customerId: this.id(charge.customer),
      userId,
      provider: 'stripe',
      source,
      total: charge.amount,
      cumulative: refunds.reduce((sum, item) => sum + item.amount, 0),
      refundIds: refunds
    })
  }

  async cancel(subscriptionId: string, reason: string, customerId?: string, liveMode?: boolean) {
    const current = await this.stripeClient().subscriptions.retrieve(subscriptionId)
    if (!this.reader(current.metadata) || (customerId && this.id(current.customer) !== customerId) || (liveMode !== undefined && current.livemode !== liveMode))
      throw new Error('Reader subscription ownership or mode mismatch')
    const binding = await this.repo.getUserSubscriptionInfo(Number(current.metadata.user_id))
    if (!binding || binding.stripe_customer_id !== this.id(current.customer)) throw new Error('Reader subscription customer mismatch')
    const key = await this.repo.createPaymentCommand(`stripe:${current.livemode}::cancel:${subscriptionId}`, {
      subscriptionId,
      reason,
      userId: Number(current.metadata.user_id),
      liveMode: current.livemode
    })
    await this.runOperation(key)
  }

  async runOperation(key: string) {
    const job = await this.repo.getPaymentJob(key)
    if (!job) throw new Error('Payment operation missing')
    if (job.status === 'reconciliation') throw new Error('Payment operation requires reconciliation')
    if (job.status === 'done') return
    const token = await this.repo.claimPaymentJob(key)
    if (!token) throw new Error('Payment operation is leased')
    if (Date.now() - job.created_at.getTime() >= 23 * 3600000) {
      await this.repo.parkPaymentJob(key, 'External operation exceeded Stripe idempotency retention safety window; confirm remotely before replay', token)
      throw new Error('Payment operation requires reconciliation')
    }
    try {
      const payload = job.payload as Record<string, any>
      if (job.kind === 'stripe_cancel') {
        await this.stripeClient().subscriptions.cancel(
          payload.subscriptionId,
          { invoice_now: false, prorate: false, cancellation_details: { comment: payload.reason } },
          { idempotencyKey: key }
        )
      } else if (job.kind === 'stripe_credit') {
        await this.stripeClient().customers.createBalanceTransaction(
          payload.customerId,
          { amount: payload.amount, currency: payload.currency, description: payload.description },
          { idempotencyKey: key }
        )
      } else throw new Error(`Unsupported payment operation ${job.kind}`)
      await this.repo.finishPaymentJob(key, token)
    } catch (error) {
      await this.repo.finishPaymentJob(key, token, String(error))
      throw error
    }
  }
}
