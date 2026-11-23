import { WorkerEntrypoint } from 'cloudflare:workers'
import { handleEmailEvent, handleQueueEvent, handleScheduledEvent } from './index'

// Edge keeps the queue consumers, cron triggers and the Email Routing target, and hands each event to Core over
// RPC: Core runs next to the database, and moving those triggers would need a coordinated account migration.

export interface QueueJobBatch {
  queue: string
  metadata: MessageBatchMetadata
  messages: QueueJobMessage[]
}

export interface QueueJobMessage {
  id: string
  timestamp: Date
  body: unknown
  attempts: number
}

export interface QueueJobOutcome {
  // Per-message decisions the handler made; Edge applies them to the real batch.
  acked: string[]
  retried: { id: string; delaySeconds?: number }[]
  ackAll: boolean
  retryAll?: { delaySeconds?: number }
}

export interface EmailJob {
  from: string
  to: string
  headers: [string, string][]
  raw: ReadableStream<Uint8Array>
  rawSize: number
}

export interface EmailJobOutcome {
  rejected?: string
}

// Waits for the work handlers start with waitUntil before the RPC returns, so Edge's event, which is what keeps
// a queue, cron or email invocation alive, covers it.
const draining = (parent: ExecutionContext) => {
  const pending: Promise<unknown>[] = []
  const ctx: ExecutionContext = {
    waitUntil: promise => void pending.push(promise),
    passThroughOnException: () => {},
    get props() {
      return parent.props
    },
    get tracing() {
      return parent.tracing
    },
    abort: reason => parent.abort(reason)
  }
  const drain = async () => {
    while (pending.length) await Promise.allSettled(pending.splice(0))
  }
  return { ctx, drain }
}

const drained = async <T>(parent: ExecutionContext, run: (ctx: ExecutionContext) => Promise<T>): Promise<T> => {
  const { ctx, drain } = draining(parent)
  try {
    return await run(ctx)
  } finally {
    await drain()
  }
}

export class CoreJobs extends WorkerEntrypoint<Env> {
  // Named runQueue/runCron/receiveEmail: queue, scheduled and email are reserved handler names on WorkerEntrypoint.
  async runQueue({ queue, metadata, messages }: QueueJobBatch): Promise<QueueJobOutcome> {
    const outcome: QueueJobOutcome = { acked: [], retried: [], ackAll: false }
    const batch: MessageBatch = {
      queue,
      metadata,
      messages: messages.map(message => ({
        ...message,
        ack: () => void outcome.acked.push(message.id),
        retry: options => void outcome.retried.push({ id: message.id, delaySeconds: options?.delaySeconds })
      })),
      ackAll: () => void (outcome.ackAll = true),
      retryAll: options => void (outcome.retryAll = { delaySeconds: options?.delaySeconds })
    }
    await drained(this.ctx, ctx => handleQueueEvent(batch, this.env, ctx))
    return outcome
  }

  async runCron(cron: string, scheduledTime: number): Promise<void> {
    await drained(this.ctx, ctx => handleScheduledEvent({ type: 'scheduled', cron, scheduledTime } as unknown as Event, this.env, ctx))
  }

  async receiveEmail(job: EmailJob): Promise<EmailJobOutcome> {
    const outcome: EmailJobOutcome = {}
    const message = {
      from: job.from,
      to: job.to,
      headers: new Headers(job.headers),
      raw: job.raw,
      rawSize: job.rawSize,
      setReject: (reason: string) => void (outcome.rejected = reason)
    } as unknown as ForwardableEmailMessage
    await drained(this.ctx, ctx => handleEmailEvent(message, this.env, ctx))
    return outcome
  }
}
