import { EDGE_SECRET_HEADER } from '@/const/edge'
import { EMAIL_HEADERS, JOBS_HOST, JOBS_PATHS, type CronJob, type EmailJobOutcome, type QueueJobBatch, type QueueJobOutcome } from '@/const/jobs'

// Edge stays the queue consumer, cron owner and Email Routing target it already is on every account, and forwards
// each event to Core over the CORE service binding. It uses fetch because placement applies only to fetch: an RPC
// call would run Core in Edge's location, far from the database. Service binding calls are not billed as requests.
async function post(env: Env, path: string, body: BodyInit, headers: Record<string, string> = {}): Promise<Response> {
  const secret = env.EDGE_SHARED_SECRET
  if (!secret) throw new Error('EDGE_SHARED_SECRET is not configured')
  const response = await env.CORE.fetch(`https://${JOBS_HOST}${path}`, { method: 'POST', headers: { ...headers, [EDGE_SECRET_HEADER]: secret }, body })
  // A failed job fails this invocation, so the queue retries the batch or Email Routing reports the delivery failure.
  if (!response.ok) throw new Error(`Core job ${path} failed with HTTP ${response.status}`)
  return response
}

export async function forwardQueue(batch: MessageBatch, env: Env): Promise<void> {
  const job: QueueJobBatch = {
    queue: batch.queue,
    metadata: batch.metadata,
    messages: batch.messages.map(({ id, timestamp, body, attempts }) => ({ id, timestamp: timestamp.toISOString(), body, attempts }))
  }
  const outcome = await (await post(env, JOBS_PATHS.queue, JSON.stringify(job), { 'Content-Type': 'application/json' })).json<QueueJobOutcome>()
  const byId = new Map(batch.messages.map(message => [message.id, message]))
  for (const id of outcome.acked) byId.get(id)?.ack()
  for (const { id, delaySeconds } of outcome.retried) byId.get(id)?.retry(delaySeconds === undefined ? undefined : { delaySeconds })
  if (outcome.ackAll) batch.ackAll()
  if (outcome.retryAll) batch.retryAll(outcome.retryAll.delaySeconds === undefined ? undefined : { delaySeconds: outcome.retryAll.delaySeconds })
}

export async function forwardScheduled(controller: ScheduledController, env: Env): Promise<void> {
  const job: CronJob = { cron: controller.cron, scheduledTime: controller.scheduledTime }
  await post(env, JOBS_PATHS.cron, JSON.stringify(job), { 'Content-Type': 'application/json' })
}

export async function forwardEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const response = await post(env, JOBS_PATHS.email, message.raw, {
    'Content-Type': 'message/rfc822',
    // Header values must be byte strings; an address may hold any Unicode.
    [EMAIL_HEADERS.to]: encodeURIComponent(message.to),
    [EMAIL_HEADERS.size]: String(message.rawSize)
  })
  const outcome = await response.json<EmailJobOutcome>()
  if (outcome.rejected !== undefined) message.setReject(outcome.rejected)
}
