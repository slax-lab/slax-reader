import { getClientEventHeaders, getUserToken } from '~/utils/request'

import type { WebAnalyticsEvent } from '@commons/contracts/analytics'

type FirstPartyEvent = {
  event_name: string
  occurred_at?: string
  properties?: Record<string, unknown>
}

export const eventLog = (event: FirstPartyEvent) => {
  if (!import.meta.client) return

  const config = useRuntimeConfig()
  const endpoint = `${String(config.public.DWEB_API_BASE_URL || '').replace(/\/$/, '')}/events`
  if (!endpoint.startsWith('http')) return
  const headers: Record<string, string> = { 'content-type': 'application/json', ...getClientEventHeaders() }
  const token = getUserToken()
  if (token) headers.Authorization = `Bearer ${token}`
  void fetch(endpoint, {
    method: 'POST',
    headers,
    keepalive: true,
    body: JSON.stringify({
      events: [
        {
          event_name: event.event_name,
          occurred_at: event.occurred_at ?? new Date().toISOString(),
          properties: {
            ...(event.properties ?? {}),
            platform: 'web',
            locale: headers['X-CLIENT-LOCALE'],
            client_version: headers['X-CLIENT-VERSION']
          }
        }
      ]
    })
  }).catch(() => {})
}

export const analyticsLog = (params: WebAnalyticsEvent) => {
  try {
    const config = useRuntimeConfig()
    const { proxy } = useScriptGoogleTagManager()

    const { event, ...restParams } = params
    const enrichedParams = {
      ...restParams,
      platform: 'web',
      version: config.public.appVersion || 'unknown'
    }

    proxy.dataLayer.push({
      event,
      ...enrichedParams
    })
  } catch (error) {
    console.error('[Analytics] Track error:', error, params)
  }
}
