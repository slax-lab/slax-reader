import { inject, injectable } from '../../decorators/di'
import { SubscriptionServiceMain } from '../subscriptionMain'
import { ContextManager } from '@/utils/context'
import { SubscriptionService, SlaxEvent } from '../subscription'
import { SubscriptionRepo } from '../../infra/repository/dbSubscription'
import { SubscriptionPaymentService } from '../subscriptionPayment'
import { SubscriptionTelemetryService } from '../subscriptionTelemetry'

@injectable()
export class SubscriptionOrchestrator {
  constructor(
    @inject(SubscriptionServiceMain) private subscriptionServiceMain: SubscriptionServiceMain,
    @inject(SubscriptionService) private subscriptionService: SubscriptionService,
    @inject(SubscriptionRepo) private repo: SubscriptionRepo,
    @inject(SubscriptionPaymentService) private payments: SubscriptionPaymentService,
    @inject(SubscriptionTelemetryService) private telemetry: SubscriptionTelemetryService
  ) {}

  public async processSubscription(ctx: ContextManager, message: { id: string; info: { eventId: number } }) {
    const eventId = message.info.eventId
    const res = await this.subscriptionService.getEventById(eventId)
    if (!res) throw new Error('Stripe event not found')
    const key = `stripe:${res.live_mode}:${res.event_account}:${res.event_id}`
    await this.repo.enqueuePaymentJob(key, 'stripe_event', { eventId })
    const job = await this.repo.getPaymentJob(key)
    if (job?.status === 'done' || job?.status === 'reconciliation') return
    const token = await this.repo.claimPaymentJob(key)
    if (!token) throw new Error('Payment event is leased')
    try {
      const mode = (ctx.env as Env & { STRIPE_LIVE_MODE?: string }).STRIPE_LIVE_MODE
      if (res.event_account || !['true', 'false'].includes(mode || '') || res.live_mode !== (mode === 'true')) {
        await this.repo.parkPaymentJob(key, 'Non-Reader account or Stripe deployment mode mismatch', token)
        return
      }
      const eventData = { ...JSON.parse(res.event_data), livemode: res.live_mode, _paymentEventId: res.event_id }
      if (!(await this.payments.handle(res.event_type, eventData))) {
        const result = await this.subscriptionServiceMain.handleEvent(res.event_type as SlaxEvent, eventData, res.previous_event_data)
        if (result?.push) await this.repo.enqueuePaymentJob(`notice:${key}`, 'payment_notice', { channel: 'stripe', content: result.push.content })
      }
      await this.repo.finishPaymentJob(key, token)
    } catch (error) {
      await this.repo.finishPaymentJob(key, token, String(error))
      throw error
    }
  }

  public async recover(ctx: ContextManager) {
    for (const job of await this.repo.pendingPaymentJobs()) {
      try {
        if (job.kind === 'stripe_event') await this.processSubscription(ctx, { id: job.key, info: job.payload as { eventId: number } })
        else if (job.kind === 'stripe_cancel' || job.kind === 'stripe_credit') {
          const mode = ctx.env.STRIPE_LIVE_MODE
          const keyMode = /^stripe:(true|false):/.exec(job.key)?.[1] || /stripe:(true|false):/.exec(job.key)?.[1]
          if (!keyMode || keyMode !== mode) {
            const token = await this.repo.claimPaymentJob(job.key)
            if (token) await this.repo.parkPaymentJob(job.key, 'External operation deployment mode missing/mismatched', token)
            continue
          }
          await this.payments.runOperation(job.key)
        } else if (job.kind === 'payment_notice' || job.kind === 'payment_telemetry') {
          const token = await this.repo.claimPaymentJob(job.key)
          if (!token) continue
          try {
            const payload = job.payload as any
            if (job.kind === 'payment_notice') await this.subscriptionServiceMain.deliverPaymentNotice('stripe', payload.content)
            else await this.telemetry.deliver(job.key, payload)
            await this.repo.finishPaymentJob(job.key, token)
          } catch (error) {
            await this.repo.finishPaymentJob(job.key, token, String(error))
            throw error
          }
        }
      } catch (error) {
        console.error('Payment recovery failed', job.key, error)
      }
    }
  }
}
