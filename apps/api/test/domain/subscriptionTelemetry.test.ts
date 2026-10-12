import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { SubscriptionOrchestrator } from '@/domain/orchestrator/subscription'
import { LogsService } from '@/domain/logs'
import { SubscriptionServiceMain } from '@/domain/subscriptionMain'
import { SubscriptionPaymentService } from '@/domain/subscriptionPayment'
import { SubscriptionTelemetryService } from '@/domain/subscriptionTelemetry'
import { GA4AnalyticsClient } from '@/infra/external/ga4Analytics'
import { SlaxAlertBotClient } from '@/infra/external/slaxAlertBot'
import { SubscriptionRepo } from '@/infra/repository/dbSubscription'

const env = { RUN_TYPE: 'prod', STRIPE_LIVE_MODE: 'false', GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 'test-secret' } as Env
const payload = { userId: 7, provider: 'stripe', autoRenew: true, offer: false, subscriptionType: 'initial_subscription' }
const fetchMock = vi.fn()

function setup(config = env) {
  const insertLog = vi.fn().mockResolvedValue(undefined)
  const getPaymentJob = vi.fn().mockResolvedValue(null)
  const repo = { getPaymentJob, enqueuePaymentJob: vi.fn(), pendingPaymentJobs: vi.fn(), claimPaymentJob: vi.fn().mockResolvedValue('lease'), finishPaymentJob: vi.fn() }
  const telemetry = new SubscriptionTelemetryService(new LogsService({ insertLog } as never), repo as never, new GA4AnalyticsClient(config))
  const main = new SubscriptionServiceMain({} as never, {} as never, {} as never, repo as never, new SlaxAlertBotClient(config), {} as never, {} as never)
  const payments = new SubscriptionPaymentService({} as never, repo as never)
  const orchestrator = new SubscriptionOrchestrator(main, {} as never, repo as never, payments, telemetry)
  return { insertLog, repo, telemetry, orchestrator }
}

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => new Response(null, { status: 204 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('payment telemetry recovery', () => {
  test.each([
    ['stripe', 'initial_subscription', false, 'stripe'],
    ['stripe', 'auto_renewal', false, 'stripe'],
    ['stripe', 'once', false, 'stripe'],
    ['apple', 'initial_subscription', true, 'apple_iap']
  ])('preserves checkout event fields for %s %s', async (provider, subscriptionType, offer, gateway) => {
    const { telemetry, insertLog, repo } = setup()
    await telemetry.deliver('telemetry:grant:existing', { ...payload, provider, subscriptionType, offer })
    const [url, init] = fetchMock.mock.calls[0]
    expect(new URL(url).searchParams.get('measurement_id')).toBe('G-TEST')
    expect(init.redirect).toBe('error')
    expect(JSON.parse(init.body)).toEqual({
      client_id: '7',
      user_id: '7',
      events: [{ name: 'subscription_checkout_complete', params: { subscription_type: subscriptionType, offer_type: offer ? 'trial_authorized' : 'standard', gateway, event_id: 'telemetry:grant:existing', engagement_time_msec: 100, platform: 'backend' } }]
    })
    expect(insertLog).toHaveBeenCalledWith(7, 'subscribe', { status: 'success', source: gateway, subscription_type: subscriptionType, operation_key: 'telemetry:grant:existing' })
    expect(repo.enqueuePaymentJob).not.toHaveBeenCalled()
  })

  test.each(['cancel', 'auto_renew_off', 'refund'])('preserves existing action payload %s', async action => {
    const { telemetry, insertLog } = setup()
    await telemetry.deliver('telemetry:state:existing', { ...payload, action, autoRenew: false, subscriptionType: undefined })
    expect(JSON.parse(fetchMock.mock.calls[0][1].body).events[0]).toMatchObject({ name: 'subscription_cancel_complete', params: { subscription_type: 'initial_subscription', gateway: 'stripe' } })
    expect(insertLog).toHaveBeenCalledWith(7, action, expect.objectContaining({ status: 'success', subscription_type: 'initial_subscription' }))
  })

  test.each(['network', '503'])('GA %s failure does not block logs, pending completion or a financial event', async failure => {
    if (failure === 'network') fetchMock.mockRejectedValue(new Error('network failure'))
    else fetchMock.mockImplementation(async () => new Response('', { status: 503 }))
    const { orchestrator, repo, insertLog } = setup()
    repo.pendingPaymentJobs.mockResolvedValueOnce([{ key: 'telemetry:existing', kind: 'payment_telemetry', payload }, { key: 'stripe:false::evt_1', kind: 'stripe_event', payload: { eventId: 1 } }]).mockResolvedValue([])
    const event = { event_id: 'evt_1', live_mode: false, event_account: '', event_type: 'invoice.paid', event_data: JSON.stringify({ id: 'in_1', billing_reason: 'subscription_create', subscription_details: { metadata: { platform: 'reader', user_id: '7' } }, lines: { data: [{ price: { recurring: { interval: 'month', interval_count: 1 } }, period: { start: 1, end: 2 } }] } }), previous_event_data: '{}' }
    const applyPaymentGrant = vi.fn().mockResolvedValue(undefined)
    Object.assign(repo, { applyPaymentGrant })
    Object.assign(orchestrator, { subscriptionService: { getEventById: vi.fn().mockResolvedValue(event) } })
    await orchestrator.recover({ env } as never)
    await orchestrator.recover({ env } as never)
    expect(insertLog).toHaveBeenCalledTimes(1)
    expect(applyPaymentGrant).toHaveBeenCalledWith(expect.objectContaining({ key: 'stripe:false::invoice:in_1', userId: 7 }))
    expect(repo.finishPaymentJob.mock.calls).toEqual([['telemetry:existing', 'lease'], ['stripe:false::evt_1', 'lease']])
    expect(repo.enqueuePaymentJob.mock.calls).toEqual([['stripe:false::evt_1', 'stripe_event', { eventId: 1 }]])
  })

  test('log failure does not keep the nonfinancial job pending', async () => {
    const { orchestrator, repo, insertLog } = setup()
    insertLog.mockRejectedValue(new Error('logs unavailable'))
    repo.pendingPaymentJobs.mockResolvedValue([{ key: 'telemetry:existing', kind: 'payment_telemetry', payload }])
    await orchestrator.recover({ env } as never)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(repo.finishPaymentJob).toHaveBeenCalledWith('telemetry:existing', 'lease')
  })

  test.each([{}, { GA4_MEASUREMENT_ID: ' ' }, { GA4_MEASUREMENT_ID: 'G-TEST' }, { GA4_API_SECRET: 'test-secret' }])('unconfigured telemetry and notices are consumed without outgoing requests', async config => {
    const { orchestrator, repo, insertLog } = setup({ RUN_TYPE: 'prod', ...config } as Env)
    repo.pendingPaymentJobs.mockResolvedValue([{ key: 'telemetry:existing', kind: 'payment_telemetry', payload }, { key: 'notice:existing', kind: 'payment_notice', payload: { channel: 'stripe', content: 'existing message' } }])
    await orchestrator.recover({ env: config } as never)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(insertLog).toHaveBeenCalledTimes(1)
    expect(repo.finishPaymentJob.mock.calls).toEqual([['telemetry:existing', 'lease'], ['notice:existing', 'lease']])
  })

  test.each(['ga', 'logs', 'both'])('existing %s receipts suppress already delivered sinks without creating new receipts', async receipt => {
    const { orchestrator, repo, insertLog } = setup()
    repo.getPaymentJob.mockImplementation(async key => receipt === 'both' || key.startsWith(`${receipt}:`) ? { kind: 'telemetry_receipt' } : null)
    repo.pendingPaymentJobs.mockResolvedValue([{ key: 'telemetry:existing', kind: 'payment_telemetry', payload }])
    await orchestrator.recover({ env } as never)
    expect(fetchMock).toHaveBeenCalledTimes(receipt === 'logs' ? 1 : 0)
    expect(insertLog).toHaveBeenCalledTimes(receipt === 'ga' ? 1 : 0)
    expect(repo.finishPaymentJob).toHaveBeenCalledWith('telemetry:existing', 'lease')
    expect(repo.enqueuePaymentJob).not.toHaveBeenCalled()
  })

  test('existing notice content is delivered through the configured bot unchanged', async () => {
    const { orchestrator, repo } = setup({ ...env, STRIPE_PUSH_API: 'https://alerts.example/payment' })
    repo.pendingPaymentJobs.mockResolvedValue([{ key: 'notice:existing', kind: 'payment_notice', payload: { channel: 'stripe', content: 'existing payment notice' } }])
    await orchestrator.recover({ env } as never)
    expect(fetchMock.mock.calls[0][0]).toBe('https://alerts.example/payment')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ msgtype: 'markdown', markdown: { content: 'existing payment notice' } })
    expect(repo.finishPaymentJob).toHaveBeenCalledWith('notice:existing', 'lease')
  })

  test('pending repository query retains both telemetry and notice task kinds', async () => {
    const findMany = vi.fn().mockResolvedValue([])
    await new SubscriptionRepo((() => ({ sr_payment_job: { findMany } })) as never).pendingPaymentJobs()
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ kind: { in: expect.arrayContaining(['payment_telemetry', 'payment_notice']) }, status: { in: ['pending', 'running'] } }) }))
  })
})
