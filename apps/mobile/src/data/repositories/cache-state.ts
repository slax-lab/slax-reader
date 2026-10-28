import {bookmarkCacheKey} from './records.ts';
import {RowWatcher} from './watch-rows.ts';
import type {SqlDatabase} from './sql.ts';

export const PERSONAL_CACHE_SQL = `SELECT id, type AS content_type, json_extract(metadata, '$.bookmark.status') AS status, updated_at FROM sr_user_bookmark WHERE archive_status = 0 AND deleted_at IS NULL ORDER BY created_at DESC`;
export const COLLECTION_CACHE_SQL = `SELECT DISTINCT cb.id, collection.owner_id, json_extract(cb.metadata, '$.bookmark.type') AS content_type, json_extract(cb.metadata, '$.bookmark.status') AS status, cb.updated_at FROM sr_user_collection_subscriber subscriber INNER JOIN sr_user_collection collection ON collection.id = subscriber.collection_id INNER JOIN sr_collection_bookmark cb ON cb.owner_id = collection.owner_id ORDER BY collection.owner_id, coalesce(nullif(cb.starred_at, ''), cb.created_at) DESC`;
export const LOCAL_CACHE_SQL = `SELECT id,
  json_extract(data, '$.is_downloaded') AS download_status,
  json_type(data, '$.is_downloaded') AS download_status_type,
  coalesce(json_type(data, '$.is_auto_cached') IN ('integer', 'real', 'false') AND json_extract(data, '$.is_auto_cached') = 0, 0) AS manual,
  CASE json_type(data, '$.pdf_cache')
    WHEN 'null' THEN 0 WHEN 'false' THEN 0
    WHEN 'integer' THEN json_extract(data, '$.pdf_cache') != 0
    WHEN 'real' THEN json_extract(data, '$.pdf_cache') != 0
    WHEN 'text' THEN json_extract(data, '$.pdf_cache') != ''
    ELSE json_type(data, '$.pdf_cache') IS NOT NULL END AS pdf_cache_present,
  CASE WHEN json_type(data, '$.pdf_cache.id') = 'text' THEN json_extract(data, '$.pdf_cache.id') END AS pdf_id,
  CASE WHEN json_type(data, '$.pdf_cache.owner') = 'text' THEN json_extract(data, '$.pdf_cache.owner') END AS pdf_owner
FROM ps_data_local__local_bookmark_info
WHERE CASE WHEN json_valid(data) THEN json_type(data) = 'object' AND (
  json_type(data, '$.is_downloaded') IS NOT NULL OR json_type(data, '$.is_auto_cached') IS NOT NULL OR json_type(data, '$.pdf_cache') IS NOT NULL
) ELSE 0 END`;

export type CacheTask = {id: string; key: string; owner?: string; domain: 'personal' | 'collection'; pdf: boolean};
export type CacheCandidate = CacheTask & {success: boolean; version?: string};
export type CacheLocalState = {id: string; manual: boolean; downloaded: boolean; cleared: boolean; pdfCachePresent: boolean; pdfId?: string; pdfOwner?: string; status?: number};

function candidate(row: Record<string, unknown>, domain: CacheTask['domain']): CacheCandidate {
  const id = String(row.id), owner = domain === 'collection' ? String(row.owner_id ?? '') : undefined;
  return {id, key: bookmarkCacheKey(id, owner), owner, domain, pdf: row.content_type === 'pdf' || Number(row.content_type) === 2, success: row.status === 'success', version: typeof row.updated_at === 'string' ? row.updated_at : ''};
}

function localState(row: Record<string, unknown>): CacheLocalState {
  const value = row.download_status_type === 'array' ? JSON.parse(String(row.download_status)) : row.download_status;
  const status = Number(row.download_status_type === null ? undefined : value);
  return {
    id: String(row.id), manual: row.manual === 1, downloaded: status === 2, cleared: status === 0, status: Number.isFinite(status) ? status : undefined,
    pdfCachePresent: row.pdf_cache_present === 1,
    pdfId: typeof row.pdf_id === 'string' ? row.pdf_id : undefined,
    pdfOwner: typeof row.pdf_owner === 'string' ? row.pdf_owner : undefined,
  };
}

export class CacheStateRepository {
  private readonly rows: RowWatcher;
  constructor(database: SqlDatabase) {this.rows = new RowWatcher(database);}
  watchPersonal(onRows: (rows: CacheCandidate[]) => void) {return this.rows.watchRows(PERSONAL_CACHE_SQL, [], onRows, undefined, row => candidate(row, 'personal'));}
  watchCollections(onRows: (rows: CacheCandidate[]) => void) {return this.rows.watchRows(COLLECTION_CACHE_SQL, [], onRows, undefined, row => candidate(row, 'collection'));}
  watchLocal(onRows: (rows: CacheLocalState[]) => void) {return this.rows.watchRows(LOCAL_CACHE_SQL, [], onRows, undefined, localState);}
}
