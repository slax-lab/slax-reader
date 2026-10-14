import { singleton } from '../../decorators/di'

const GA4_ENDPOINT = 'https://www.google-analytics.com/mp/collect'

export interface GA4EventParams {
  [key: string]: string | number | boolean | undefined
}

export interface GA4Event {
  name: string
  params?: GA4EventParams
}

export interface GA4Payload {
  client_id: string
  user_id?: string
  timestamp_micros?: number
  non_personalized_ads?: boolean
  events: GA4Event[]
}

@singleton()
export class GA4AnalyticsClient {
  private readonly debugMode: boolean
  private readonly url?: string

  constructor(env: Env) {
    this.debugMode = !['prod', 'beta'].includes(env.RUN_TYPE)
    const measurementId = env.GA4_MEASUREMENT_ID?.trim()
    const apiSecret = env.GA4_API_SECRET?.trim()
    if (measurementId && apiSecret) {
      const query = new URLSearchParams({ measurement_id: measurementId, api_secret: apiSecret })
      this.url = `${GA4_ENDPOINT}?${query}`
    }
  }

  async sendEvents(payload: GA4Payload): Promise<void> {
    if (!this.url) return
    try {
      const res = await fetch(this.url, {
        method: 'POST',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      await res.text()
    } catch {
      console.error('[GA4] Failed to send events')
    }
  }

  async trackEvent(userId: string | number, eventName: string, params?: GA4EventParams): Promise<void> {
    const clientId = String(userId)

    return this.sendEvents({
      client_id: clientId,
      user_id: clientId,
      events: [
        {
          name: eventName,
          params: {
            debug_mode: this.debugMode ? 1 : undefined,
            engagement_time_msec: 100,
            platform: 'backend',
            ...params
          }
        }
      ]
    })
  }

  async trackEvents(userId: string | number, events: GA4Event[]): Promise<void> {
    const clientId = String(userId)

    return this.sendEvents({
      client_id: clientId,
      user_id: clientId,
      events: events.map(event => ({
        ...event,
        params: {
          debug_mode: this.debugMode ? 1 : undefined,
          engagement_time_msec: 100,
          ...event.params
        }
      }))
    })
  }
}
