export const READER_PROCESS_GONE = -1001
export function readerDocumentError(code: number, description = 'Reader document failed to load'): Error {
  const error = new Error(description)
  if (code === READER_PROCESS_GONE) error.name = 'ReaderProcessGone'
  return error
}

/** A dead native document needs a new view even when the HTML has not changed. */
export class ReaderCrashRecovery {
  private failed = false
  private active = true
  private generation = 0
  private pending: Promise<{generation: number; position: number} | null> | null = null
  fail(error: unknown): boolean {
    if (!this.active || !(error instanceof Error) || error.name !== 'ReaderProcessGone') return false
    this.failed = true; return true
  }
  retry(flush: () => Promise<void>, latestPosition: () => number): Promise<{generation: number; position: number} | null> {
    if (this.pending) return this.pending
    if (!this.active || !this.failed) return Promise.resolve(null)
    this.pending = (async () => {
      await flush()
      if (!this.active) return null
      const position = latestPosition()
      this.failed = false
      return {generation: ++this.generation, position: Number.isFinite(position) && position >= 0 ? position : 0}
    })().finally(() => {this.pending = null})
    return this.pending
  }
  dispose() {this.active = false}
}
