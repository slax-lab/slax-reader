import { isAllowedExtensionOrigin } from './extensionBridge'

type BridgeSessionOptions = {
  clientId: string
  configuredIds: ReadonlySet<string>
  environment: unknown
  timeoutMs?: number
}

// 每次向 offscreen 查询当前会话；不将登录 token 放进 URL、Cookie 或 Web Storage。
export const requestExtensionBridgeSession = ({ timeoutMs = 10_000, ...policy }: BridgeSessionOptions): Promise<string | null> => {
  if (window.parent === window || window.location.pathname !== '/x/ext-bridge') {
    return Promise.reject(new Error('session transport requires an extension bridge frame'))
  }
  const origins = ['chrome-extension:', 'moz-extension:']
    .map(scheme => `${scheme}//${policy.clientId}`)
    .filter(origin => isAllowedExtensionOrigin({ ...policy, origin }))
  if (!origins.length) return Promise.reject(new Error('extension bridge client is not allowed'))

  return new Promise((resolve, reject) => {
    const requestId = crypto.randomUUID()
    const cleanup = () => {
      clearTimeout(timer)
      window.removeEventListener('message', onMessage)
    }
    const onMessage = (event: MessageEvent) => {
      if (event.source !== window.parent || !origins.includes(event.origin)) return
      const message = event.data
      if (message?.type !== 'slax-bridge-session-response' || message.requestId !== requestId) return
      cleanup()
      if (message.success !== true || (message.token !== null && typeof message.token !== 'string')) {
        reject(new Error('extension bridge session unavailable'))
        return
      }
      resolve(message.token || null)
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('extension bridge session timed out'))
    }, timeoutMs)
    window.addEventListener('message', onMessage)
    try {
      // The request contains only a nonce. Browsers reject the other browser's extension
      // scheme as targetOrigin; authenticate the parent's origin/source on the response.
      window.parent.postMessage({ type: 'slax-bridge-session-request', requestId }, '*')
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}
