import { inject, injectable } from '../decorators/di'
import { GA4AnalyticsClient } from '../infra/external/ga4Analytics'
import { SubscriptionRepo } from '../infra/repository/dbSubscription'
import { LogsService } from './logs'

export interface PaymentTelemetry {
  userId: number
  provider: string
  autoRenew: boolean
  offer: boolean
  subscriptionType?: string
  action?: string
}

@injectable()
export class SubscriptionTelemetryService {
  constructor(
    @inject(LogsService) private logs: LogsService,
    @inject(SubscriptionRepo) private repo: SubscriptionRepo,
    @inject(GA4AnalyticsClient) private ga4Client: GA4AnalyticsClient
  ) {}

  async deliver(key: string, payload: PaymentTelemetry) {
    const subscriptionType = payload.subscriptionType || (payload.autoRenew ? 'auto_renewal' : 'initial_subscription')
    const source = payload.provider === 'apple' ? 'apple_iap' : 'stripe'
    if (!(await this.repo.getPaymentJob(`ga:${key}`))) {
      await this.ga4Client.trackEvent(payload.userId, payload.action ? 'subscription_cancel_complete' : 'subscription_checkout_complete', {
        subscription_type: subscriptionType,
        offer_type: payload.offer ? 'trial_authorized' : 'standard',
        gateway: source,
        event_id: key
      })
    }
    if (!(await this.repo.getPaymentJob(`logs:${key}`))) {
      await this.logs.track(payload.userId, payload.action || 'subscribe', { status: 'success', source, subscription_type: subscriptionType, operation_key: key })
    }
  }
}
