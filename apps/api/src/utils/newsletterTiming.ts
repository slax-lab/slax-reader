export type NewsletterPhase = 'recipient' | 'read' | 'parse' | 'admit' | 'images' | 'store' | 'publish' | 'cleanup'
export class NewsletterTiming {
  private readonly startedAt = performance.now()
  private readonly eventId = crypto.randomUUID()
  private readonly phases: Partial<Record<NewsletterPhase, number>> = {}
  outcome: 'ready' | 'duplicate' | 'cancelled' | 'rejected' | 'failed' = 'failed'
  cleanupFailed = false
  constructor(private readonly bytes: number) {}
  async measure<T>(phase: NewsletterPhase, work: () => Promise<T>): Promise<T> {
    const start = performance.now()
    try {
      return await work()
    } finally {
      this.phases[phase] = Math.round(performance.now() - start)
    }
  }
  log() {
    const total = Math.round(performance.now() - this.startedAt)
    console.info('newsletter.receive', {
      event_id: this.eventId,
      bytes: this.bytes,
      outcome: this.outcome,
      cleanup_failed: this.cleanupFailed,
      phases_ms: this.phases,
      total_ms: total,
      slow: total > 5000
    })
  }
}
