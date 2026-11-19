export type ClientErrorApp = 'web'
export type ClientErrorEnv = 'development' | 'preview' | 'beta' | 'production'
export type ClientErrorKind = 'error' | 'unhandledrejection' | 'vue' | 'resource' | 'powersync'

export interface ClientErrorContext {
  userId?: string | number | null
  deviceId?: string | null
}

export interface ClientErrorRecord {
  occurred_at: number
  app: ClientErrorApp
  release: string
  env: ClientErrorEnv
  kind: ClientErrorKind
  fingerprint: string
  count: number
  error_name?: string
  message: string
  stack?: string
  page_url?: string
  session_id: string
  user_id?: string
  device_id?: string
  ua?: string
  properties?: Record<string, unknown>
}

export interface ErrorCollectorOptions {
  endpoint?: string | null
  app: ClientErrorApp
  release: string
  env: string
  getContext?: () => ClientErrorContext | Promise<ClientErrorContext>
  pageUrl?: () => string | undefined
  flushDelayMs?: number
  now?: () => number
  send?: (endpoint: string, body: string, hiding: boolean) => Promise<void> | void
}

export interface CaptureOptions {
  /** False for an observer that reports a failure another source already counts; it only adds its source. */
  countOccurrence?: boolean
}

export interface ErrorCollector {
  readonly enabled: boolean
  capture(kind: ClientErrorKind, error: unknown, properties?: Record<string, unknown>, options?: CaptureOptions): void
  flush(hiding?: boolean): Promise<void>
}

const ENVS = new Set<string>(['development', 'preview', 'beta', 'production'])
const MAX_MESSAGE_BYTES = 16 * 1024
const MAX_STACK_BYTES = 64 * 1024
const MAX_PROPERTIES_BYTES = 8 * 1024
const MAX_FINGERPRINTS_PER_SESSION = 200
const MAX_QUEUED_PER_FLUSH = 20
const MAX_COUNT = 100000
const ERROR_NAME_PATTERN = /^[A-Za-z_$][A-Za-z0-9_$.]{0,63}$/
const RELEASE_PATTERN = /^[0-9]+\.[0-9]+\.[0-9]+([-+][0-9A-Za-z.-]{1,32})?$/

const encoder = new TextEncoder()
const byteLength = (value: string) => encoder.encode(value).length

export const truncateBytes = (value: string, maxBytes: number): string => {
  if (byteLength(value) <= maxBytes) return value
  let low = 0
  let high = value.length
  while (low < high) {
    const mid = Math.ceil((low + high) / 2)
    if (byteLength(value.slice(0, mid)) <= maxBytes) low = mid
    else high = mid - 1
  }
  return value.slice(0, low)
}

export const stripUrl = (value: string | undefined | null): string | undefined => {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (!/^(https?|chrome-extension):$/.test(url.protocol)) return undefined
    return `${url.protocol}//${url.host}${url.pathname}`
  } catch {
    return undefined
  }
}

// URLs inside messages and stacks keep origin and path; query strings and fragments may carry tokens.
// Covers absolute URLs and root-relative paths such as `/v1/sync/changes?token=…`.
// A trailing `:line:col` after the query belongs to a stack frame and is kept.
const URL_QUERY_PATTERN = /((?:\b(?:https?|chrome-extension):\/\/|(?<![\w/:.])\/)[^\s"'<>()?#]*)[?#][^\s"'<>()]*?((?::\d+){1,2})?(?=[\s"'<>()]|$)/g
export const stripUrlQueries = (text: string): string => text.replace(URL_QUERY_PATTERN, (_match, url: string, position?: string) => url + (position ?? ''))

const fnv1a = (input: string): string => {
  let a = 0x811c9dc5
  let b = 0x01000193
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b ^ code, 0x5bd1e995)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

const readField = (value: unknown, key: string): unknown => {
  try {
    return value && typeof value === 'object' ? (value as Record<string, unknown>)[key] : undefined
  } catch {
    return undefined
  }
}

const describe = (value: unknown): string => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

/** Reads name, message, and stack from an Error, an ErrorEvent, a cloned error, or any thrown value. */
export const normalizeError = (error: unknown): { name?: string; message: string; stack?: string } => {
  const inner = readField(error, 'error')
  const target = readField(error, 'type') === 'error' && inner != null ? inner : error
  const rawMessage = readField(target, 'message')
  const rawName = readField(target, 'name')
  const rawStack = readField(target, 'stack')
  const name = typeof rawName === 'string' && ERROR_NAME_PATTERN.test(rawName) ? rawName : undefined
  const message = stripUrlQueries(typeof rawMessage === 'string' && rawMessage ? rawMessage : describe(target ?? 'Unknown error'))
  const stack = typeof rawStack === 'string' && rawStack ? stripUrlQueries(rawStack) : undefined
  return { name, message: message || 'Unknown error', stack }
}

const firstFrame = (stack: string | undefined) =>
  (stack?.split('\n').find(line => /^\s*at\s|@/.test(line)) ?? '').trim().replace(/:\d+:\d+\)?$/, '')

/** Groups repeats of one failure regardless of which capture source observed it. */
export const errorFingerprint = (kind: ClientErrorKind, name: string | undefined, message: string, stack: string | undefined): string =>
  fnv1a([kind, name ?? '', message.replace(/\d+/g, 'N').slice(0, 512), firstFrame(stack)].join('|'))

const boundedProperties = (properties: Record<string, unknown>): Record<string, unknown> | undefined => {
  const entries = Object.entries(properties).filter(([, value]) => value !== undefined)
  if (!entries.length) return undefined
  let serialized: string
  try {
    serialized = JSON.stringify(Object.fromEntries(entries))
  } catch {
    return { serialization_error: true }
  }
  return byteLength(serialized) <= MAX_PROPERTIES_BYTES ? JSON.parse(serialized) : { truncated: truncateBytes(serialized, MAX_PROPERTIES_BYTES - 64) }
}

const randomSessionId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID()
  const hex = Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20)}`
}

const defaultSend = async (endpoint: string, body: string, hiding: boolean): Promise<void> => {
  // A text/plain body avoids a CORS preflight; sendBeacon survives page unload.
  if (hiding && typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(endpoint, body)) return
  await fetch(endpoint, { method: 'POST', body, keepalive: hiding, credentials: 'omit' })
}

const disabled: ErrorCollector = { enabled: false, capture: () => {}, flush: async () => {} }

/** Creates a best-effort collector; it is a no-op without an https endpoint, a known env, or a semver release. */
export function createErrorCollector(options: ErrorCollectorOptions): ErrorCollector {
  const endpoint = options.endpoint?.trim()
  if (!endpoint || !/^https:\/\//.test(endpoint) || !ENVS.has(options.env) || !RELEASE_PATTERN.test(options.release)) return disabled

  const env = options.env as ClientErrorEnv
  const now = options.now ?? Date.now
  const send = options.send ?? defaultSend
  const flushDelayMs = options.flushDelayMs ?? 5000
  const sessionId = randomSessionId()
  const seen = new Set<string>()
  const queue = new Map<string, ClientErrorRecord>()
  // Records opened by a non-counting observer; the next counting capture claims that first count.
  const provisional = new Set<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined
  // Page unload cannot await identity, so a hiding flush reuses the last identity resolved.
  let lastContext: ClientErrorContext | undefined

  const schedule = () => {
    if (timer || !queue.size) return
    timer = setTimeout(() => {
      timer = undefined
      void flush(false)
    }, flushDelayMs)
  }

  const deliver = async (records: ClientErrorRecord[], hiding: boolean) => {
    try {
      const context = hiding ? lastContext : await Promise.resolve(options.getContext?.()).catch(() => undefined)
      if (!hiding && context) lastContext = context
      const userId = context?.userId == null ? undefined : String(context.userId)
      const deviceId = context?.deviceId ? truncateBytes(String(context.deviceId), 128) : undefined
      for (const record of records) {
        if (userId && /^[0-9]{1,20}$/.test(userId)) record.user_id = userId
        if (deviceId) record.device_id = deviceId
      }
      await send(endpoint, JSON.stringify(records), hiding)
    } catch {
      // Delivery is best effort; failures must not create new error records.
    }
  }

  const flush = async (hiding = false): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
    }
    if (!queue.size) return inFlight
    const records = [...queue.values()]
    queue.clear()
    provisional.clear()
    const previous = inFlight
    const current = (async () => {
      if (!hiding) await previous
      await deliver(records, hiding)
    })()
    inFlight = current
    await current
    if (inFlight === current) inFlight = undefined
    schedule()
  }

  const capture: ErrorCollector['capture'] = (kind, error, properties = {}, captureOptions = {}) => {
    try {
      const { name, message, stack } = normalizeError(error)
      const fingerprint = errorFingerprint(kind, name, message, stack)
      const source = typeof properties.source === 'string' ? properties.source : undefined
      const existing = queue.get(fingerprint)
      const counts = captureOptions.countOccurrence !== false
      if (existing) {
        if (counts && provisional.has(fingerprint)) provisional.delete(fingerprint)
        else if (counts) existing.count = Math.min(existing.count + 1, MAX_COUNT)
        const sources = existing.properties?.sources
        if (source && Array.isArray(sources) && !sources.includes(source)) sources.push(source)
        return
      }
      if (!seen.has(fingerprint)) {
        if (seen.size >= MAX_FINGERPRINTS_PER_SESSION) return
        seen.add(fingerprint)
      }
      if (!counts) provisional.add(fingerprint)
      const pageUrl = stripUrl(options.pageUrl ? options.pageUrl() : typeof location !== 'undefined' ? location.href : undefined)
      const { source: _source, ...rest } = properties
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : undefined
      queue.set(fingerprint, {
        occurred_at: now(),
        app: options.app,
        release: options.release,
        env,
        kind,
        fingerprint,
        count: 1,
        ...(name ? { error_name: name } : {}),
        message: truncateBytes(message, MAX_MESSAGE_BYTES),
        ...(stack ? { stack: truncateBytes(stack, MAX_STACK_BYTES) } : {}),
        ...(pageUrl ? { page_url: pageUrl } : {}),
        session_id: sessionId,
        ...(ua ? { ua: truncateBytes(ua, 1024) } : {}),
        properties: boundedProperties({ ...rest, ...(source ? { sources: [source] } : {}) })
      })
      if (queue.size >= MAX_QUEUED_PER_FLUSH) void flush(false)
      else schedule()
    } catch {
      // Error capture must never throw into the caller.
    }
  }

  return { enabled: true, capture, flush }
}

interface ListenerTarget {
  addEventListener(type: string, listener: (event: any) => void, options?: boolean | AddEventListenerOptions): void
}

/**
 * Installs uncaught-error, unhandled-rejection, and failed `<script>` capture on a window or worker scope.
 * Other failed resources are ignored. In a document it also flushes when the page is hidden.
 */
export function installGlobalErrorCapture(collector: ErrorCollector, target: ListenerTarget = globalThis as unknown as ListenerTarget): void {
  if (!collector.enabled) return
  target.addEventListener(
    'error',
    (event: ErrorEvent) => {
      const element = event.target as { tagName?: unknown; src?: string } | null
      if (element && element !== (target as unknown) && typeof element.tagName === 'string') {
        if (element.tagName === 'SCRIPT') {
          const src = stripUrl(element.src) ?? 'inline'
          collector.capture('resource', { name: 'ResourceError', message: `Script failed to load: ${src}` }, { source: 'script', src })
        }
        return
      }
      collector.capture('error', event.error ?? { message: event.message }, {
        source: 'global',
        filename: stripUrl(event.filename),
        lineno: event.lineno,
        colno: event.colno
      })
    },
    true
  )
  target.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => collector.capture('unhandledrejection', event.reason, { source: 'global' }))
  const doc = (target as { document?: Document }).document
  if (doc) {
    doc.addEventListener('visibilitychange', () => {
      if (doc.visibilityState === 'hidden') void collector.flush(true)
    })
    target.addEventListener('pagehide', () => void collector.flush(true))
  }
}
