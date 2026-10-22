import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { GA4AnalyticsClient } from '../../src/infra/external/ga4Analytics'
import { SlaxAlertBotClient } from '../../src/infra/external/slaxAlertBot'

const fetchMock = vi.fn()
const bots = ['stripe', 'report', 'error', 'crawl'] as const

beforeEach(() => {
  fetchMock.mockReset().mockImplementation(async () => new Response('{}'))
  vi.stubGlobal('fetch', fetchMock)
  vi.spyOn(console, 'log').mockImplementation(() => {})
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('SlaxAlertBotClient', () => {
  test.each(['prod', 'beta', 'dev'])('未配置 %s 告警时四个入口均不外发', async runType => {
    const client = new SlaxAlertBotClient({ RUN_TYPE: runType } as Env)
    for (const bot of bots) await client[bot].pushMessage('private content')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
  })

  test('仅显式配置的通道发送，保留支付通知协议', async () => {
    const client = new SlaxAlertBotClient({ RUN_TYPE: 'prod', STRIPE_PUSH_API: 'https://alerts.example/stripe' } as Env)
    for (const bot of bots) await client[bot].pushMessage('payment notification')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe('https://alerts.example/stripe')
    expect(init.redirect).toBe('manual')
    expect(JSON.parse(init.body)).toEqual({ msgtype: 'markdown', markdown: { content: 'payment notification' } })
  })

  test('爬虫通道保留环境标签和卡片格式', async () => {
    const client = new SlaxAlertBotClient({ RUN_TYPE: 'beta', CRAWL_PUSH_API: 'https://alerts.example/crawl' } as Env)
    await client.crawl.pushMessage('Title\nContent')
    const body = JSON.parse(fetchMock.mock.calls[0][1].body)
    expect(body.msg_type).toBe('interactive')
    expect(body.card.header.title.content).toBe('Title 【BETA】')
    expect(body.card.elements[0].text.content).toBe('Content')
  })

  const notificationEnv = {
    RUN_TYPE: 'prod',
    STRIPE_PUSH_API: 'https://alerts.example/stripe',
    REPORT_PUSH_API: 'https://alerts.example/report',
    ERROR_LOG_PUSH_API: 'https://alerts.example/error',
    CRAWL_PUSH_API: 'https://alerts.example/crawl'
  } as Env

  test.each(bots)('%s sends using Workers-compatible manual redirects', async bot => {
    await new SlaxAlertBotClient(notificationEnv)[bot].pushMessage('Title\nContent')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(`https://alerts.example/${bot}`)
    expect(init).toMatchObject({ method: 'POST', redirect: 'manual', headers: { 'Content-Type': 'application/json' } })
    const body = JSON.parse(init.body)
    if (bot === 'stripe' || bot === 'error') expect(body).toEqual({ msgtype: 'markdown', markdown: { content: 'Title\nContent' } })
    else if (bot === 'report') expect(body.card.elements[0].text.content).toBe('Title\nContent')
    else expect(body.card.header.title.content).toBe('Title 【PROD】')
  })

  describe.each(bots)('%s HTTP failures', bot => {
    test.each([301, 302, 303, 307, 308, 400, 429, 500, 503])('rejects HTTP %s without forwarding or exposing private details', async status => {
      const response = new Response('private provider body', { status, headers: { Location: 'https://redirect.example/private' } })
      const cancel = vi.spyOn(response.body!, 'cancel')
      fetchMock.mockResolvedValueOnce(response)

      await expect(new SlaxAlertBotClient(notificationEnv)[bot].pushMessage('private message')).rejects.toEqual(new Error(`Alert webhook request failed (HTTP ${status})`))

      expect(fetchMock).toHaveBeenCalledTimes(1)
      expect(fetchMock.mock.calls[0][1].redirect).toBe('manual')
      expect(cancel).toHaveBeenCalledOnce()
      expect(console.log).not.toHaveBeenCalled()
    })
  })

  test('本地即使配置告警也不外发且不打印消息', async () => {
    const client = new SlaxAlertBotClient({ RUN_TYPE: 'dev', RUN_ENV: 'development', STRIPE_PUSH_API: 'https://alerts.example/stripe' } as Env)
    await client.stripe.pushMessage('private content')
    expect(fetchMock).not.toHaveBeenCalled()
    expect(console.log).not.toHaveBeenCalled()
  })

  test.each(['http://alerts.example', 'invalid', 'https://user:password@alerts.example'])('无效告警地址不会发送：%s', async url => {
    const client = new SlaxAlertBotClient({ RUN_TYPE: 'prod', STRIPE_PUSH_API: url } as Env)
    await expect(client.stripe.pushMessage('private content')).rejects.toThrow()
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('GA4AnalyticsClient', () => {
  test.each([{}, { GA4_MEASUREMENT_ID: 'G-TEST' }, { GA4_API_SECRET: 'test-secret' }, { GA4_MEASUREMENT_ID: ' ', GA4_API_SECRET: 'test-secret' }])(
    '缺少完整配置时所有入口均不外发',
    async config => {
      const client = new GA4AnalyticsClient({ RUN_TYPE: 'prod', ...config } as Env)
      await client.sendEvents({ client_id: '42', events: [{ name: 'purchase' }] })
      await client.trackEvent(42, 'purchase')
      await client.trackEvents(42, [{ name: 'purchase' }])
      expect(fetchMock).not.toHaveBeenCalled()
    }
  )

  test('显式配置 GA 后只使用配置的属性并编码参数', async () => {
    const client = new GA4AnalyticsClient({ RUN_TYPE: 'prod', GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 'test&secret' } as Env)
    await client.trackEvent(42, 'purchase', { value: 5 })
    const [url, init] = fetchMock.mock.calls[0]
    const target = new URL(url)
    expect(target.origin + target.pathname).toBe('https://www.google-analytics.com/mp/collect')
    expect(target.searchParams.get('measurement_id')).toBe('G-TEST')
    expect(target.searchParams.get('api_secret')).toBe('test&secret')
    expect(init.redirect).toBe('error')
    expect(JSON.parse(init.body).events[0]).toEqual({ name: 'purchase', params: { engagement_time_msec: 100, platform: 'backend', value: 5 } })
  })

  test('失败日志不输出携带 secret 的网络错误', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {})
    fetchMock.mockRejectedValue(new Error('https://example/?api_secret=private'))
    const client = new GA4AnalyticsClient({ GA4_MEASUREMENT_ID: 'G-TEST', GA4_API_SECRET: 'test-secret' } as Env)
    await client.trackEvent(42, 'purchase')
    expect(logger).toHaveBeenCalledWith('[GA4] Failed to send events')
  })
})
