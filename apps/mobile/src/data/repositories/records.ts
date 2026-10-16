import {parseSourceTimestamp} from '../../utils/source-time.ts';
import type {BookmarkRecord, CollectionRecord} from './types.ts';

const text = (value: unknown) => typeof value === 'string' ? value : '';

export function bookmark(row: Readonly<Record<string, unknown>>): BookmarkRecord {
  return {
    contentType: row.content_type === 'pdf' || Number(row.content_type) === 2
      ? 'pdf'
      : row.content_type === 'shortcut' || Number(row.content_type) === 1 ? 'shortcut' : 'article',
    id: text(row.id),
    userId: text(row.user_id),
    ...(row.owner_id ? {ownerId: text(row.owner_id)} : {}),
    aliasTitle: text(row.alias_title),
    title: text(row.metadata_title),
    url: text(row.metadata_url),
    status: text(row.metadata_status),
    createdAt: text(row.created_at),
    updatedAt: text(row.updated_at),
    archiveStatus: Number(row.archive_status ?? 0),
    isStarred: Number(row.is_starred ?? 0),
    isRead: Number(row.is_read ?? 0),
    metadata: typeof row.metadata === 'string' ? row.metadata : null,
    downloadStatus: Number(row.download_status ?? 0),
    isAutoCached: Number(row.is_auto_cached ?? 1) === 1,
  };
}

export function collection(row: Readonly<Record<string, unknown>>): CollectionRecord {
  const latestArticleAt = text(row.latest_article_at);
  const lastReadAt = text(row.last_read_at);
  const latestTimestamp = parseSourceTimestamp(latestArticleAt);
  const lastReadTimestamp = parseSourceTimestamp(lastReadAt);
  return {
    id: text(row.id),
    code: text(row.collection_code),
    name: text(row.display_name),
    avatar: text(row.avatar),
    description: text(row.description),
    ownerId: text(row.owner_id),
    type: Number(row.type ?? 1),
    status: Number(row.status ?? 0),
    subscriptionEndTime: text(row.subscription_end_time),
    subscribedAt: text(row.subscribed_at),
    isCancelled: Number(row.is_cancelled) === 1,
    lastReadAt,
    latestArticleAt,
    hasNew: Number.isFinite(latestTimestamp) && (!Number.isFinite(lastReadTimestamp) || latestTimestamp > lastReadTimestamp),
  };
}

export function bookmarkDisplayTitle(record: Readonly<BookmarkRecord>) {
  return (record.aliasTitle.trim() || record.title.trim() || record.url || record.id.slice(0, 5))
    .replace(/\s+/g, ' ')
    .trim();
}

export function bookmarkCacheKey(bookmarkId: string, ownerId?: string | null) {
  return ownerId ? `collection-${ownerId}-${bookmarkId}` : bookmarkId;
}
