import { ContextManager } from '@/utils/context'
import { Consumer } from '../../decorators/queue'
import { inject, injectable } from '../../decorators/di'
import { SubscriptionOrchestrator } from '../../domain/orchestrator/subscription'

@injectable()
export class SubscriptionConsumer {
  constructor(@inject(SubscriptionOrchestrator) private subscriptionOrchestrator: SubscriptionOrchestrator) {}

  /**
   * 处理Stripe事件
   */
  @Consumer({ channel: 'slax-reader-parser-stripe' })
  @Consumer({ channel: 'slax-reader-parser-stripe-beta' })
  public async handleStripeEvent(ctx: ContextManager, message: { id: string; info: { eventId: number } }) {
    try {
      await this.subscriptionOrchestrator.processSubscription(ctx, message)
    } catch (err) {
      console.error(`handle stripe event failed: ${err}`)
      throw err
    }
  }
}
