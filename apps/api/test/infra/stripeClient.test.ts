import { describe, expect, test } from 'vitest'
import { StripeClient } from '@/infra/external/stripe'

describe('Stripe client mode from API key prefix', () => {
  test.each([
    ['sk_live_fake', true],
    ['rk_live_fake', true],
    ['sk_test_fake', false],
    ['rk_test_fake', false]
  ])('%s resolves liveMode=%s', (key, liveMode) => {
    const client = new StripeClient({ STRIPE_SECRET_KEY: key } as Env)
    expect(client.liveMode).toBe(liveMode)
  })
})
