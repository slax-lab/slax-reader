import {redactAuthorization, requestHeaderAllowlist, responseHeaderAllowlist} from '../domain/diagnostic-headers.ts';

type ObjectValue = Record<string, unknown>;
type Rule = (value: unknown) => unknown;
const object = (value: unknown): ObjectValue => value && typeof value === 'object' && !Array.isArray(value) ? value as ObjectValue : {};
const bool: Rule = value => typeof value === 'boolean' ? value : undefined;
const number: Rule = value => typeof value === 'number' && Number.isFinite(value) ? value : undefined;
const count: Rule = value => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
const text = (pattern: RegExp): Rule => value => typeof value === 'string' && value.length <= 256 && !/[A-Za-z0-9_-]{40}/.test(value) && !/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(value) && pattern.test(value) ? value : undefined;
const choice = (...values: string[]): Rule => value => values.includes(value as string) ? value : undefined;
const nullable = (rule: Rule): Rule => value => value === null ? null : rule(value);
const identifier = text(/^[A-Za-z][A-Za-z0-9_.-]{0,99}$/);
const timestamp: Rule = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : undefined;
const shape = (rules: Record<string, Rule>): Rule => value => {
  const source = object(value), result: ObjectValue = {};
  for (const [key, rule] of Object.entries(rules)) {const safe = rule(source[key]); if (safe !== undefined) result[key] = safe;}
  return result;
};
const array = (rule: Rule, limit = 10): Rule => value => Array.isArray(value) ? value.slice(0, limit).map(rule).filter(item => item !== undefined) : undefined;
const host: Rule = value => {
  if (typeof value !== 'string') return undefined;
  try {const parsed = new URL(value.includes('://') ? value : `https://${value}`); return ['http:', 'https:'].includes(parsed.protocol) ? parsed.hostname : undefined;} catch {return undefined;}
};
const token: Rule = value => {
  if (typeof value === 'string') return redactAuthorization(value);
  const raw = object(value), len = count(raw.len);
  if (typeof raw.present !== 'boolean' || len === undefined) return undefined;
  return {present: raw.present, len, ...(raw.present && (len as number) > 4 && typeof raw.tail4 === 'string' && /^[A-Za-z0-9_.-]{4}$/.test(raw.tail4) ? {tail4: raw.tail4} : {})};
};
const ray = nullable(text(/^[A-Za-z0-9-]{1,80}$/));
const method = choice('GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS');
const path: Rule = value => {
  const route = typeof value === 'string' ? value.split(/[?#]/)[0] : '';
  return route && /^\/v1\/(?:user\/(?:login|refresh|delete_my_account|me|report)|bookmark\/(?:add_url|add|metadata|content|pdf|upload_pdf)|sync\/(?:token|changes))$/.test(route) ? route : undefined;
};
const http = nullable(shape({method, path, status: nullable(number), code: nullable(number), cfRay: ray, errorName: nullable(text(/^[A-Z][A-Z0-9_]{0,99}$/))}));
const error = nullable(shape({class: identifier, domain: identifier, code: number, status: number, underlyingDomain: identifier, underlyingCode: number, streamDomain: number, streamCode: number}));
const version = text(/^\d+(?:\.\d+){0,3}(?:[-+][A-Za-z0-9.-]+)?$/);
const app = text(/^\d+(?:\.\d+){0,3}(?:[-+][A-Za-z0-9.-]+)? \(\d+\)$/);
const os = text(/^(?:iOS|Android) [A-Za-z0-9._-]{1,32}$/);
const env = choice('PRODUCTION', 'BETA', 'default');
const headers = (direction: 'request' | 'response'): Rule => value => {
  const source = object(value), result: ObjectValue = {};
  const rules: Record<string, Rule> = {
    'Authorization': token, 'User-Agent': text(/^SlaxReader\/(?:android|ios) [0-9][A-Za-z0-9.() -]{0,60}$/),
    'Content-Type': text(/^(?:application|text)\/[a-z0-9.+-]+(?:;\s*charset=[A-Za-z0-9-]+)?$/i),
    'Accept': text(/^(?:application\/(?:json|x-ndjson)|\*\/\*)$/),
    'X-CLIENT-TYPE': choice('android', 'ios'), 'X-CLIENT-VERSION': version,
    'Date': text(/^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} [A-Za-z]{3} \d{4} \d{2}:\d{2}:\d{2} GMT$/),
    'CF-Ray': ray, 'Retry-After': text(/^\d{1,10}$/), 'Server': choice('cloudflare', 'nginx', 'envoy'),
    'CF-Cache-Status': choice('HIT', 'MISS', 'DYNAMIC', 'BYPASS', 'EXPIRED', 'STALE', 'UPDATING', 'REVALIDATED'),
  };
  for (const name of direction === 'request' ? requestHeaderAllowlist : responseHeaderAllowlist) {
    const raw = Object.entries(source).find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1], safe = rules[name]!(raw);
    if (safe !== undefined) result[name] = safe;
  }
  return result;
};
const reason = choice('no_extension_context', 'no_url_found', 'attachment_load_failed', 'unsupported_intent', 'empty_text', 'prefs_unavailable', 'prefs_corrupt', 'signed_out', 'no_token', 'endpoint_missing', 'http_401', 'http_400', 'http_429', 'http_5xx', 'http_other', 'network_offline', 'network_dns', 'network_timeout', 'network_tls', 'network_other', 'cancelled', 'success');
const events: Record<string, Rule> = {
  'app.launch': shape({}), 'log.truncated': shape({}), 'log.dropped': shape({count}),
  'auth.login': shape({provider: choice('google', 'apple'), ok: bool, http, durationMs: count, headers: shape({request: headers('request'), response: headers('response')})}),
  'auth.signout': shape({cause: choice('user', 'unauthorized', 'account_deleted', 'environment_switch', 'other')}),
  'auth.reauth_required': shape({http}), 'auth.refresh_failed': shape({http, error}),
  'account.delete': shape({ok: bool, canDelete: nullable(bool), reason: nullable(choice('active_subscription', 'stripe_connect_exists', 'collection_has_subscribers', 'active_collection_subscription', 'has_free_subscription_history')), http}),
  'share.start': shape({share: text(/^[a-f0-9]{8}$/i)}),
  'share.end': shape({
    share: text(/^[a-f0-9]{8}$/i), outcome: choice('success', 'failed', 'dismissed'), stage: choice('context', 'extract', 'prefs', 'auth', 'request', 'response', 'done'), reason,
    input: shape({items: count, attachments: count, types: array(identifier), urlFrom: nullable(choice('js', 'url')), loadErrors: array(shape({type: identifier, domain: identifier, code: number})),
      action: choice('android.intent.action.SEND', 'android.intent.action.SEND_MULTIPLE'), mime: text(/^[A-Za-z0-9.+-]+\/[A-Za-z0-9.+*-]+$/), textLength: count, urlIndex: number, subject: bool, referrer: nullable(text(/^[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+$/)),
      url: nullable(shape({scheme: choice('https', 'http'), host, length: count})), title: bool}),
    prefs: shape({store: choice('v1', 'legacy', 'none'), error: nullable(identifier), signOutPending: bool}), token, env, host, http, error,
    net: shape({dns: nullable(count), connect: nullable(count), tls: nullable(count), send: nullable(count), wait: nullable(count), receive: nullable(count), total: nullable(count), reused: bool, proxy: bool,
      protocol: nullable(choice('http/1.0', 'http/1.1', 'h2', 'h3', 'HTTP_1_1', 'HTTP_2')), tlsVersion: nullable(choice('TLSv1', 'TLSv1.1', 'TLSv1.2', 'TLSv1.3', 'TLS 1.2', 'TLS 1.3')),
      failedIn: nullable(choice('dns', 'connect', 'tls', 'send', 'wait', 'receive')), cellular: bool, expensive: bool, constrained: bool, remotePort: count, transport: nullable(choice('wifi', 'cellular', 'other')), validated: bool, metered: bool}),
    ms: shape({extract: count, prefs: count, request: count, total: count}), shown: value => value === undefined ? undefined : '[redacted]',
  }),
};
export function sanitizeDiagnosticRecord(value: unknown): ObjectValue | null {
  const raw = object(value), ts = timestamp(raw.ts), event = typeof raw.event === 'string' ? raw.event : '';
  if (raw.v !== 1 || !ts || !['app', 'share-ios', 'share-android'].includes(raw.src as string) || !Object.hasOwn(events, event)) return null;
  const fields = object(events[event]!(raw));
  if (event.startsWith('share.') && (raw.src === 'app' || !fields.share)) return null;
  if (event.startsWith('auth.') && raw.src !== 'app') return null;
  if (event === 'share.end' && (!fields.outcome || !fields.reason)) return null;
  if (event === 'auth.login' && (!fields.provider || typeof fields.ok !== 'boolean')) return null;
  if (event === 'account.delete' && typeof fields.ok !== 'boolean') return null;
  if (event === 'auth.signout' && !fields.cause || event === 'log.dropped' && fields.count === undefined) return null;
  return {...object(shape({launch: text(/^[a-f0-9-]{8,36}$/i), app, os})(raw)), v: 1, ts, src: raw.src, event, ...fields};
}
export function sanitizeDiagnosticSnapshot(value: unknown): ObjectValue {
  const raw = object(value), ts = timestamp(raw.ts);
  if (raw.v !== 1 || raw.event !== 'snapshot' || !ts) throw new Error('Invalid diagnostic snapshot');
  return {v: 1, event: 'snapshot', ts, ...object(shape({app, version, build: text(/^\d{1,20}$/), os, env, shareAvailable: bool,
    sync: shape({connected: bool, lastSyncedAt: nullable(timestamp), uploadError: error, downloadError: error, pendingUploads: nullable(count)}),
    session: choice('unknown', 'loading', 'authenticated', 'unauthenticated', 'reauthentication-required'),
    reauthentication: choice('unknown', 'idle', 'checking', 'ready', 'paused', 'retry', 'reauthentication-required'),
    network: choice('unknown', 'online', 'offline'),
  })(raw))};
}
