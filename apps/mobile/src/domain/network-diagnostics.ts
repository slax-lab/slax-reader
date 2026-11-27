import type {MobileErrorLog} from './error-log.ts'

export type NetworkDiagnosticFamily = 'image' | 'content' | 'powersync'

/** What is known about the failed operation; nothing here may hold a URL, token, address or content. */
export interface NetworkDiagnosticFailure {
  /** The Slax-owned host the failed operation used. */
  host: string
  status?: number
  /** A bounded error class such as `SocketTimeoutException` or `NSURLErrorDomain:-1001`. */
  errorClass?: string
  timeout?: boolean
  cancelled?: boolean
}

export interface NetworkDiagnosticsOptions {
  errorLog: () => MobileErrorLog
  online: () => boolean
  /** Bounded native snapshot of the path to `host`; must reject for a host outside the Slax domains. */
  probe: (host: string) => Promise<Record<string, unknown>>
  timeoutMs?: number
  setTimeout?: (callback: () => void, ms: number) => unknown
  clearTimeout?: (handle: unknown) => void
}

export interface NetworkDiagnostics {
  /** Returns immediately; at most one record per family is captured for the lifetime of this collector. */
  report(family: NetworkDiagnosticFamily, failure: NetworkDiagnosticFailure): void
}

const ERROR_CLASS = /^[A-Za-z0-9_.:$-]{1,64}$/
const HOST = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/

/** A failure the network path cannot explain: client errors other than timeouts and throttling, and cancellations. */
export function networkDiagnosticEligible(failure: NetworkDiagnosticFailure): boolean {
  if (failure.cancelled) return false
  const status = failure.status
  return !(typeof status === 'number' && status >= 400 && status < 500 && status !== 408 && status !== 429)
}

function failureProperties(failure: NetworkDiagnosticFailure): Record<string, unknown> {
  return {
    ...(typeof failure.status === 'number' && Number.isSafeInteger(failure.status) && failure.status > 0 ? {status: failure.status} : {}),
    ...(failure.errorClass && ERROR_CLASS.test(failure.errorClass) ? {error: failure.errorClass} : {}),
    ...(failure.timeout ? {timeout: true} : {}),
  }
}

export function createNetworkDiagnostics(options: NetworkDiagnosticsOptions): NetworkDiagnostics {
  const state = new Map<NetworkDiagnosticFamily, 'probing' | 'recorded'>()
  const timeoutMs = options.timeoutMs ?? 10_000
  const schedule = options.setTimeout ?? ((callback, ms) => setTimeout(callback, ms))
  const cancel = options.clearTimeout ?? (handle => clearTimeout(handle as ReturnType<typeof setTimeout>))
  const capture = (family: NetworkDiagnosticFamily, host: string, failure: NetworkDiagnosticFailure, probed: Record<string, unknown> | undefined, probeError?: string) => {
    state.set(family, 'recorded')
    try {
      options.errorLog().capture('network', Object.assign(new Error(`Network diagnostic for ${family} failure`), {name: 'NetworkDiagnostic'}), {
        source: 'network_diagnostic', family, host, failure: failureProperties(failure),
        ...(probed ?? {}), ...(probeError ? {probe_error: probeError} : {}),
      })
    } catch {}
  }
  return {
    report(family, failure) {
      try {
        if (state.has(family) || !options.online() || !networkDiagnosticEligible(failure)) return
        const host = failure.host.toLowerCase().replace(/\.$/, '')
        if (!HOST.test(host)) return
        state.set(family, 'probing')
        let settled = false
        const timer = schedule(() => {if (!settled) {settled = true; capture(family, host, failure, undefined, 'timeout')}}, timeoutMs)
        void Promise.resolve().then(() => options.probe(host)).then(
          result => {if (!settled) {settled = true; cancel(timer); capture(family, host, failure, result && typeof result === 'object' ? result : undefined)}},
          error => {if (!settled) {settled = true; cancel(timer); capture(family, host, failure, undefined, error instanceof Error && ERROR_CLASS.test(error.name) ? error.name : 'unavailable')}},
        )
      } catch {}
    },
  }
}
