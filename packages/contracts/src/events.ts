import type { JsonValue } from './http.js'

/** Collection provenance only; never an identity or authorization claim. */
export type CollectionAuthAttribution = {
  collection_id: string
  source_screen: 'collection'
  presentation: 'modal'
  trigger_element_id: 'collection_subscribe_button'
}

/** Same 8-4-4-4-12 hexadecimal shape as sr_user_bookmark.uuid. */
export const SNAPSHOT_BOOKMARK_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Snapshot save provenance only; never an identity or authorization claim. */
export type SnapshotAuthAttribution = {
  source_screen: 'detail'
  presentation: 'modal'
  trigger_element_id: 'snapshot_save_button'
  source_bookmark_id: string
}

/** Sign-in modal provenance; acquisition-only HackerLinks context is excluded. */
export type LoginModalAttribution = CollectionAuthAttribution | SnapshotAuthAttribution

export type AcquisitionAuthAttribution = {
  source: 'hackerlinks'
  medium: 'header' | 'resource_detail'
  campaign: 'mvp'
}

export type WebAuthAttribution = CollectionAuthAttribution | SnapshotAuthAttribution | AcquisitionAuthAttribution

export const isCollectionAuthAttribution = (value: WebAuthAttribution | undefined): value is CollectionAuthAttribution => !!value && 'collection_id' in value

export const isSnapshotAuthAttribution = (value: WebAuthAttribution | undefined): value is SnapshotAuthAttribution =>
  !!value &&
  !isCollectionAuthAttribution(value) &&
  'source_bookmark_id' in value &&
  typeof value.source_bookmark_id === 'string' &&
  SNAPSHOT_BOOKMARK_ID_PATTERN.test(value.source_bookmark_id) &&
  value.source_screen === 'detail' &&
  value.presentation === 'modal' &&
  value.trigger_element_id === 'snapshot_save_button'

export const isAcquisitionAuthAttribution = (value: WebAuthAttribution | undefined): value is AcquisitionAuthAttribution =>
  !!value &&
  !isCollectionAuthAttribution(value) &&
  !isSnapshotAuthAttribution(value) &&
  'source' in value &&
  value.source === 'hackerlinks' &&
  'medium' in value &&
  ['header', 'resource_detail'].includes(value.medium) &&
  'campaign' in value &&
  value.campaign === 'mvp'

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
