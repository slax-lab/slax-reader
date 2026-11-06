import type { JsonValue } from './http.js'

/** Collection provenance only; never an identity or authorization claim. */
export type CollectionAuthAttribution = {
  collection_id: string
  source_screen: 'collection'
  presentation: 'modal'
  trigger_element_id: 'collection_subscribe_button'
}

export type AcquisitionAuthAttribution = {
  source: 'hackerlinks'
  medium: 'header' | 'resource_detail'
  campaign: 'mvp'
}

export type WebAuthAttribution = CollectionAuthAttribution | AcquisitionAuthAttribution

export const isCollectionAuthAttribution = (value: WebAuthAttribution | undefined): value is CollectionAuthAttribution => !!value && 'collection_id' in value

export const isAcquisitionAuthAttribution = (value: WebAuthAttribution | undefined): value is AcquisitionAuthAttribution => !!value && !isCollectionAuthAttribution(value)

export type CollectionOpenedProperties = {
  collection_id: string
  opened_from: 'external_link' | 'inbox'
  surface: 'public_page' | 'inbox'
}

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
