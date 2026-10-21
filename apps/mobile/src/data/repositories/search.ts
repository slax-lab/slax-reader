import type {SqlDatabase} from './sql.ts';
import {RowWatcher} from './watch-rows.ts';
import type {SearchArticle, SearchLocalPort, SearchPage, SearchQuery} from '../../search/types.ts';
const title = "coalesce(nullif(b.alias_title, ''), json_extract(b.metadata, '$.bookmark.title'), '')";
const url = "coalesce(json_extract(b.metadata, '$.bookmark.target_url'), '')";
const description = "coalesce(json_extract(b.metadata, '$.bookmark.description'), '')";
const tagsMatch = `NOT EXISTS (SELECT 1 FROM json_each(?) wanted WHERE NOT EXISTS (SELECT 1 FROM json_each(coalesce(json_extract(b.metadata, '$.tags'), '[]')) actual WHERE actual.value = wanted.value))`;
export class SearchRepository implements SearchLocalPort {
  private rows: RowWatcher;
  private database: SqlDatabase;
  constructor(database: SqlDatabase) {this.database = database; this.rows = new RowWatcher(database);}
  watch(query: SearchQuery, limit: number, next: (page: SearchPage) => void, error: (error: Error) => void) {
    const text = query.text.trim().toLowerCase(), pattern = `%${text.replace(/[\\%_]/g, '\\$&')}%`;
    if (!text && !query.tagUuids.length) {next({items: [], hasMore: false}); return () => {};}
    const own = `SELECT 'own:' || b.id AS id, 'own' AS kind, b.id AS article_id, ${title} AS title, ${description} AS description, ${url} AS url, '' AS source, b.created_at AS time, b.id AS saved_id, NULL AS collection_id, NULL AS owner_id FROM sr_user_bookmark b WHERE b.deleted_at IS NULL AND ${tagsMatch}`;
    const collections = `SELECT DISTINCT 'collection:' || b.owner_id || ':' || b.id AS id, 'collection' AS kind, b.id AS article_id, ${title} AS title, ${description} AS description, ${url} AS url, c.display_name AS source, b.created_at AS time, (SELECT min(own.id) FROM sr_user_bookmark own WHERE own.deleted_at IS NULL AND json_extract(own.metadata, '$.bookmark.uuid') = json_extract(b.metadata, '$.bookmark.uuid')) AS saved_id, c.id AS collection_id, c.owner_id AS owner_id FROM sr_collection_bookmark b JOIN sr_user_collection c ON c.owner_id = b.owner_id JOIN sr_user_collection_subscriber s ON s.collection_id = c.id JOIN sr_sharer_setting setting ON setting.id = c.owner_id WHERE c.status = 1 AND setting.allow_access = 1 AND julianday(s.subscription_end_time) > julianday('now')`;
    const rss = `SELECT 'rss:' || e.id AS id, 'rss' AS kind, e.id AS article_id, e.title, e.summary AS description, coalesce(e.article_url, '') AS url, coalesce(nullif(s.remark, ''), f.title) AS source, e.sort_at AS time, (SELECT min(own.id) FROM sr_user_bookmark own WHERE own.deleted_at IS NULL AND json_extract(own.metadata, '$.bookmark.target_url') = e.article_url) AS saved_id, NULL AS collection_id, NULL AS owner_id FROM sr_rss_entry e JOIN sr_rss_subscription s ON s.feed_id = e.feed_id JOIN sr_rss_feed f ON f.id = e.feed_id`;
    // RSS availability is supplied by the feature controller, not inferred from remote calls.
    const sources = query.tagUuids.length ? own : `${own} UNION ALL ${collections} UNION ALL ${rss}`;
    const sql = `WITH candidates AS (${sources}) SELECT *, CASE WHEN lower(title) = ? THEN 0 WHEN lower(title) LIKE ? ESCAPE '\\' THEN 1 WHEN lower(title) LIKE ? ESCAPE '\\' THEN 2 ELSE 3 END AS rank FROM candidates WHERE lower(title || ' ' || description || ' ' || url || ' ' || source) LIKE ? ESCAPE '\\' ORDER BY rank, time DESC, id DESC LIMIT ?`;
    return this.rows.watchRows(sql, [JSON.stringify(query.tagUuids), text, `${text.replace(/[\\%_]/g, '\\$&')}%`, pattern, pattern, limit + 1], (rows: SearchArticle[]) => next({items: rows.slice(0, limit), hasMore: rows.length > limit}), error,
      row => ({key: String(row.id), kind: row.kind as SearchArticle['kind'], id: String(row.article_id), title: String(row.title ?? ''), description: String(row.description ?? ''), url: String(row.url ?? ''), source: String(row.source ?? ''), time: String(row.time ?? ''), ...(row.saved_id ? {savedId: String(row.saved_id)} : {}), ...(row.collection_id ? {collectionId: String(row.collection_id), ownerId: String(row.owner_id)} : {})}));
  }
  async admitRemote(ids: string[], tagUuids: string[]) {
    const rows = await this.database.getAll<{id: string; allowed: number}>(`SELECT b.id, CASE WHEN b.deleted_at IS NULL AND ${tagsMatch} THEN 1 ELSE 0 END AS allowed FROM sr_user_bookmark b WHERE b.id IN (SELECT value FROM json_each(?))`, [JSON.stringify(tagUuids), JSON.stringify(ids)]);
    return new Map(rows.map(row => [row.id, row.allowed === 1]));
  }
}
