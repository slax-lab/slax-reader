export const parseExtensionBridgeIds = (value: unknown): Set<string> =>
  new Set(
    String(value || '')
      .split(',')
      .map(id => id.trim().toLowerCase())
      .filter(Boolean)
  )

interface ExtensionOriginPolicy {
  origin: string
  clientId: string
  configuredIds: ReadonlySet<string>
  environment: unknown
}

export const isAllowedExtensionOrigin = ({ origin, clientId, configuredIds, environment }: ExtensionOriginPolicy): boolean => {
  try {
    const url = new URL(origin)
    if (url.protocol !== 'chrome-extension:' && url.protocol !== 'moz-extension:') return false

    const originId = url.hostname.toLowerCase()
    if (!clientId || originId !== clientId.toLowerCase()) return false

    return configuredIds.has(originId) || (environment === 'development' && configuredIds.size === 0)
  } catch {
    return false
  }
}

export const notifyExtensionBridgeAuthExpired = () => {
  if (typeof window === 'undefined' || window.location.pathname !== '/x/ext-bridge') return
  window.parent.postMessage({ type: 'slax-bridge-auth-expired' }, '*')
}
