/** Frontend-only storage keys. API routes live in @commons/contracts/const. */
enum LocalStorageKey {
  USER_TOKEN = 'local:token',
  ANALYTICS_ENABLED = 'local:analytics-enabled',
  USER_INFO = 'local:user_info',
  SIDE_BAR_TIPS = 'local:side_bar_tips',
  LOCAL_CONFIG = 'local:local_config',
  TABS_CONFIG_COLLECTION_EXISTS = 'local:tabs_config_collection_exists',
  TABS_CONFIG_HIGHLIGHT_EXISTS = 'local:tabs_config_highlight_exists',
  LAST_METRIC_TRACK_TIME = 'local:last_metric_track_time'
}

export { LocalStorageKey }
