export type ClientErrorApp = 'web' | 'ios' | 'android'
export type ClientErrorEnv = 'development' | 'preview' | 'beta' | 'production'
export type ClientErrorKind = 'error' | 'unhandledrejection' | 'vue' | 'resource' | 'powersync' | 'render' | 'network'
/** A timing or outcome observation shares the error table under this kind but is never an error. */
export type ClientRecordKind = ClientErrorKind | 'telemetry'

export interface ClientErrorContext {
  userId?: string | number | null
  deviceId?: string | null
}

export interface ClientErrorRecord {
  occurred_at: number
  app: ClientErrorApp
  release: string
  env: ClientErrorEnv
  kind: ClientRecordKind
  fingerprint: string
  count: number
  error_name?: string
  message: string
  /** A compact stack: shortened frames within a byte cap, never the raw full stack. */
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
  /** Synchronous identity, read when an error is captured so a later account switch cannot reassign it. */
  getContext?: () => ClientErrorContext
  pageUrl?: () => string | undefined
  flushDelayMs?: number
  /** First wait before a repeated fingerprint is delivered again; it doubles after each delivery. */
  repeatIntervalMs?: number
  now?: () => number
  send?: (endpoint: string, body: string, hiding: boolean) => Promise<void> | void
}

export interface ErrorCollector {
  readonly enabled: boolean
  /** Records one occurrence. Each failure must reach capture from exactly one source. */
  capture(kind: ClientErrorKind, error: unknown, properties?: Record<string, unknown>): string | undefined
  /**
   * Records one observation as its own `kind: 'telemetry'` row, never merged, counted, or backed off,
   * so every duration is kept. `event` is a fixed name such as `powersync_phase`; `label` holds bounded
   * grouping words (for example `connect success`) that join the message and the fingerprint.
   */
  telemetry(event: string, properties?: Record<string, unknown>, label?: string): void
  flush(hiding?: boolean): Promise<void>
}

const ENVS = new Set<string>(['development', 'preview', 'beta', 'production'])
const MAX_MESSAGE_BYTES = 16 * 1024
const MAX_FRAME_BYTES = 512
const MAX_STACK_BYTES = 4 * 1024
const MAX_PROPERTIES_BYTES = 8 * 1024
const MAX_PAGE_URL_BYTES = 2 * 1024
const MAX_FINGERPRINTS_PER_SESSION = 200
const MAX_QUEUED_PER_FLUSH = 20
const MAX_OBSERVATIONS_QUEUED = 100
const MAX_OBSERVATIONS_PER_SESSION = 1000
const TELEMETRY_EVENT_PATTERN = /^[a-z][a-z0-9_]{0,63}$/
const TELEMETRY_LABEL_PATTERN = /^[a-z0-9_ -]{1,64}$/
// The Mobile app's page address: a route name and an optional single id, the Mobile pipeline's rule.
const APP_PAGE_URL_PATTERN = /^slaxreader:\/\/[a-z-]{1,32}(\/[0-9A-Za-z_-]{1,64})?$/
// Browsers cap keepalive fetch and sendBeacon bodies at 64 KiB; stay below it per request.
const MAX_REQUEST_BYTES = 60 * 1024
const MAX_COUNT = 100000
// `session_count` is stored in properties, not a typed column, so it may exceed a record's own cap.
const MAX_SESSION_COUNT = 100_000_000
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
  // Never end on the first half of a surrogate pair, which would serialize as an unpaired surrogate.
  const last = value.charCodeAt(low - 1)
  return value.slice(0, last >= 0xd800 && last <= 0xdbff ? low - 1 : low)
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

// Share and collection codes in a page path grant read access to their content, so records keep
// only the route shape: `/s/<code>` becomes `/s/:code`, `/c/<code>/<id>` becomes `/c/:code/:id`.
const pagePathForRecord = (path: string): string =>
  path.replace(/^\/s\/[^/]+/, '/s/:code').replace(/^\/c\/[^/]+(\/[^/]+)?/, (_match, member?: string) => (member ? '/c/:code/:id' : '/c/:code'))

// The same codes inside free text: `/s/<code>` or `/c/<code>[/<id>]` as the path of an absolute,
// protocol-relative, or root-relative URL, wherever the URL starts. A code segment ends at `/`,
// whitespace, a quote, a bracket, `:` (a stack position), or the end of the text.
const CAPABILITY_PATH_PATTERN = /((?:[a-z][a-z0-9+.-]*:)?\/\/[^\s"'<>()[\]{}/]+|^|[\s"'<>()[\]{}=,@:])\/(s|c)\/([^\s"'<>()[\]{}/:?#]+)(\/[^\s"'<>()[\]{}/:?#]+)?/gi
export const redactCapabilityPaths = (text: string): string =>
  text.replace(CAPABILITY_PATH_PATTERN, (_match, lead: string, kind: string, _code: string, member?: string) =>
    kind.toLowerCase() === 's' ? `${lead}/s/:code${member ?? ''}` : `${lead}/c/:code${member ? '/:id' : ''}`
  )

/**
 * PowerSync SDK HTTP failures carry the whole response body in their message ("HTTP <statusText>: <body>",
 * "Could not POST streaming to <path> - <status> - <statusText>: <body>"). An upstream error page can hold
 * a client IP or other private text, so the record keeps only the status and status text.
 */
export const powerSyncLogError = (message: string, error: unknown): { name: string; message: string } | unknown => {
  const status = typeof error === 'object' && error !== null && typeof (error as { status?: unknown }).status === 'number' ? (error as { status: number }).status : undefined
  const streaming = /^Could not POST streaming to (\S+) - (\d{3}) - ([^:]*)/.exec(message)
  const http = /^HTTP ([^:]*):/.exec(error instanceof Error ? error.message : '')
  if (streaming) return { name: 'PowerSyncHttpError', message: `Could not POST streaming to ${streaming[1]} - ${streaming[2]} - ${streaming[3]}` }
  if (http) return { name: 'PowerSyncHttpError', message: `HTTP ${status ?? ''} ${http[1]}`.replace(/\s+/g, ' ').trim() }
  return error ?? { name: 'PowerSyncLog', message }
}

// Ad blockers routinely block these third-party analytics/ads scripts; a blocked script there is not
// an application fault. Stripe stays captured because a blocked Stripe script breaks checkout.
const THIRD_PARTY_SCRIPT_HOSTS = ['googletagmanager.com', 'google-analytics.com', 'static.cloudflareinsights.com']
export const isThirdPartyScriptHost = (value: string | undefined | null): boolean => {
  if (!value) return false
  try {
    const host = new URL(value).hostname.toLowerCase()
    return THIRD_PARTY_SCRIPT_HOSTS.some(entry => host === entry || host.endsWith(`.${entry}`))
  } catch {
    return false
  }
}

/** A URL for a record field: no query or fragment, and no share or collection code in its path. */
export const urlForRecord = (value: string | undefined | null): string | undefined => {
  const stripped = stripUrl(value)
  return stripped ? redactCapabilityPaths(stripped) : undefined
}

/** The page URL without its query, fragment, or the share and collection codes in its path; a Mobile `slaxreader://` page address is kept as is. */
export const pageUrlForRecord = (value: string | undefined | null): string | undefined => {
  if (value && APP_PAGE_URL_PATTERN.test(value)) return value
  const stripped = stripUrl(value)
  if (!stripped) return undefined
  const url = new URL(stripped)
  return truncateBytes(`${url.protocol}//${url.host}${pagePathForRecord(url.pathname)}`, MAX_PAGE_URL_BYTES)
}

// URLs inside messages and stacks keep origin and path; query strings and fragments may carry tokens.
// Absolute URLs match wherever they start, so Safari and Firefox frames (`fn@https://…?v=1:2:3`)
// and bracketed URLs are covered. Protocol-relative (`//host/a?…`) and root-relative
// (`/v1/sync/changes?token=…`) paths must start the text or follow a delimiter, so prose
// containing a slash is not rewritten. In a stack, a trailing `:line:col` after the query belongs to
// the frame and is kept; in a message it is part of the query and removed with it.
// No lookbehind: Safari before 16.4 cannot parse it, and the Web app supports Safari 15.4.
const URL_QUERY_PATTERN =
  /(?:((?:https?|chrome-extension):\/\/[^\s"'<>()[\]{}?#]+)|(^|[\s"'<>()[\]{}=,@:])(\/\/?[^\s"'<>()[\]{}?#/][^\s"'<>()[\]{}?#]*))[?#][^\s"'<>()[\]{}]*?((?::\d+){1,2})?(?=[\s"'<>()[\]{}]|$)/g
export const stripUrlQueries = (text: string, { keepPosition = false } = {}): string =>
  text.replace(URL_QUERY_PATTERN, (_match, absolute?: string, lead?: string, relative?: string, position?: string) => (absolute ?? `${lead ?? ''}${relative ?? ''}`) + (keepPosition ? (position ?? '') : ''))

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
  const message = redactCapabilityPaths(stripUrlQueries(typeof rawMessage === 'string' && rawMessage ? rawMessage : describe(target ?? 'Unknown error')))
  const stack = typeof rawStack === 'string' && rawStack ? redactCapabilityPaths(stripUrlQueries(rawStack, { keepPosition: true })) : undefined
  return { name, message: message || 'Unknown error', stack }
}

// V8 frames start with `at `; Firefox and Safari frames are `fn@location:line:col`, or `fn@[native code]`
// for built-ins. A message line containing an address such as `user@example.com is not valid` has no
// `:line:col` and is not a frame.
const FRAME_PATTERN = /^\s*(?:at\s|[^@\s]*@(?:\S*:\d+(?::\d+)?|\[native code\])\s*$)/

const stackFrames = (stack: string | undefined): string[] => (stack ? stack.split('\n').filter(line => FRAME_PATTERN.test(line)).map(line => line.trim()) : [])

/** The first call frame of a stack, with URL queries already removed and bounded in size. */
export const firstFrame = (stack: string | undefined): string | undefined => {
  const frame = stackFrames(stack)[0]
  return frame ? truncateBytes(frame, MAX_FRAME_BYTES) : undefined
}

// Bundles are all served from `/_nuxt/`, so their origin and directory add nothing; other locations
// (workers elsewhere, third-party scripts, extensions) keep their full URL, which says whose code it is.
// `at fn (https://r.slax.com/_nuxt/a.js:1:2)` → `fn (a.js:1:2)`; `fn@https://…/_nuxt/a.js:1:2` → `fn (a.js:1:2)`.
const shortenFrame = (frame: string): string => {
  const v8 = frame.match(/^at\s+(?:(.*?)\s+\()?(.*?)\)?$/)
  const jsc = v8 ? null : frame.match(/^([^@]*)@(.*)$/)
  const rawLocation = (v8 ? v8[2] : jsc?.[2]) || frame
  // V8 writes an anonymous async frame as `at async https://…`; keep the `async` marker on the name side.
  const isAsync = /^async\s/.test(rawLocation)
  const fn = `${isAsync ? 'async ' : ''}${((v8 ? v8[1] : jsc?.[1]) || '').replace(/^<anonymous>$/, '')}`.trim()
  const location = rawLocation.replace(/^async\s+/, '').replace(/^(?:https?:\/\/[^/\s]+)?\/_nuxt\//, '')
  return truncateBytes(fn ? `${fn} (${location})` : location, MAX_FRAME_BYTES)
}

/**
 * A compact stack for diagnosis: every frame, shortened to its function and position, with immediate
 * repeats from recursion collapsed into `×N`. Frames past the 4 KiB cap are dropped and counted.
 */
export const compactStack = (stack: string | undefined): string | undefined => {
  const frames = stackFrames(stack).map(shortenFrame)
  if (!frames.length) return undefined
  const lines: string[] = []
  let previous: string | undefined
  let run = 0
  const close = () => {
    if (previous !== undefined) lines.push(run > 1 ? `${previous} ×${run}` : previous)
  }
  for (const frame of frames) {
    if (frame === previous) {
      run++
      continue
    }
    close()
    previous = frame
    run = 1
  }
  close()
  const kept: string[] = []
  let size = 0
  for (const [index, line] of lines.entries()) {
    const remaining = lines.length - index - 1
    // Leave room for the marker that reports how many frames were cut.
    const reserve = remaining ? 24 : 0
    const bytes = byteLength(line) + (kept.length ? 1 : 0)
    if (size + bytes + reserve > MAX_STACK_BYTES) {
      kept.push(`… ${lines.length - index} more frames`)
      break
    }
    kept.push(line)
    size += bytes
  }
  return kept.join('\n')
}

// Long digit runs (ids, timestamps, byte counts) vary per occurrence; short ones such as HTTP status
// codes distinguish failures (an expired-auth 401 must not merge with a server 500).
export const errorFingerprint = (kind: ClientErrorKind, name: string | undefined, message: string, stack: string | undefined): string =>
  fnv1a([kind, name ?? '', message.replace(/\d{4,}/g, 'N').slice(0, 512), (firstFrame(stack) ?? '').replace(/:\d+:\d+\)?$/, '')].join('|'))

// Room kept for capture sources merged into a queued record after it is bounded.
const SOURCES_RESERVE_BYTES = 1024

const serializedSize = (value: unknown) => byteLength(JSON.stringify(value))

// Every string in properties gets the same URL treatment as the message: callers pass URLs such as
// `filename` and `src`, and one that missed it must not carry a token or an access code.
const sanitizeValue = (value: unknown, depth = 0): unknown => {
  if (typeof value === 'string') return redactCapabilityPaths(stripUrlQueries(value, { keepPosition: true }))
  if (depth > 4 || value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(item => sanitizeValue(item, depth + 1))
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeValue(item, depth + 1)]))
}

export const boundedProperties = (properties: Record<string, unknown>): Record<string, unknown> | undefined => {
  const entries = Object.entries(properties)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => [key, sanitizeValue(value)] as const)
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
// Field caps are on raw bytes, but JSON escaping can multiply them (`"`, `\`, and control characters
// take up to six bytes each), so one record could still exceed a request body. Such a record has
// its message shortened until its serialized form fits.
const serializeRecord = (record: ClientErrorRecord, maxBytes: number): string => {
  let json = JSON.stringify(record)
  let bytes = byteLength(json) + 2
  let message = record.message
  while (bytes > maxBytes && message.length > 1) {
    message = truncateBytes(message, Math.max(1, Math.floor(byteLength(message) * (maxBytes / bytes) * 0.9)))
    json = JSON.stringify({ ...record, message, properties: { ...(record.properties ?? {}), message_truncated: true } })
    bytes = byteLength(json) + 2
  }
  return json
}

export const chunkBodies = (records: ClientErrorRecord[], maxBytes = MAX_REQUEST_BYTES): string[] => {
  const bodies: string[] = []
  let current: string[] = []
  let size = 2
  for (const record of records) {
    const json = serializeRecord(record, maxBytes)
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

const disabled: ErrorCollector = { enabled: false, capture: () => undefined, telemetry: () => undefined, flush: async () => {} }

/** Creates a best-effort collector; it is a no-op without an https endpoint, a known env, or a semver release. */
export function createErrorCollector(options: ErrorCollectorOptions): ErrorCollector {
  const endpoint = options.endpoint?.trim()
  if (!endpoint || !/^https:\/\//.test(endpoint) || !ENVS.has(options.env) || !RELEASE_PATTERN.test(options.release)) return disabled

  const env = options.env as ClientErrorEnv
  const now = options.now ?? Date.now
  const send = options.send ?? defaultSend
  const flushDelayMs = options.flushDelayMs ?? 5000
  const sessionId = randomSessionId()
  const repeatIntervalMs = options.repeatIntervalMs ?? 60_000
  // Repeats back off 1, 2, 4 … minutes up to an hour, so a page left failing all day sends a few
  // dozen records per fingerprint while `count` and `session_count` still add up to every occurrence.
  const maxRepeatIntervalMs = 60 * 60_000
  const seen = new Set<string>()
  // One pending record per group: the fingerprint plus the user it happened to, so occurrences under
  // different accounts are never merged. A repeat only increments its count, so an error that recurs
  // every few seconds yields one record per repeat interval rather than one per flush.
  const queue = new Map<string, ClientErrorRecord>()
  // Per group: when it was last delivered, how many times, and how many occurrences it has sent.
  const lastSentAt = new Map<string, number>()
  const deliveries = new Map<string, number>()
  const sessionCounts = new Map<string, number>()
  const groupKey = (record: Pick<ClientErrorRecord, 'fingerprint' | 'user_id'>) => `${record.fingerprint}|${record.user_id ?? ''}`
  // Observations are sent with the next flush as they are; each one is its own row.
  const observations: ClientErrorRecord[] = []
  let observationsRecorded = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let inFlight: Promise<void> | undefined
  const identity = (): { user_id?: string; device_id?: string } => {
    try {
      const context = options.getContext?.()
      const userId = context?.userId == null ? undefined : String(context.userId)
      const deviceId = context?.deviceId ? truncateBytes(String(context.deviceId), 128) : undefined
      return { ...(userId && /^[0-9]{1,20}$/.test(userId) ? { user_id: userId } : {}), ...(deviceId ? { device_id: deviceId } : {}) }
    } catch {
      return {}
    }
  }

  const deliver = async (records: ClientErrorRecord[], hiding: boolean) => {
    try {
      for (const body of chunkBodies(records)) await send(endpoint, body, hiding)
    } catch {
      // Delivery is best effort; failures must not create new error records.
    }
  }

  // A first occurrence is due at once; a repeat of a delivered fingerprint waits out its interval.
  const dueAt = (key: string) => {
    const sent = lastSentAt.get(key)
    if (sent === undefined) return -Infinity
    return sent + Math.min(repeatIntervalMs * 2 ** ((deliveries.get(key) ?? 1) - 1), maxRepeatIntervalMs)
  }

  let timerAt = Infinity
  // Arms one timer for the earliest due record; a new error moves an armed timer earlier.
  const schedule = () => {
    if (!queue.size && !observations.length) return
    const times = [...queue.keys()].map(key => Math.max(dueAt(key), now() + flushDelayMs))
    if (observations.length) times.push(now() + flushDelayMs)
    const at = Math.min(...times)
    if (timer && timerAt <= at) return
    if (timer) clearTimeout(timer)
    timerAt = at
    timer = setTimeout(() => {
      timer = undefined
      timerAt = Infinity
      void flush(false)
    }, Math.max(0, at - now()))
  }

  const flushNow = async (hiding: boolean): Promise<void> => {
    if (timer) {
      clearTimeout(timer)
      timer = undefined
      timerAt = Infinity
    }
    const sentAt = now()
    // Hiding the page delivers everything held, since there may be no later flush.
    const due = [...queue.values()].filter(record => hiding || dueAt(groupKey(record)) <= sentAt)
    const observed = observations.splice(0)
    if (!due.length && !observed.length) {
      schedule()
      return inFlight
    }
    for (const record of due) {
      const key = groupKey(record)
      queue.delete(key)
      lastSentAt.set(key, sentAt)
      deliveries.set(key, (deliveries.get(key) ?? 0) + 1)
      const total = Math.min((sessionCounts.get(key) ?? 0) + record.count, MAX_SESSION_COUNT)
      sessionCounts.set(key, total)
      record.properties = { ...(record.properties ?? {}), session_count: total }
    }
    const records = [...due, ...observed]
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

  // Never rejects: callers include timers and page-hide listeners that do not handle errors.
  const flush = async (hiding = false): Promise<void> => {
    try {
      await flushNow(hiding)
    } catch {
      // Delivery is best effort.
    }
  }

  const mergeSource = (record: ClientErrorRecord | undefined, source: string | undefined) => {
    const sources = record?.properties?.sources
    if (source && Array.isArray(sources) && !sources.includes(source)) sources.push(source)
  }

  const capture: ErrorCollector['capture'] = (kind, error, properties = {}) => {
    try {
      const { name, message, stack } = normalizeError(error)
      const fingerprint = errorFingerprint(kind, name, message, stack)
      // Identity is bound now: a record waiting for its interval must not move to another account.
      const who = identity()
      const key = groupKey({ fingerprint, user_id: who.user_id })
      const source = typeof properties.source === 'string' ? properties.source : undefined
      const existing = queue.get(key)
      if (existing) {
        existing.count = Math.min(existing.count + 1, MAX_COUNT)
        existing.properties = { ...(existing.properties ?? {}), last_occurred_at: now() }
        mergeSource(existing, source)
        return fingerprint
      }
      if (!seen.has(fingerprint)) {
        if (seen.size >= MAX_FINGERPRINTS_PER_SESSION) return undefined
        seen.add(fingerprint)
      }
      // The stack is compacted only for a new record; a repeat above reuses the queued one.
      const frame = compactStack(stack)
      const pageUrl = pageUrlForRecord(options.pageUrl ? options.pageUrl() : typeof location !== 'undefined' ? location.href : undefined)
      const { source: _source, ...rest } = properties
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : undefined
      queue.set(key, {
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
        ...who,
        ...(ua ? { ua: truncateBytes(ua, 1024) } : {}),
        properties: boundedProperties({ ...rest, ...(source ? { sources: [source] } : {}) })
      })
      // Only first occurrences fill a flush early; held repeats wait for their interval either way.
      if ([...queue.keys()].filter(queued => !lastSentAt.has(queued)).length >= MAX_QUEUED_PER_FLUSH) void flush(false)
      else schedule()
      return fingerprint
    } catch {
      // Error capture must never throw into the caller.
      return undefined
    }
  }

  const telemetry: ErrorCollector['telemetry'] = (event, properties = {}, label) => {
    try {
      if (!TELEMETRY_EVENT_PATTERN.test(event) || (label !== undefined && !TELEMETRY_LABEL_PATTERN.test(label))) return
      if (observationsRecorded >= MAX_OBSERVATIONS_PER_SESSION) return
      // A sender that cannot keep up loses the oldest observations, never the page's errors.
      if (observations.length >= MAX_OBSERVATIONS_QUEUED) observations.shift()
      observationsRecorded++
      const message = label ? `${event} ${label}` : event
      const pageUrl = pageUrlForRecord(options.pageUrl ? options.pageUrl() : typeof location !== 'undefined' ? location.href : undefined)
      const ua = typeof navigator !== 'undefined' ? navigator.userAgent : undefined
      observations.push({
        occurred_at: now(),
        app: options.app,
        release: options.release,
        env,
        kind: 'telemetry',
        fingerprint: fnv1a(['telemetry', message].join('|')),
        count: 1,
        message,
        ...(pageUrl ? { page_url: pageUrl } : {}),
        session_id: sessionId,
        ...identity(),
        ...(ua ? { ua: truncateBytes(ua, 1024) } : {}),
        properties: boundedProperties({ event, ...properties })
      })
      schedule()
    } catch {
      // Telemetry must never throw into the caller.
    }
  }

  return { enabled: true, capture, telemetry, flush }
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
  // Listener bodies are guarded: a throw inside one would surface as a new uncaught error on the page.
  const guarded =
    <T>(listener: (event: T) => void) =>
    (event: T) => {
      try {
        listener(event)
      } catch {
        // Diagnostics must not raise errors of their own.
      }
    }
  const flushHidden = () => collector.flush(true).catch(() => {})
  target.addEventListener(
    'error',
    guarded((event: ErrorEvent) => {
      const element = event.target as { tagName?: unknown; src?: string } | null
      if (element && element !== (target as unknown) && typeof element.tagName === 'string') {
        if (element.tagName === 'SCRIPT') {
          if (isThirdPartyScriptHost(element.src)) return
          const src = urlForRecord(element.src) ?? 'inline'
          collector.capture('resource', { name: 'ResourceError', message: `Script failed to load: ${src}` }, { source: 'script', src })
        }
        return
      }
      collector.capture('error', event.error ?? { message: event.message }, {
        source: 'global',
        filename: urlForRecord(event.filename),
        lineno: event.lineno,
        colno: event.colno
      })
    }),
    true
  )
  target.addEventListener(
    'unhandledrejection',
    guarded((event: PromiseRejectionEvent) => collector.capture('unhandledrejection', event.reason, { source: 'global' }))
  )
  const doc = (target as { document?: Document }).document
  if (doc) {
    doc.addEventListener(
      'visibilitychange',
      guarded(() => {
        if (doc.visibilityState === 'hidden') void flushHidden()
      })
    )
    target.addEventListener('pagehide', guarded(() => void flushHidden()))
  }
}
