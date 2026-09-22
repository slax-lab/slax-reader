import type { ClientEvent, EventsResponse, EventsErrorResponse } from '@slax-reader/contracts'
import { ContextManager } from '@/utils/context'
import { Controller } from '../../decorators/controller'
import { Post } from '../../decorators/route'
import { resolveDeviceId } from '../../utils/deviceId'
import { corsHeader } from '../../middleware/cors'

const MAX_EVENTS = 50
const MAX_BODY_BYTES = 100 * 1024

type IncomingEvent = { [Key in keyof ClientEvent]?: unknown }

const json = (data: EventsResponse | EventsErrorResponse, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      ...corsHeader
    }
  })

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value)

const validOccurredAt = (value: unknown): value is string | number => {
  if (typeof value === 'number') return Number.isFinite(value)
  if (typeof value !== 'string' || value.trim() === '') return false
  return !Number.isNaN(Date.parse(value))
}

@Controller('/')
export class EventsController {
  @Post('/events')
  public async handleEvents(ctx: ContextManager, request: Request): Promise<Response> {
    const contentLength = Number(request.headers.get('content-length') || 0)
    if (contentLength > MAX_BODY_BYTES) return json({ error: 'payload too large' }, 400)

    let raw: string
    try {
      raw = await request.text()
    } catch {
      return json({ error: 'invalid request body' }, 400)
    }

    if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) return json({ error: 'payload too large' }, 400)

    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return json({ error: 'invalid json' }, 400)
    }

    if (!isRecord(body) || !Array.isArray(body.events) || body.events.length > MAX_EVENTS) return json({ error: 'invalid events payload' }, 400)

    const deviceId = resolveDeviceId(request)

    const receivedAt = new Date().toISOString()
    const records: Record<string, unknown>[] = []
    let dropped = 0

    for (const value of body.events) {
      if (!isRecord(value)) return json({ error: 'invalid event' }, 400)

      const event = value as IncomingEvent
      if (typeof event.event_name !== 'string' || event.event_name.trim() === '') {
        dropped++
        continue
      }
      if (event.occurred_at !== undefined && !validOccurredAt(event.occurred_at)) return json({ error: 'invalid occurred_at' }, 400)
      if (event.properties !== undefined && !isRecord(event.properties)) return json({ error: 'invalid properties' }, 400)

      records.push({
        event_name: event.event_name,
        occurred_at: event.occurred_at ?? receivedAt,
        received_at: receivedAt,
        user_id: ctx.getUserId(),
        device_id: deviceId,
        properties: event.properties ?? {},
        ua: request.headers.get('user-agent') || undefined
      })
    }

    if (records.length > 0 && !deviceId) return json({ error: 'missing device_id: send X-Device-ID' }, 400)

    if (records.length > 0) {
      ctx.execution.waitUntil(
        Promise.resolve()
          .then(() => ctx.env.SLAX_READER_STREAM_STREAM.send(records))
          .catch(error => {
            console.error(`[events] failed to submit ${records.length} event(s):`, error)
          })
      )
    }

    return json({ received: records.length, dropped })
  }
}
