import { haveRequestToken } from '~/utils/request'

import { type MetricActionType } from '@commons/contracts/analytics'
import { RESTMethodPath } from '@commons/contracts/const'

export const useTrackMetric = () => {
  const config = useRuntimeConfig()

  const track = (actionType: MetricActionType) => {
    if (!haveRequestToken()) {
      return
    }

    request()
      .get({
        url: RESTMethodPath.DASHBOARD_METRIC,
        headers: {
          'X-ACTION-TYPE': actionType,
          'X-CLIENT-TYPE': 'web',
          'X-CLIENT-VERSION': config.public.appVersion as string
        },
        errorInterceptors: () => {
          return
        }
      })
      .catch(() => {})
  }

  return { track }
}
