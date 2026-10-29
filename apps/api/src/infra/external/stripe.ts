import Stripe from 'stripe'
import { singleton } from '../../decorators/di'

@singleton()
export class StripeClient extends Stripe {
  // Namespaces reward ledger keys; never gates webhook processing.
  readonly liveMode: boolean

  constructor(env: Env) {
    super(env.STRIPE_SECRET_KEY, {
      apiVersion: '2024-06-20',
      appInfo: {
        name: 'slax-reader',
        version: '0.0.2'
      },
      typescript: true,
      httpClient: Stripe.createFetchHttpClient()
    })
    this.liveMode = env.STRIPE_SECRET_KEY.startsWith('sk_live_') || env.STRIPE_SECRET_KEY.startsWith('rk_live_')
  }
}
