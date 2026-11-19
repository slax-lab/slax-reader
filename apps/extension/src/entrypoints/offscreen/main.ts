const runtimeBrowser = (globalThis as typeof globalThis & { chrome: typeof browser }).chrome
const WEB_ORIGIN = new URL(process.env.PUBLIC_BASE_URL || '').origin
const BRIDGE_PATH = '/x/ext-bridge'
const REQUEST_TIMEOUT_MS = 15_000
const LOAD_TIMEOUT_MS = 60_000
const RETRY_COOLDOWN_MS = 60_000
const MAX_TRANSPORT_FAILURES = 3

let iframe: HTMLIFrameElement | null = null
let mountState: 'idle' | 'loading' | 'ready' | 'failed' = 'idle'
let loadTimer: ReturnType<typeof setTimeout> | null = null
let retryAfter = 0
let transportFailures = 0
let readyWaiters: Array<{ resolve: () => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }> = []
let seq = 0
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>()

class BridgeLoadingError extends Error {}
class BridgeTransportError extends Error {}

const clearLoadTimer = () => {
  if (loadTimer) clearTimeout(loadTimer)
  loadTimer = null
}

const rejectPending = (error: Error) => {
  for (const [id, request] of pending) {
    clearTimeout(request.timer)
    request.reject(error)
    pending.delete(id)
  }
}

const rejectReadyWaiters = (error: Error) => {
  const waiters = readyWaiters
  readyWaiters = []
  waiters.forEach(waiter => {
    clearTimeout(waiter.timer)
    waiter.reject(error)
  })
}

const markFailed = (error: BridgeTransportError) => {
  clearLoadTimer()
  mountState = 'failed'
  retryAfter = Date.now() + RETRY_COOLDOWN_MS
  rejectPending(error)
  rejectReadyWaiters(error)
}

const removeBridge = () => {
  clearLoadTimer()
  iframe?.remove()
  iframe = null
}

const mountBridge = () => {
  if (iframe && (mountState === 'loading' || mountState === 'ready')) {
    return { success: true, reused: true }
  }

  if (mountState === 'failed' && Date.now() < retryAfter) {
    return {
      success: false,
      code: 'remount-cooldown',
      error: 'bridge remount cooling down',
      retryAfter
    }
  }

  if (iframe) {
    const error = new BridgeTransportError('bridge remounted')
    rejectPending(error)
    rejectReadyWaiters(error)
    removeBridge()
  }

  const el = document.createElement('iframe')
  const clientId = encodeURIComponent(runtimeBrowser.runtime.id)
  el.src = `${WEB_ORIGIN}${BRIDGE_PATH}#c=${clientId}`
  el.style.display = 'none'
  mountState = 'loading'
  transportFailures = 0
  iframe = el
  retryAfter = 0
  document.body.appendChild(el)
  loadTimer = setTimeout(() => {
    if (iframe !== el || mountState !== 'loading') return
    markFailed(new BridgeTransportError('bridge load timeout'))
    removeBridge()
  }, LOAD_TIMEOUT_MS)
  return { success: true, reused: false }
}

window.addEventListener('message', event => {
  if (event.origin !== WEB_ORIGIN) return
  if (event.source !== iframe?.contentWindow) return

  if (event.data?.type === 'slax-bridge-session-request') {
    const requestId = event.data.requestId
    if (typeof requestId !== 'string' || requestId.length > 100) return
    const requestingFrame = iframe
    const requestingWindow = iframe?.contentWindow
    // Pin the recipient across the async cookie read; never reply to a replacement iframe.
    void runtimeBrowser.runtime.sendMessage({ target: 'slax-background', method: 'bridge-session' })
      .then((response: { success?: boolean; token?: string | null } | undefined) => {
        if (iframe !== requestingFrame || iframe?.contentWindow !== requestingWindow) return
        requestingWindow?.postMessage({
          type: 'slax-bridge-session-response',
          requestId,
          success: response?.success === true,
          token: response?.success === true ? response.token ?? null : null
        }, WEB_ORIGIN)
      })
      .catch(() => {
        if (iframe !== requestingFrame) return
        requestingWindow?.postMessage({ type: 'slax-bridge-session-response', requestId, success: false, token: null }, WEB_ORIGIN)
      })
    return
  }

  if (event.data?.type === 'slax-bridge-ready') {
    clearLoadTimer()
    mountState = 'ready'
    transportFailures = 0
    const waiters = readyWaiters
    readyWaiters = []
    waiters.forEach(waiter => {
      clearTimeout(waiter.timer)
      waiter.resolve()
    })
    return
  }

  if (event.data?.type === 'slax-bridge-sync-status') {
    void runtimeBrowser.runtime.sendMessage({
      target: 'slax-background',
      method: 'powersync-status',
      status: event.data.status
    }).catch(() => undefined)
    return
  }

  if (event.data?.type === 'slax-bridge-error') {
    markFailed(new BridgeTransportError(String(event.data.error || 'bridge unavailable')))
    return
  }

  if (event.data?.type === 'slax-bridge-auth-expired') {
    const error = new BridgeTransportError('bridge session expired')
    markFailed(error)
    removeBridge()
    void runtimeBrowser.runtime.sendMessage({ target: 'slax-background', method: 'session-expired' }).catch(() => undefined)
    return
  }

  const { id, result, error } = (event.data ?? {}) as { id?: number; result?: unknown; error?: string }
  if (typeof id !== 'number') return
  const p = pending.get(id)
  if (!p) return
  pending.delete(id)
  clearTimeout(p.timer)
  transportFailures = 0
  error ? p.reject(new Error(error)) : p.resolve(result)
})

const waitReady = () =>
  new Promise<void>((resolve, reject) => {
    if (mountState === 'ready') return resolve()
    if (!iframe || mountState === 'failed') return reject(new BridgeTransportError('bridge not available'))
    const timer = setTimeout(() => {
      readyWaiters = readyWaiters.filter(waiter => waiter.timer !== timer)
      reject(new BridgeLoadingError('bridge still loading'))
    }, REQUEST_TIMEOUT_MS)
    readyWaiters.push({ resolve, reject, timer })
  })

const call = async (method: string, params?: Record<string, unknown>) => {
  await waitReady()
  const id = ++seq
  return new Promise<unknown>((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      transportFailures += 1
      const error = new BridgeTransportError(`bridge call timeout: ${method}`)
      if (transportFailures >= MAX_TRANSPORT_FAILURES) markFailed(error)
      reject(error)
    }, REQUEST_TIMEOUT_MS)
    pending.set(id, { resolve, reject, timer })
    iframe!.contentWindow?.postMessage({ id, method, params }, WEB_ORIGIN)
  })
}

runtimeBrowser.runtime.onMessage.addListener((message: unknown, _sender: Browser.runtime.MessageSender, sendResponse: (response?: unknown) => void) => {
  const msg = message as { target?: string; method?: string; params?: Record<string, unknown> } | null
  if (msg?.target !== 'slax-offscreen') return false

  if (msg.method === 'mount') {
    sendResponse(mountBridge())
    return false
  }

  if (msg.method === 'unmount') {
    const error = new BridgeTransportError('bridge unmounted')
    rejectPending(error)
    rejectReadyWaiters(error)
    removeBridge()
    mountState = 'idle'
    retryAfter = 0
    transportFailures = 0
    sendResponse({ success: true })
    return false
  }

  call(msg.method!, msg.params)
    .then(result => sendResponse({ success: true, data: result }))
    .catch(err => {
      const kind = err instanceof BridgeLoadingError ? 'loading' : err instanceof BridgeTransportError ? 'transport' : 'business'
      sendResponse({ success: false, kind, code: `bridge-${kind}`, error: String(err) })
    })
  return true
})
