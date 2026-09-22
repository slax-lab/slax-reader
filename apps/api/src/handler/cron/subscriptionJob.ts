import { ContextManager } from '@/utils/context'
import { inject, injectable } from '../../decorators/di'
import { Scheduled } from '../../decorators/scheduled'
import { SubscriptionOrchestrator } from '../../domain/orchestrator/subscription'
import { SubscriptionAppleService } from '../../domain/subscriptionApple'
import { SubscriptionRepo } from '../../infra/repository/dbSubscription'

@injectable()
export class SubscriptionJob {
  constructor(
    @inject(SubscriptionOrchestrator) private subscriptions: SubscriptionOrchestrator,
    @inject(SubscriptionAppleService) private apple: SubscriptionAppleService,
    @inject(SubscriptionRepo) private repo: SubscriptionRepo
  ) {}

  @Scheduled('*/5 * * * *')
  public async recoverPayments(ctx: ContextManager) {
    await this.subscriptions.recover(ctx)
    for (const job of await this.repo.pendingPaymentJobs()) {
      if (job.kind !== 'apple_event') continue
      try {
        await this.apple.recoverAppleEvent(ctx.env, job.key)
      } catch (error) {
        console.error('Apple recovery failed', job.key, error)
      }
    }
  }
}
