export interface ClientErrorContextProperties {
  online: boolean
  foreground: boolean
  visibility: 'visible' | 'hidden' | 'prerender'
}

export interface HostNetTiming {
  dns_ms?: number
  tcp_ms?: number
  tls_ms?: number
  ttfb_ms?: number
  protocol?: string
}

/** Browser failure-mode context shared by API and PowerSync records. */
export function clientErrorContext(): ClientErrorContextProperties {
  const visibility = typeof document === 'undefined' ? 'visible' : document.visibilityState
  return {
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    foreground: visibility === 'visible',
    visibility
  }
}

const ms = (value: number) => (Number.isFinite(value) && value >= 0 ? Math.round(value) : undefined)

// An entry from a request that got a successful response; responseStatus is absent in older browsers.
const succeeded = (entry: PerformanceResourceTiming) =>
  entry.responseStart > 0 && (typeof entry.responseStatus !== 'number' || entry.responseStatus === 0 || entry.responseStatus < 400)

/**
 * The most recent successful Resource Timing entry for a host, reduced to the phases slow DNS or
 * handshakes make visible. Cross-origin values are zero without Timing-Allow-Origin.
 */
export function recentHostTiming(host: string | undefined): HostNetTiming | undefined {
  if (!host || typeof performance === 'undefined' || typeof performance.getEntriesByType !== 'function') return undefined
  let best: PerformanceResourceTiming | undefined
  for (const entry of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
    try {
      if (new URL(entry.name).hostname !== host) continue
    } catch {
      continue
    }
    if (!succeeded(entry)) continue
    if (!best || entry.startTime > best.startTime) best = entry
  }
  if (!best) return undefined
  const tcpEnd = best.secureConnectionStart > 0 ? best.secureConnectionStart : best.connectEnd
  const net: HostNetTiming = {
    ...(ms(best.domainLookupEnd - best.domainLookupStart) !== undefined ? { dns_ms: ms(best.domainLookupEnd - best.domainLookupStart) } : {}),
    ...(ms(tcpEnd - best.connectStart) !== undefined ? { tcp_ms: ms(tcpEnd - best.connectStart) } : {}),
    ...(best.secureConnectionStart > 0 && ms(best.connectEnd - best.secureConnectionStart) !== undefined ? { tls_ms: ms(best.connectEnd - best.secureConnectionStart) } : {}),
    ...(ms(best.responseStart - best.requestStart) !== undefined ? { ttfb_ms: ms(best.responseStart - best.requestStart) } : {}),
    ...(best.nextHopProtocol ? { protocol: best.nextHopProtocol } : {})
  }
  return Object.keys(net).length ? net : undefined
}

let apiFailures = 0
export const noteApiFailure = () => ++apiFailures
export const noteApiSuccess = () => {
  apiFailures = 0
}
export const apiFailureCount = () => apiFailures
