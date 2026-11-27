import { toUtcDate } from '@/utils/date'

import { hasUnread, type LocalCollectionRow, SUBSCRIBED_SQL } from '@/composables/bookmark/useLocalCollections'
import type { PopupBookmarkCheckpoint, PopupSaveNotification, PopupSaveState, PopupSubscriptionNotification } from '@commons/frontend-types/frontend'
import type { PowerSyncDatabase } from '@powersync/web'

const STATUS = "JSON_EXTRACT(metadata, '$.bookmark.status')"
export const POPUP_BOOKMARK_READABLE_SQL = `(COALESCE(type, 0) <> 1 AND
  (COALESCE(${STATUS}, '') = 'success' OR
    (type = 2 AND COALESCE(JSON_EXTRACT(metadata, '$.pdf_document_id'), '') <> '')))`

export const POPUP_NOTIFICATION_TABLES = ['sr_user_bookmark', 'sr_user_collection', 'sr_user_collection_subscriber', 'sr_collection_bookmark']

export async function readPopupInboxCheckpoint(db: PowerSyncDatabase, userKey: string): Promise<PopupBookmarkCheckpoint> {
  return db.readTransaction(async tx => {
    const seenAt = Date.now()
    const rows = await tx.getAll<{ id: string; created_at: string; ready: number }>(
      `SELECT id, created_at, ${POPUP_BOOKMARK_READABLE_SQL} AS ready
       FROM sr_user_bookmark
       WHERE deleted_at IS NULL AND (${POPUP_BOOKMARK_READABLE_SQL} OR ${STATUS} IN ('pending', 'pending_retry', 'parseing'))`
    )
    const ready: PopupBookmarkCheckpoint['ready'] = []
    const pendingIds: string[] = []
    for (const row of rows) {
      if (!row.ready) pendingIds.push(row.id)
      else {
        const createdAt = toUtcDate(row.created_at).getTime()
        if (Number.isFinite(createdAt)) ready.push({ id: row.id, createdAt })
      }
    }
    return { userKey, seenAt, ready, pendingIds }
  })
}

export async function readPopupNotifications(db: PowerSyncDatabase, state: PopupSaveState) {
  return db.readTransaction(async tx => {
    const collections = await tx.getAll<LocalCollectionRow>(SUBSCRIBED_SQL)
    const subscriptions: PopupSubscriptionNotification[] = collections
      .filter(row => row.status === 1 && row.code && hasUnread(row.last_read_at, row.latest_article_at))
      .map(row => ({
        kind: 'subscription' as const,
        id: row.code!,
        title: row.name ?? '',
        throughAt: toUtcDate(row.latest_article_at!).toISOString()
      }))
      .sort((a, b) => b.throughAt.localeCompare(a.throughAt) || a.id.localeCompare(b.id))
      .slice(0, 2)
    const saveLimit = subscriptions.length ? 1 : 2
    const saves = await tx.getAll<PopupSaveNotification>(
      `SELECT 'save' AS kind, id,
          COALESCE(NULLIF(alias_title, ''), NULLIF(JSON_EXTRACT(metadata, '$.bookmark.title'), ''),
            JSON_EXTRACT(metadata, '$.bookmark.target_url'), '') AS title
       FROM sr_user_bookmark
       WHERE deleted_at IS NULL AND ${POPUP_BOOKMARK_READABLE_SQL}
         AND (julianday(created_at) > julianday(?) OR id IN (SELECT value FROM json_each(?)))
         AND id NOT IN (SELECT value FROM json_each(?))
       ORDER BY julianday(created_at) DESC, id
       LIMIT ?`,
      [new Date(state.inboxSeenAt).toISOString(), JSON.stringify(state.pendingAtInboxIds), JSON.stringify(state.dismissedIds), saveLimit]
    )
    return { subscriptions, saves }
  })
}
