export interface CollectionSubscriptionRecord {
  is_deleted: boolean
  is_active: boolean
  subscription_end_time: Date
}

export interface CollectionAccessTarget {
  status: number
}

export function hasActiveCollectionSubscription(
  record: CollectionSubscriptionRecord | null | undefined,
  collection: CollectionAccessTarget | null | undefined,
  now: Date = new Date()
): boolean {
  return !!record && !record.is_deleted && record.is_active && record.subscription_end_time > now && collection?.status === 1
}
