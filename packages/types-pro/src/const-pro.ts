// Paid-only endpoint / storage / metric constants relocated out of the
// OSS commons layer. Imported by fork business code in place of
// `@commons/types/const` whenever a paid endpoint or key is needed.
//
// Pattern: spread the upstream enum (TS enums compile to runtime objects,
// so spread works) into an `as const` object, then declare a same-name
// type alias so call sites still get literal-type narrowing.

import { LocalStorageKey as BaseLocalStorageKey, RESTMethodPath as BaseRESTMethodPath } from '@commons/types/const'

export { StatusCode } from '@commons/types/const'

export const RESTMethodPath = {
  ...BaseRESTMethodPath,
  SUBSCRIBE_REDEEM: '/v1/subscription/redeem',
  RECEIVE_SUBSCRIBE: '/v1/subscription/receive',
  GET_TABS_CONFIG: '/v1/user/setting/tabs_config',
  USER_API_KEYS: '/v1/user/api_keys',
  USER_API_KEY_ROLL: '/v1/user/roll',
  PROMOTION_BLOGGER_INFO: '/v1/promotion/blogger_info',
  PROMOTION_CHECK_RECEIVE: '/v1/promotion/check_receive',
  PROMOTION_RECEIVE: '/v1/promotion/receive',
  USER_INAPP_PURCHASE: '/v1/subscription/user_inapp_purchase',
  CREATE_INAPP_PURCHASE: '/v1/subscription/create_inapp_purchase',
  CREATE_SUBSCRIPTION: '/v1/subscription/create_subscription',
  CREATE_ONCE_SUBSCRIPTION: '/v1/subscription/create_once',
  CANCEL_SUBSCRIPTION: '/v1/subscription/cancel',
  COLLECT_OWNER_SHARE_SETTING: '/v1/collection/setting',
  COLLECT_MINE: '/v1/collection/mine',
  COLLECT_SUBSCRIBE: '/v1/collection/subscribe',
  COLLECT_SUBSCRIBED: '/v1/collection/subscribed',
  COLLECT_UNSUBSCRIBE: '/v1/collection/unsubscribe',
  COLLECT_DELETE_SUBSCRIBE: '/v1/collection/delete_subscribe',
  COLLECT_SUBSCRIBED_LIST: '/v1/collection/subscribed_list',
  COLLECT_OWNER_INFO: '/v1/collection/owner_info',
  COLLECT_BOOKMARK_DETAIL: '/v1/collection/bookmark',
  STRIPE_CONNECT: '/v1/user/setting/stripe_connect',
  STRIPE_CONNECT_LOGIN: '/v1/user/setting/stripe_login',
  DASHBOARD_ACCESS: '/m/dashboard',
  DASHBOARD_METRICS_OVERALL: '/m/dashboard/metrics_overall',
  DASHBOARD_METRICS_PLATFORM: '/m/dashboard/metrics_platform',
  DASHBOARD_METRICS_DAILY: '/m/dashboard/metrics_daily',
  DASHBOARD_VISIT_OVERVIEW: '/m/dashboard/visit_overview',
  DASHBOARD_TOP_ARTICLES: '/m/dashboard/top_articles',
  DASHBOARD_BOOKMARK_STEPS: '/m/dashboard/bookmark_steps',
  DASHBOARD_METRIC: '/m',
  SYNC_TOKEN: '/v1/sync/token',
  SYNC_CHANGES: '/v1/sync/changes'
} as const
export type RESTMethodPath = (typeof RESTMethodPath)[keyof typeof RESTMethodPath]

export const LocalStorageKey = {
  ...BaseLocalStorageKey,
  TABS_CONFIG_COLLECTION_EXISTS: 'local:tabs_config_collection_exists',
  TABS_CONFIG_HIGHLIGHT_EXISTS: 'local:tabs_config_highlight_exists',
  LAST_METRIC_TRACK_TIME: 'local:last_metric_track_time'
} as const
export type LocalStorageKey = (typeof LocalStorageKey)[keyof typeof LocalStorageKey]

export type MetricActionType = 'heartbeat' | 'ai_overview' | 'ai_summary'
