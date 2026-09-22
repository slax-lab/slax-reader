import type { JsonValue } from './http.js'

/** POST /events. User identity is supplied by authentication, never this body. */
export interface ClientEvent {
  event_name: string
  occurred_at?: string | number
  properties?: Record<string, JsonValue>
}
export interface EventsRequest {
  events: ClientEvent[]
}
/** /events uses a bare JSON response, not ApiResponse. */
export interface EventsResponse {
  received: number
  dropped: number
}
export interface EventsErrorResponse {
  error: string
}
