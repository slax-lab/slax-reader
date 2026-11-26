export type MobileErrorKind = 'error' | 'unhandledrejection' | 'render' | 'powersync' | 'network'

/** Best-effort client error reporting; capture never throws and returns the record fingerprint. */
export interface MobileErrorLog {
  capture(kind: MobileErrorKind, error: unknown, properties?: Record<string, unknown>): string | undefined
  /** One timing or outcome observation, stored as its own `kind: 'telemetry'` row; never throws. */
  telemetry(event: string, properties?: Record<string, unknown>, label?: string): void
  flush(hiding?: boolean): Promise<void>
}

export const noopErrorLog: MobileErrorLog = { capture: () => undefined, telemetry: () => undefined, flush: async () => {} }
