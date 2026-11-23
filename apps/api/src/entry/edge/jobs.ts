import type { CoreJobs } from '../core/jobs'

// Edge stays the queue consumer, cron owner and Email Routing target it already is on every account, and forwards
// each event to Core, which runs the handlers next to the database. Service binding calls are not billed as requests.
type Jobs = Service<CoreJobs>

export async function forwardQueue(batch: MessageBatch, env: Env): Promise<void> {
  const jobs = env.CORE_JOBS as unknown as Jobs
  const messages = batch.messages.map(({ id, timestamp, body, attempts }) => ({ id, timestamp, body, attempts }))
  // A thrown call leaves every message to the queue's retry policy, as a failing local handler would.
  const outcome = await jobs.runQueue({ queue: batch.queue, metadata: batch.metadata, messages })
  const byId = new Map(batch.messages.map(message => [message.id, message]))
  for (const id of outcome.acked) byId.get(id)?.ack()
  for (const { id, delaySeconds } of outcome.retried) byId.get(id)?.retry(delaySeconds === undefined ? undefined : { delaySeconds })
  if (outcome.ackAll) batch.ackAll()
  if (outcome.retryAll) batch.retryAll(outcome.retryAll.delaySeconds === undefined ? undefined : { delaySeconds: outcome.retryAll.delaySeconds })
}

export async function forwardScheduled(controller: ScheduledController, env: Env): Promise<void> {
  await (env.CORE_JOBS as unknown as Jobs).runCron(controller.cron, controller.scheduledTime)
}

export async function forwardEmail(message: ForwardableEmailMessage, env: Env): Promise<void> {
  const outcome = await (env.CORE_JOBS as unknown as Jobs).receiveEmail({
    from: message.from,
    to: message.to,
    headers: [...message.headers],
    raw: message.raw,
    rawSize: message.rawSize
  })
  if (outcome.rejected !== undefined) message.setReject(outcome.rejected)
}
