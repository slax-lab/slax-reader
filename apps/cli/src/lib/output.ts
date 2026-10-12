import { buildHints } from './hints.js'

export interface JsonSuccess<T = unknown> {
  ok: true
  data: T
  _hints?: Record<string, unknown>
}

export interface JsonFailure {
  ok: false
  error: {
    code: string
    message: string
    hint?: string
  }
  _hints?: Record<string, unknown>
}

export type JsonEnvelope<T = unknown> = JsonSuccess<T> | JsonFailure

export function success<T>(data: T): JsonSuccess<T> {
  return injectHints({ ok: true, data })
}

export function failure(code: string, message: string, hint?: string): JsonFailure {
  return injectHints({
    ok: false,
    error: hint ? { code, message, hint } : { code, message },
  })
}

export function printJson(envelope: JsonEnvelope): void {
  console.log(JSON.stringify(envelope, null, 2))
}

function injectHints<T extends JsonEnvelope>(envelope: T): T {
  const hints = buildHints()
  if (hints) envelope._hints = hints
  return envelope
}
