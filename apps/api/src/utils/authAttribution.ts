import {
  SNAPSHOT_BOOKMARK_ID_PATTERN,
  type AcquisitionAuthAttribution,
  type CollectionAuthAttribution,
  type SnapshotAuthAttribution,
  type WebAuthAttribution
} from '@slax-reader/contracts/events'

type Shape<T> = (value: Record<string, unknown>) => T | undefined

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const collection: Shape<CollectionAuthAttribution> = value =>
  typeof value.collection_id === 'string' &&
  value.collection_id.length >= 1 &&
  value.collection_id.length <= 64 &&
  /^[a-zA-Z0-9]+$/.test(value.collection_id) &&
  value.source_screen === 'collection' &&
  value.presentation === 'modal' &&
  value.trigger_element_id === 'collection_subscribe_button'
    ? { collection_id: value.collection_id, source_screen: 'collection', presentation: 'modal', trigger_element_id: 'collection_subscribe_button' }
    : undefined

const snapshot: Shape<SnapshotAuthAttribution> = value =>
  value.source_screen === 'detail' &&
  value.presentation === 'modal' &&
  value.trigger_element_id === 'snapshot_save_button' &&
  typeof value.source_bookmark_id === 'string' &&
  SNAPSHOT_BOOKMARK_ID_PATTERN.test(value.source_bookmark_id)
    ? { source_screen: 'detail', presentation: 'modal', trigger_element_id: 'snapshot_save_button', source_bookmark_id: value.source_bookmark_id }
    : undefined

const acquisition: Shape<AcquisitionAuthAttribution> = value =>
  value.source === 'hackerlinks' && (value.medium === 'header' || value.medium === 'resource_detail') && value.campaign === 'mvp'
    ? { source: 'hackerlinks', medium: value.medium, campaign: 'mvp' }
    : undefined

// Client attribution is untrusted analytics context: the first matching shape wins and unknown keys are dropped.
const first =
  <T>(shapes: Shape<T>[]) =>
  (value: unknown): T | undefined => {
    const input = record(value)
    if (!input) return undefined
    for (const shape of shapes) {
      const parsed = shape(input)
      if (parsed) return parsed
    }
    return undefined
  }

export const parseWebAuthAttribution: (value: unknown) => WebAuthAttribution | undefined = first<WebAuthAttribution>([collection, snapshot, acquisition])
export const parseAppleAuthAttribution: (value: unknown) => SnapshotAuthAttribution | AcquisitionAuthAttribution | undefined = first<
  SnapshotAuthAttribution | AcquisitionAuthAttribution
>([snapshot, acquisition])
