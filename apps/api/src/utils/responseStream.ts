/**
 * Thrown when the response stream rejects a write, which means the client stopped reading it.
 * Provider clients pass it through untouched so a departure is not reported as a provider failure.
 */
export class ResponseStreamClosedError extends Error {
  readonly cause: unknown

  constructor(cause: unknown) {
    super('The response stream is closed')
    this.name = 'ResponseStreamClosedError'
    this.cause = cause
  }
}
