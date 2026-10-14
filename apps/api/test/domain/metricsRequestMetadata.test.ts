import { describe, expect, test, vi } from 'vitest'

import { MetricsController } from '@/handler/http/metricsController'

describe('metrics request metadata', () => {
  test('writes standard request metadata into extra_data', async () => {
    const track = vi.fn().mockResolvedValue(undefined)
    const waitUntil = vi.fn()
    const controller = new MetricsController({} as never, { track } as never)
    const ctx = { getUserId: () => 7, execution: { waitUntil } }
    const request = new Request('https://reader-api.slax.dev/m', {
      headers: {
        'X-ACTION-TYPE': 'heartbeat',
        'X-CLIENT-TYPE': 'web',
        'X-CLIENT-VERSION': '1.0.0',
        'User-Agent': 'SlaxReader/1.0',
        Referer: 'https://reader.slax.dev/inbox'
      }
    })

    await controller.handleHeartbeatRequest(ctx as never, request)

    expect(track).toHaveBeenCalledWith(7, 'heartbeat', {
      platform: 'web',
      version: '1.0.0',
      user_agent: 'SlaxReader/1.0',
      referrer: 'https://reader.slax.dev/inbox'
    })
    expect(waitUntil).toHaveBeenCalledOnce()
  })
})
