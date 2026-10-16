export type PositionFlushReason = 'debounce' | 'background' | 'exit' | 'document-change'

/** Serialize writes, retain failed snapshots, and flush the newest position before a debounce expires. */
export class ReaderPositionWriter {
  private write: (positionPixels: number, reason: PositionFlushReason) => Promise<void> | void
  private onError: (error: unknown) => void
  private debounceMs: number
  private latest: number | null = null
  private saved: number | null = null
  private timer: ReturnType<typeof setTimeout> | null = null
  private chain: Promise<void> = Promise.resolve()
  private disposed = false

  constructor(write: (positionPixels: number, reason: PositionFlushReason) => Promise<void> | void,
    onError: (error: unknown) => void = () => {}, debounceMs = 2_000) {
    this.write = write
    this.onError = onError
    this.debounceMs = debounceMs
  }

  update(positionPixels: number): void {
    if (this.disposed || !Number.isFinite(positionPixels) || positionPixels < 0) return
    this.latest = positionPixels
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = setTimeout(() => { this.timer = null; void this.flush('debounce').catch(() => {}) }, this.debounceMs)
  }

  flush(reason: PositionFlushReason): Promise<void> {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    const snapshot = this.latest
    if (snapshot === null) return this.chain
    const write = async () => {
      if (snapshot === this.saved) return
      await this.write(snapshot, reason)
      this.saved = snapshot
    }
    // A previous failed write never prevents a later snapshot from being saved.
    const result = this.chain.then(write, write)
    this.chain = result.catch(this.onError)
    return result
  }

  dispose(reason: PositionFlushReason = 'exit'): Promise<void> {
    this.disposed = true
    return this.flush(reason)
  }
}
