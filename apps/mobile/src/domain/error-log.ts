export type MobileErrorKind = 'error' | 'unhandledrejection' | 'render' | 'powersync' | 'network'

/** Best-effort client error reporting; capture never throws and returns the record fingerprint. */
export interface MobileErrorLog {
  capture(kind: MobileErrorKind, error: unknown, properties?: Record<string, unknown>): string | undefined
  flush(hiding?: boolean): Promise<void>
}

export const noopErrorLog: MobileErrorLog = { capture: () => undefined, flush: async () => {} }
