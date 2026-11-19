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
  /** The first call frame only, never the full stack. */
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
const MAX_FRAME_BYTES = 512
const MAX_PROPERTIES_BYTES = 8 * 1024
const MAX_FINGERPRINTS_PER_SESSION = 200
const MAX_QUEUED_PER_FLUSH = 20
// Browsers cap keepalive fetch and sendBeacon bodies at 64 KiB; stay below it per request.
const MAX_REQUEST_BYTES = 60 * 1024
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
// No lookbehind: Safari before 16.4 cannot parse it, and the Web app supports Safari 15.4.
// A root-relative path must start the text or follow a character that cannot precede a URL path.
const URL_QUERY_PATTERN = /(^|[\s"'<>(=,])((?:(?:https?|chrome-extension):\/\/[^\s"'<>()?#]+|\/[^\s"'<>()?#/][^\s"'<>()?#]*))[?#][^\s"'<>()]*?((?::\d+){1,2})?(?=[\s"'<>()]|$)/g
export const stripUrlQueries = (text: string): string =>
  text.replace(URL_QUERY_PATTERN, (_match, lead: string, url: string, position?: string) => lead + url + (position ?? ''))

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

// V8 frames start with `at `; Firefox and Safari frames are `fn@location:line:col`. A message line
// containing an address such as `user@example.com is not valid` has no `:line:col` and is not a frame.
const FRAME_PATTERN = /^\s*(?:at\s|[^@\s]*@\S*:\d+(?::\d+)?\s*$)/

/** The first call frame of a stack, with URL queries already removed and bounded in size. */
export const firstFrame = (stack: string | undefined): string | undefined => {
  const frame = stack?.split('\n').find(line => FRAME_PATTERN.test(line))?.trim()
  return frame ? truncateBytes(frame, MAX_FRAME_BYTES) : undefined
}

// Long digit runs (ids, timestamps, byte counts) vary per occurrence; short ones such as HTTP status
// codes distinguish failures (an expired-auth 401 must not merge with a server 500).
export const errorFingerprint = (kind: ClientErrorKind, name: string | undefined, message: string, stack: string | undefined): string =>
  fnv1a([kind, name ?? '', message.replace(/\d{4,}/g, 'N').slice(0, 512), (firstFrame(stack) ?? '').replace(/:\d+:\d+\)?$/, '')].join('|'))

// Room kept for capture sources merged into a queued record after it is bounded.
const SOURCES_RESERVE_BYTES = 1024

const serializedSize = (value: unknown) => byteLength(JSON.stringify(value))

export const boundedProperties = (properties: Record<string, unknown>): Record<string, unknown> | undefined => {
  const entries = Object.entries(properties).filter(([, value]) => value !== undefined)
  if (!entries.length) return undefined
  let bounded: Record<string, unknown>
  try {
    bounded = JSON.parse(JSON.stringify(Object.fromEntries(entries)))
  } catch {
    return { serialization_error: true }
  }
  const budget = MAX_PROPERTIES_BYTES - SOURCES_RESERVE_BYTES
  if (serializedSize(bounded) <= budget) return bounded
  // Shorten the largest values first so the object keeps its keys and its capture sources.
  const keys = Object.keys(bounded)
    .filter(key => key !== 'sources')
    .sort((a, b) => serializedSize(bounded[b]) - serializedSize(bounded[a]))
  for (const key of keys) {
    const excess = serializedSize(bounded) - budget
    if (excess <= 0) break
    const value = bounded[key]
    const text = typeof value === 'string' ? value : JSON.stringify(value)
    // JSON escaping can grow the cut text, so the target is rechecked on the serialized form.
    let keep = Math.max(0, byteLength(text) - excess - 16)
    for (;;) {
      const cut = truncateBytes(text, keep)
      bounded[key] = cut
      const over = serializedSize(bounded) - budget
      if (over <= 0 || keep === 0) break
      keep = Math.max(0, keep - over)
    }
    bounded.truncated = true
  }
  return serializedSize(bounded) <= MAX_PROPERTIES_BYTES ? bounded : { truncated: true, ...(Array.isArray(bounded.sources) ? { sources: bounded.sources } : {}) }
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

/** Serializes records into JSON array bodies that each stay under the per-request byte limit. */
export const chunkBodies = (records: ClientErrorRecord[], maxBytes = MAX_REQUEST_BYTES): string[] => {
  const bodies: string[] = []
  let current: string[] = []
  let size = 2
  for (const record of records) {
    const json = JSON.stringify(record)
    const bytes = byteLength(json) + 1
    if (current.length && size + bytes > maxBytes) {
      bodies.push(`[${current.join(',')}]`)
      current = []
      size = 2
    }
    current.push(json)
    size += bytes
  }
  if (current.length) bodies.push(`[${current.join(',')}]`)
  return bodies
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
      for (const body of chunkBodies(records)) await send(endpoint, body, hiding)
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
      // Only one frame is kept: deep stacks add size and copy more page internals than diagnosis needs.
      const frame = firstFrame(stack)
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
        ...(frame ? { stack: frame } : {}),
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
