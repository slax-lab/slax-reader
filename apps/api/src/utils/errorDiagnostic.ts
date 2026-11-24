const MAX_MESSAGE = 500

const asRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {})

const boundedMessage = (error: unknown): string => {
  const message = asRecord(error).message
  const text = typeof message === 'string' && message ? message : error instanceof Error ? error.message : String(error)
  return text.length > MAX_MESSAGE ? text.slice(0, MAX_MESSAGE) : text
}

/** Bounded diagnostic fields for a caught error, without importing Prisma or serializing payloads. */
export function errorDiagnostic(error: unknown): { name?: string; message: string; code?: string | number; meta?: unknown } {
  try {
    const record = asRecord(error)
    const name = typeof record.name === 'string' && record.name ? record.name : undefined
    const code = typeof record.code === 'string' || typeof record.code === 'number' ? record.code : undefined
    const meta = typeof record.meta === 'object' && record.meta !== null ? record.meta : undefined
    return { ...(name ? { name } : {}), message: boundedMessage(error), ...(code !== undefined ? { code } : {}), ...(meta !== undefined ? { meta } : {}) }
  } catch {
    return { message: 'Unknown error' }
  }
}

/**
 * The AI provider failure fields the provider client keeps on `AIProviderError`. Read by shape so
 * `utils` stays independent of the provider SDK.
 */
export function providerDiagnostic(error: unknown): {
  providerStatus?: number
  providerCode?: string | number
  reference?: string
  overloaded?: boolean
  timedOut?: boolean
  message: string
} {
  const record = asRecord(error)
  const providerStatus = typeof record.providerStatus === 'number' ? record.providerStatus : undefined
  const providerCode = typeof record.providerCode === 'string' || typeof record.providerCode === 'number' ? record.providerCode : undefined
  const reference = typeof record.reference === 'string' && record.reference ? record.reference : undefined
  const overloaded = record.overloaded === true ? true : undefined
  const timedOut = record.timedOut === true ? true : undefined
  return {
    ...(providerStatus !== undefined ? { providerStatus } : {}),
    ...(providerCode !== undefined ? { providerCode } : {}),
    ...(reference ? { reference } : {}),
    ...(overloaded !== undefined ? { overloaded } : {}),
    ...(timedOut !== undefined ? { timedOut } : {}),
    message: boundedMessage(error)
  }
}
