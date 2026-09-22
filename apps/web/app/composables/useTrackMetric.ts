import { haveRequestToken } from '~/utils/request'

import { type MetricActionType, RESTMethodPath } from '@commons/types'

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
