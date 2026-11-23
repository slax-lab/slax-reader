import { WorkerEntrypoint } from 'cloudflare:workers'
import { EDGE_SECRET_HEADER } from '@/const/edge'
import { EMAIL_HEADERS, JOBS_HOST, JOBS_PATHS, type CronJob, type EmailJobOutcome, type QueueJobBatch, type QueueJobOutcome } from '@/const/jobs'
import { handleEmailEvent, handleQueueEvent, handleScheduledEvent } from './handlers'

// Core's side of the jobs protocol (src/const/jobs.ts). Requests reach this host only through Edge's service
// binding; the shared secret also authenticates them.
export const isJobsRequest = (request: Request): boolean => new URL(request.url).hostname === JOBS_HOST

// Waits for the work handlers start with waitUntil before the response, so Edge's event, which is what keeps a
// queue, cron or email invocation alive, covers it.
const drained = async <T>(parent: ExecutionContext, run: (ctx: ExecutionContext) => Promise<T>): Promise<T> => {
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
  try {
    return await run(ctx)
  } finally {
    while (pending.length) await Promise.allSettled(pending.splice(0))
  }
}

async function runQueue({ queue, metadata, messages }: QueueJobBatch, env: Env, parent: ExecutionContext): Promise<QueueJobOutcome> {
  const outcome: QueueJobOutcome = { acked: [], retried: [], ackAll: false }
  const batch: MessageBatch = {
    queue,
    metadata,
    messages: messages.map(message => ({
      ...message,
      timestamp: new Date(message.timestamp),
      ack: () => void outcome.acked.push(message.id),
      retry: options => void outcome.retried.push({ id: message.id, delaySeconds: options?.delaySeconds })
    })),
    ackAll: () => void (outcome.ackAll = true),
    retryAll: options => void (outcome.retryAll = { delaySeconds: options?.delaySeconds })
  }
  await drained(parent, ctx => handleQueueEvent(batch, env, ctx))
  return outcome
}

async function runCron({ cron, scheduledTime }: CronJob, env: Env, parent: ExecutionContext): Promise<void> {
  await drained(parent, ctx => handleScheduledEvent({ type: 'scheduled', cron, scheduledTime } as unknown as Event, env, ctx))
}

// The newsletter handler reads only the recipient, the raw MIME stream and its size; the sender and headers are
// parsed from the MIME, so no envelope header list travels with the job.
async function receiveEmail(job: { to: string; raw: ReadableStream<Uint8Array>; rawSize: number }, env: Env, parent: ExecutionContext): Promise<EmailJobOutcome> {
  const outcome: EmailJobOutcome = {}
  const message = { to: job.to, raw: job.raw, rawSize: job.rawSize, setReject: (reason: string) => void (outcome.rejected = reason) } as unknown as ForwardableEmailMessage
  await drained(parent, ctx => handleEmailEvent(message, env, ctx))
  return outcome
}

// A handler failure answers 500 with no detail, so Edge fails its own invocation and the platform's retry or
// delivery-failure handling applies, as with a failing local handler.
export async function handleJobsRequest(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const secret = env.EDGE_SHARED_SECRET
  if (!secret || request.headers.get(EDGE_SECRET_HEADER) !== secret) return new Response('Forbidden', { status: 403 })
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const { pathname } = new URL(request.url)
  try {
    if (pathname === JOBS_PATHS.queue) return Response.json(await runQueue(await request.json<QueueJobBatch>(), env, ctx))
    if (pathname === JOBS_PATHS.cron) {
      await runCron(await request.json<CronJob>(), env, ctx)
      return Response.json({})
    }
    if (pathname === JOBS_PATHS.email) {
      const raw = request.body ?? new ReadableStream<Uint8Array>({ start: controller => controller.close() })
      const to = decodeURIComponent(request.headers.get(EMAIL_HEADERS.to) ?? '')
      return Response.json(await receiveEmail({ to, raw, rawSize: Number(request.headers.get(EMAIL_HEADERS.size)) }, env, ctx))
    }
  } catch (error) {
    console.error(`[jobs] ${pathname} failed: ${error instanceof Error ? error.message : 'unknown error'}`)
    return new Response('Job failed', { status: 500 })
  }
  return new Response('Not Found', { status: 404 })
}

// Kept for one release so the Edge published before the fetch path keeps working while Core is published ahead of
// Edge. It runs outside Core's placement (RPC ignores placement) and is removed once no live Edge binds CORE_JOBS.
export class CoreJobs extends WorkerEntrypoint<Env> {
  // queue, scheduled and email are reserved handler names on WorkerEntrypoint.
  async runQueue(batch: Omit<QueueJobBatch, 'messages'> & { messages: (Omit<QueueJobBatch['messages'][number], 'timestamp'> & { timestamp: Date | string })[] }) {
    return runQueue({ ...batch, messages: batch.messages.map(message => ({ ...message, timestamp: new Date(message.timestamp).toISOString() })) }, this.env, this.ctx)
  }

  async runCron(cron: string, scheduledTime: number) {
    await runCron({ cron, scheduledTime }, this.env, this.ctx)
  }

  async receiveEmail(job: { to: string; raw: ReadableStream<Uint8Array>; rawSize: number }) {
    return receiveEmail(job, this.env, this.ctx)
  }
}
