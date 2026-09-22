import { haveRequestToken } from '~/utils/request'

import { RESTMethodPath } from '@commons/types'

const DASHBOARD_PATH_PREFIX = '/dashboard'
const ACTION_TYPE_HEADER = 'heartbeat'
const CLIENT_TYPE_HEADER = 'web'
const METRIC_THROTTLE_MS = 10 * 60 * 1000
const METRIC_LAST_TRACK_KEY = 'slax:last_metric_track_time'

const shouldTrackRoute = (path: string) => {
  return !path.startsWith(DASHBOARD_PATH_PREFIX)
}

const isThrottled = (): boolean => {
  const raw = localStorage.getItem(METRIC_LAST_TRACK_KEY)
  if (!raw) return false
  return Date.now() - Number(raw) < METRIC_THROTTLE_MS
}

const markTracked = () => {
  localStorage.setItem(METRIC_LAST_TRACK_KEY, String(Date.now()))
}

const trackMetric = async () => {
  if (!haveRequestToken()) {
    return
  }

  if (isThrottled()) {
    return
  }

  const config = useRuntimeConfig()

  await request().get({
    url: RESTMethodPath.DASHBOARD_METRIC,
    headers: {
      'X-ACTION-TYPE': ACTION_TYPE_HEADER,
      'X-CLIENT-TYPE': CLIENT_TYPE_HEADER,
      'X-CLIENT-VERSION': config.public.appVersion
    },
    errorInterceptors: () => {
      return
    }
  })

  markTracked()
}

export default defineNuxtPlugin(nuxtApp => {
  if (!import.meta.client) {
    return
  }

  let lastTrackedPath = ''

  const handleTrack = async (path: string) => {
    if (!shouldTrackRoute(path) || path === lastTrackedPath) {
      return
    }

    lastTrackedPath = path

    await nextTick()

    try {
      await trackMetric()
    } catch {
      return
    }
  }

  nuxtApp.hook('page:finish', () => handleTrack(useRoute().path))
})
