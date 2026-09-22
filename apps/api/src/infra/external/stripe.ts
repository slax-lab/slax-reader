import Stripe from 'stripe'
import { singleton } from '../../decorators/di'

@singleton()
export class StripeClient extends Stripe {
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
  }
}
