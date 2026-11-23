// The internal protocol Edge uses to forward queue, cron and email events to Core over the CORE service binding.
// It travels as a fetch, not an RPC call, because placement applies only to fetch: Core then runs beside the
// database. Shared by both entries; it carries no runtime dependency.
export const JOBS_HOST = 'jobs.internal'
export const JOBS_PATHS = { queue: '/queue', cron: '/cron', email: '/email' } as const
// Email metadata travels URI-encoded in headers, so the raw message body streams unchanged.
export const EMAIL_HEADERS = { from: 'x-slax-email-from', to: 'x-slax-email-to', size: 'x-slax-email-size', headers: 'x-slax-email-headers' } as const

export interface QueueJobMessage {
  id: string
  timestamp: string
  body: unknown
  attempts: number
}

export interface QueueJobBatch {
  queue: string
  metadata: MessageBatchMetadata
  messages: QueueJobMessage[]
}

export interface QueueJobOutcome {
  // Per-message decisions the handler made; Edge applies them to the real batch.
  acked: string[]
  retried: { id: string; delaySeconds?: number }[]
  ackAll: boolean
  retryAll?: { delaySeconds?: number }
}

export interface CronJob {
  cron: string
  scheduledTime: number
}

export interface EmailJobOutcome {
  rejected?: string
}
