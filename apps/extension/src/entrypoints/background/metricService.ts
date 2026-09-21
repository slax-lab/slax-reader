import type { SessionService } from './sessionService'
import { request } from '@/bridge/request'
import { LocalStorageKey, type MetricActionType, RESTMethodPath } from '@commons/types-pro'

const CLIENT_TYPE_HEADER = 'extension'
const CLIENT_VERSION_HEADER = `${process.env.VERSION}`
const METRIC_THROTTLE_MS = 10 * 60 * 1000

const lastTrackTime = storage.defineItem<number | null>(LocalStorageKey.LAST_METRIC_TRACK_TIME, {
  defaultValue: null
})

export class MetricService {
  constructor(private sessionService: SessionService) {}

  async track(actionType: MetricActionType = 'heartbeat'): Promise<void> {
    if (!(await this.sessionService.hasSession())) return

    if (actionType === 'heartbeat') {
      const last = await lastTrackTime.getValue()
      if (last !== null && Date.now() - last < METRIC_THROTTLE_MS) {
        return
      }
    }

    try {
      await request.get({
        url: RESTMethodPath.DASHBOARD_METRIC,
        headers: {
          'X-ACTION-TYPE': actionType,
          'X-CLIENT-TYPE': CLIENT_TYPE_HEADER,
          'X-CLIENT-VERSION': CLIENT_VERSION_HEADER
        },
        errorInterceptors: () => {
          console.log('Failed to send metric.')
          return
        }
      })

      if (actionType === 'heartbeat') {
        await lastTrackTime.setValue(Date.now())
      }
    } catch {
      console.log('Failed to track metric.')
      return
    }
  }
}
