export const DIAGNOSTIC_ATTACHMENT_MAX_BYTES = 12 * 1024 * 1024
export const DIAGNOSTIC_MULTIPART_OVERHEAD_MAX_BYTES = 64 * 1024
export const DIAGNOSTIC_REQUEST_MAX_BYTES = DIAGNOSTIC_ATTACHMENT_MAX_BYTES + DIAGNOSTIC_MULTIPART_OVERHEAD_MAX_BYTES
export const DIAGNOSTIC_DOWNLOAD_TTL_SECONDS = 7 * 24 * 60 * 60
export const DIAGNOSTIC_RECENT_DAYS = 7
export const DIAGNOSTIC_EXPORT_LINE_MAX_BYTES = 4096
export const DIAGNOSTIC_CONTENT_TYPE = 'application/x-ndjson'
export const DIAGNOSTIC_REPORT_FIELD = 'report'
export const DIAGNOSTIC_FILE_FIELD = 'diagnostic_log'

export interface FeedbackReportRequest {
  content: string
  type: 'parse_error' | 'loss_function' | 'like' | 'bug' | 'other'
  platform: 'web' | 'app' | 'extension'
  entry_point: 'inbox' | 'bookmark_detail' | 'share' | 'collection' | 'original_website'
  bookmark_id?: number
  share_code?: string
  cb_id?: number
  collection_code?: string
  bookmark_uuid?: string
  environment?: string
  version?: string
  target_url?: string
  allow_follow_up?: boolean
  attach_diagnostic_log?: boolean
}

export type DiagnosticExportEvent =
  | 'snapshot'
  | 'app.launch'
  | 'auth.login'
  | 'auth.signout'
  | 'auth.reauth_required'
  | 'auth.refresh_failed'
  | 'account.delete'
  | 'log.dropped'
  | 'log.truncated'
  | 'share.start'
  | 'share.end'
export type DiagnosticValue = string | number | boolean | null | DiagnosticValue[] | { [key: string]: DiagnosticValue }
export type DiagnosticExportEntry = {
  v: 1
  ts: string
  event: DiagnosticExportEvent
} & { [key: string]: DiagnosticValue }
type ObjectValue = { [key: string]: unknown }
type CleanObject = { [key: string]: DiagnosticValue }
const object = (value: unknown): value is ObjectValue => !!value && typeof value === 'object' && !Array.isArray(value)
const timestamp = (value: unknown): value is string =>
  typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value))
const label = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z][A-Za-z0-9_.-]{0,99}$/.test(value) && !/[A-Za-z0-9_-]{40}/.test(value)
const version = (value: unknown): value is string => typeof value === 'string' && /^\d{1,8}(?:\.\d{1,8}){0,3}(?:[-+][A-Za-z0-9.-]{1,20})?$/.test(value)
const host = (value: unknown): value is string =>
  typeof value === 'string' && value.length <= 253 && /^(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/.test(value)
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
function scalar(out: CleanObject, input: ObjectValue, keys: string[], valid: (value: unknown) => boolean) {
  for (const key of keys) if (input[key] === null || valid(input[key])) out[key] = input[key] as DiagnosticValue
}
function choice(out: CleanObject, input: ObjectValue, key: string, values: readonly string[]) {
  if (input[key] === null || (typeof input[key] === 'string' && values.includes(input[key] as string))) out[key] = input[key] as string | null
}
function error(value: unknown): DiagnosticValue {
  if (!object(value)) return null
  const out: CleanObject = {}
  scalar(out, value, ['class', 'domain', 'underlyingDomain'], label)
  scalar(out, value, ['code', 'underlyingCode', 'streamDomain', 'streamCode', 'status'], finite)
  return out
}
function token(value: unknown): DiagnosticValue {
  if (!object(value) || typeof value.present !== 'boolean' || !Number.isSafeInteger(value.len) || (value.len as number) < 0) return null
  const out: CleanObject = { present: value.present, len: value.len as number }
  if (value.present && (value.len as number) > 4 && typeof value.tail4 === 'string' && /^[A-Za-z0-9_-]{4}$/.test(value.tail4)) out.tail4 = value.tail4
  return out
}
function http(value: unknown): DiagnosticValue {
  if (!object(value)) return null
  const out: CleanObject = {}
  scalar(out, value, ['status', 'code'], finite)
  scalar(out, value, ['errorName'], label)
  scalar(out, value, ['cfRay'], v => typeof v === 'string' && /^[a-f0-9]{8,32}-[A-Z]{3}$/i.test(v))
  choice(out, value, 'method', ['GET', 'POST', 'DELETE', 'PUT', 'PATCH', 'HEAD', 'OPTIONS'])
  if (typeof value.path === 'string') out.path = /^\/v1\/(?:user\/(?:login|refresh|delete_my_account|me)|bookmark\/(?:add_url|add))$/.test(value.path) ? value.path : '[redacted]'
  return out
}
function headers(value: unknown): DiagnosticValue {
  const result: CleanObject = { request: {}, response: {} }
  if (!object(value)) return result
  for (const side of ['request', 'response']) {
    if (!object(value[side])) continue
    const out: CleanObject = {}
    for (const [name, item] of Object.entries(value[side])) {
      const key = name.toLowerCase()
      if (side === 'request' && key === 'authorization') out[name] = token(item)
      else if (
        ['content-type', 'accept'].includes(key) &&
        typeof item === 'string' &&
        /^(?:application\/(?:json|x-ndjson|octet-stream)|text\/(?:plain|html)|\*\/\*)(?:;\s*charset=utf-8)?$/i.test(item)
      )
        out[name] = item
      else if (side === 'request' && key === 'x-client-type' && ['ios', 'android', 'mobile', 'app', 'web', 'extension'].includes(String(item))) out[name] = item as string
      else if (side === 'request' && key === 'x-client-version' && version(item)) out[name] = item
      else if (side === 'response' && key === 'cf-ray' && typeof item === 'string' && /^[a-f0-9]{8,32}-[A-Z]{3}$/i.test(item)) out[name] = item
      else if (side === 'response' && key === 'retry-after' && typeof item === 'string' && /^\d{1,8}$/.test(item)) out[name] = item
      else if (side === 'response' && key === 'date' && typeof item === 'string' && /^[A-Za-z]{3}, \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(item)) out[name] = item
      else if (side === 'response' && key === 'server' && typeof item === 'string' && ['cloudflare', 'nginx', 'envoy'].includes(item)) out[name] = item
      else if (
        side === 'response' &&
        key === 'cf-cache-status' &&
        typeof item === 'string' &&
        ['HIT', 'MISS', 'DYNAMIC', 'BYPASS', 'EXPIRED', 'STALE', 'UPDATING', 'REVALIDATED'].includes(item)
      )
        out[name] = item
    }
    result[side] = out
  }
  return result
}
const events: readonly DiagnosticExportEvent[] = [
  'snapshot',
  'app.launch',
  'auth.login',
  'auth.signout',
  'auth.reauth_required',
  'auth.refresh_failed',
  'account.delete',
  'log.dropped',
  'log.truncated',
  'share.start',
  'share.end'
]
const reasons = [
  'no_extension_context',
  'no_url_found',
  'attachment_load_failed',
  'unsupported_intent',
  'empty_text',
  'prefs_unavailable',
  'prefs_corrupt',
  'signed_out',
  'no_token',
  'endpoint_missing',
  'http_401',
  'http_400',
  'http_429',
  'http_5xx',
  'http_other',
  'network_offline',
  'network_dns',
  'network_timeout',
  'network_tls',
  'network_other',
  'cancelled',
  'success'
]

export function sanitizeDiagnosticExportEntry(value: unknown): DiagnosticExportEntry | null {
  if (!object(value) || value.v !== 1 || !timestamp(value.ts) || !events.includes(value.event as DiagnosticExportEvent)) return null
  const out: DiagnosticExportEntry = {
    v: 1,
    ts: value.ts,
    event: value.event as DiagnosticExportEvent
  }
  scalar(out, value, ['app'], v => typeof v === 'string' && /^\d+(?:\.\d+){0,3}(?:[-+][A-Za-z0-9.-]{1,20})? \(\d{1,20}\)$/.test(v))
  scalar(out, value, ['os'], v => typeof v === 'string' && /^(?:iOS|Android) [A-Za-z0-9._-]{1,32}$/.test(v))
  if (value.event === 'snapshot') {
    if (!object(value.sync) || typeof value.session !== 'string') return null
    scalar(out, value, ['version'], version)
    scalar(out, value, ['build'], v => typeof v === 'string' && /^\d{1,20}$/.test(v))
    choice(out, value, 'env', ['PRODUCTION', 'BETA', 'default', 'production', 'beta', 'development', 'test', 'local'])
    choice(out, value, 'session', ['unknown', 'loading', 'authenticated', 'unauthenticated', 'reauthentication-required'])
    if (out.session === undefined) return null
    choice(out, value, 'reauthentication', ['unknown', 'idle', 'checking', 'ready', 'paused', 'retry', 'loading', 'refreshing', 'error', 'reauthentication-required'])
    scalar(out, value, ['shareAvailable'], v => typeof v === 'boolean')
    const sync: CleanObject = {}
    if (value.sync.uploadError !== undefined) sync.uploadError = error(value.sync.uploadError)
    if (value.sync.downloadError !== undefined) sync.downloadError = error(value.sync.downloadError)
    scalar(sync, value.sync, ['connected'], v => typeof v === 'boolean')
    scalar(sync, value.sync, ['pendingUploads'], v => Number.isSafeInteger(v) && (v as number) >= 0)
    scalar(sync, value.sync, ['lastSyncedAt'], timestamp)
    out.sync = sync
    if (object(value.network)) {
      const network: CleanObject = {}
      scalar(network, value.network, ['isConnected', 'isInternetReachable', 'connected', 'internetReachable', 'isAirplaneModeEnabled'], v => typeof v === 'boolean')
      choice(network, value.network, 'type', [
        'UNKNOWN',
        'NONE',
        'WIFI',
        'CELLULAR',
        'ETHERNET',
        'BLUETOOTH',
        'VPN',
        'OTHER',
        'unknown',
        'none',
        'wifi',
        'cellular',
        'ethernet',
        'bluetooth',
        'vpn',
        'other'
      ])
      out.network = network
    } else choice(out, value, 'network', ['unknown', 'online', 'offline'])
    return out
  }
  if (!['app', 'share-ios', 'share-android'].includes(String(value.src))) return null
  out.src = value.src as string
  scalar(out, value, ['launch', 'share'], v => typeof v === 'string' && /^[a-f0-9-]{8,36}$/i.test(v))
  if (String(value.event).startsWith('share.') && value.src === 'app') return null
  if (String(value.event).startsWith('auth.') && value.src !== 'app') return null
  if (value.event === 'share.start' || value.event === 'share.end') {
    if (typeof out.share !== 'string') return null
    if (value.event === 'share.start') return out
    if (!['success', 'failed', 'dismissed'].includes(String(value.outcome)) || !reasons.includes(String(value.reason))) return null
    choice(out, value, 'outcome', ['success', 'failed', 'dismissed'])
    choice(out, value, 'stage', ['context', 'extract', 'prefs', 'auth', 'request', 'response', 'done'])
    choice(out, value, 'reason', reasons)
    choice(out, value, 'env', ['PRODUCTION', 'BETA', 'default'])
    scalar(out, value, ['host'], host)
    out.token = token(value.token)
    out.http = http(value.http)
    out.error = error(value.error)
    if (value.shown !== undefined) out.shown = '[redacted]'
    if (object(value.prefs)) {
      const prefs: CleanObject = {}
      choice(prefs, value.prefs, 'store', ['v1', 'legacy', 'none'])
      scalar(prefs, value.prefs, ['error'], label)
      scalar(prefs, value.prefs, ['signOutPending'], v => typeof v === 'boolean')
      out.prefs = prefs
    }
    if (object(value.input)) {
      const input: CleanObject = {}
      scalar(input, value.input, ['items', 'attachments', 'textLength', 'urlIndex'], finite)
      scalar(input, value.input, ['title', 'subject'], v => typeof v === 'boolean')
      scalar(input, value.input, ['action', 'referrer'], label)
      scalar(input, value.input, ['mime'], v => typeof v === 'string' && /^[a-z0-9.+*-]+\/[a-z0-9.+*-]+$/i.test(v))
      choice(input, value.input, 'urlFrom', ['js', 'url'])
      if (Array.isArray(value.input.types)) input.types = value.input.types.filter(label).slice(0, 10)
      if (Array.isArray(value.input.loadErrors))
        input.loadErrors = value.input.loadErrors
          .slice(0, 10)
          .filter(object)
          .map(item => {
            const clean = error(item) as CleanObject
            scalar(clean, item, ['type'], label)
            return clean
          })
      input.url = null
      if (object(value.input.url)) {
        const url: CleanObject = {}
        choice(url, value.input.url, 'scheme', ['http', 'https'])
        scalar(url, value.input.url, ['host'], host)
        scalar(url, value.input.url, ['length'], finite)
        input.url = url
      }
      out.input = input
    }
    for (const key of ['net', 'ms'])
      if (object(value[key])) {
        const fields: CleanObject = {}
        scalar(fields, value[key], key === 'ms' ? ['extract', 'prefs', 'request', 'total'] : ['dns', 'connect', 'tls', 'send', 'wait', 'receive', 'total', 'remotePort'], finite)
        if (key === 'net') {
          scalar(fields, value[key], ['reused', 'proxy', 'cellular', 'expensive', 'constrained', 'validated', 'metered'], v => typeof v === 'boolean')
          choice(fields, value[key], 'protocol', ['http/1.0', 'http/1.1', 'h2', 'h3', 'quic', 'HTTP_1_1', 'HTTP_2'])
          choice(fields, value[key], 'tlsVersion', ['TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3', 'TLS 1.2', 'TLS 1.3', '771', '772'])
          choice(fields, value[key], 'failedIn', ['dns', 'connect', 'tls', 'send', 'wait', 'receive'])
          choice(fields, value[key], 'transport', ['wifi', 'cellular', 'other'])
        }
        out[key] = fields
      }
    return out
  }
  if (['auth.login', 'account.delete'].includes(String(value.event))) {
    if (typeof value.ok !== 'boolean') return null
    out.ok = value.ok
  }
  if (value.event === 'auth.login') {
    if (!['google', 'apple'].includes(String(value.provider))) return null
    out.provider = value.provider as string
    scalar(out, value, ['durationMs'], finite)
    out.headers = headers(value.headers)
  }
  if (value.event === 'auth.signout') {
    if (!['user', 'unauthorized', 'account_deleted', 'environment_switch', 'other'].includes(String(value.cause))) return null
    out.cause = value.cause as string
  }
  if (value.event === 'account.delete') {
    scalar(out, value, ['canDelete'], v => typeof v === 'boolean')
    if (value.reason !== undefined) out.reason = value.reason === null ? null : '[redacted]'
  }
  if (value.event === 'log.dropped') {
    if (!Number.isSafeInteger(value.count) || (value.count as number) < 0) return null
    out.count = value.count as number
  }
  if (value.http !== undefined) out.http = http(value.http)
  if (value.error !== undefined) out.error = error(value.error)
  return out
}
