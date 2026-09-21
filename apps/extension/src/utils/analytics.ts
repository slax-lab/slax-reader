import { getCurrentSessionToken, getExtensionEventHeaders } from './session'
import type { ExtensionAnalyticsEvent } from '@commons/types/analytics'

/**
 * Extension端埋点上报函数
 *
 * @param params - 埋点事件参数
 */
export const trackEvent = (params: ExtensionAnalyticsEvent): void => {
  try {
    const { event, ...restParams } = params
    const enrichedParams = {
      ...restParams,
      platform: 'extension',
      version: process.env.VERSION || 'unknown'
    }

    console.log('[Extension Analytics]', event, enrichedParams)
    analytics.track(event, enrichedParams as Record<string, string>)
  } catch (error) {
    console.error('[Extension Analytics] Track error:', error, params)
  }
}

// Keep the legacy channel (trackEvent, above) separate from registered first-party events (eventLog, below).
export const eventLog = async (event: { event_name: string; occurred_at?: string; properties?: Record<string, unknown> }): Promise<void> => {
  const occurredAt = event.occurred_at || new Date().toISOString()
  try {
    const [token, context] = await Promise.all([getCurrentSessionToken(), getExtensionEventHeaders()])
    const base = String(process.env.EXTENSIONS_API_BASE_URL || '').replace(/\/$/, '')
    if (!base.startsWith('http')) return
    await fetch(`${base}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...context, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: JSON.stringify({
        events: [
          {
            event_name: event.event_name,
            occurred_at: occurredAt,
            properties: { ...event.properties, platform: 'extension', locale: context['X-CLIENT-LOCALE'], client_version: context['X-CLIENT-VERSION'] }
          }
        ]
      })
    })
  } catch (error) {
    console.error('[events] extension submission failed:', error)
  }
}
