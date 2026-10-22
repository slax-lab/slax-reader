import type {SqlDatabase, SqlTransaction} from './sql.ts';
import {bookmarkCacheKey} from './records.ts';
import {RowWatcher} from './watch-rows.ts';
import {decodeOfflineTask} from './offline-tasks.ts';
import {validResourceFingerprint, type ResourceFingerprint} from '../resource-fingerprint.ts';

const FIELD = '$._slax_offline';
export type OfflineImageState = {url: string; state: 'pending' | 'ready' | 'failed' | 'denied'; attempts: number; retryAt: number};
export type OfflineManifest = {
  version: 1; scope: string; generation: string; revision: number;
  id: string; owner: string | null; body: 'pending' | 'ready'; images: OfflineImageState[]; fingerprint?: ResourceFingerprint;
};
export type OfflineManifestHint = {id: string; generation: string; revision: number; owner: string | null; retryAt: number};
const validId = (value: unknown): value is string => typeof value === 'string' && /^[\w-]+$/.test(value);
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

function imageUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password;} catch {return false;}
}

export function decodeOfflineManifest(encoded: string, key: string, scope: string): OfflineManifest {
  const value: unknown = JSON.parse(encoded);
  if (!object(value) || value.version !== 1 || value.scope !== scope || !validId(value.generation) || !integer(value.revision) ||
      !validId(value.id) || value.owner !== null && !validId(value.owner) || bookmarkCacheKey(value.id, value.owner as string | null) !== key ||
      !['pending', 'ready'].includes(String(value.body)) || !Array.isArray(value.images) || value.fingerprint !== undefined && !validResourceFingerprint(value.fingerprint)) throw new Error('Offline resource manifest is incompatible');
  const seen = new Set<string>();
  for (const image of value.images) {
    if (!object(image) || !imageUrl(image.url) || seen.has(image.url) || !['pending', 'ready', 'failed', 'denied'].includes(String(image.state)) || !integer(image.attempts) || !integer(image.retryAt)) throw new Error('Offline image manifest is invalid');
    seen.add(image.url);
  }
  return value as OfflineManifest;
}

export class OfflineManifestRepository {
  private readonly database: SqlDatabase;
  private readonly scope: string;
  private readonly identifier: () => string;
  private readonly guard: () => void;

  constructor(database: SqlDatabase, scope: string, identifier: () => string, guard: () => void) {
    if (!scope) throw new Error('Offline cache scope is required');
    this.database = database; this.scope = scope; this.identifier = identifier; this.guard = guard;
  }

  private async readFrom(database: Pick<SqlTransaction, 'getOptional'>, key: string): Promise<OfflineManifest | null> {
    this.guard();
    const row = await database.getOptional<{manifest: string | null}>(`SELECT json_extract(data, ?) AS manifest FROM ps_data_local__local_bookmark_info WHERE id = ?`, [FIELD, key]);
    this.guard();
    return row?.manifest == null ? null : decodeOfflineManifest(row.manifest, key, this.scope);
  }

  read(key: string) {return this.readFrom(this.database, key);}

  async prepare(id: string, owner: string | undefined, urls: readonly string[], fingerprint?: ResourceFingerprint): Promise<OfflineManifest> {
    this.guard();
    const key = bookmarkCacheKey(id, owner), generation = this.identifier();
    const manifest: OfflineManifest = {version: 1, scope: this.scope, generation, revision: 0, id, owner: owner ?? null, body: 'pending', fingerprint, images: [...new Set(urls.filter(imageUrl))].map(url => ({url, state: 'pending', attempts: 0, retryAt: 0}))};
    decodeOfflineManifest(JSON.stringify(manifest), key, this.scope);
    let next = manifest;
    await this.database.writeTransaction(async tx => {
      const previous = await this.readFrom(tx, key); this.guard();
      const images = new Map(previous?.images.map(image => [image.url, image]));
      next = {...previous, ...manifest, images: manifest.images.map(image => ({...images.get(image.url), ...image, state: images.get(image.url)?.state === 'ready' ? 'ready' : 'pending'}))};
      const encoded = JSON.stringify(next);
      await tx.execute(`INSERT INTO ps_data_local__local_bookmark_info(id, data) VALUES (?, json_object('_slax_offline', json(?)))
        ON CONFLICT(id) DO UPDATE SET data = json_set(data, ?, json(?))`, [key, encoded, FIELD, encoded]);
      this.guard();
    });
    return next;
  }

  async ready(key: string, generation: string): Promise<void> {
    this.guard();
    await this.database.writeTransaction(async tx => {
      this.guard();
      await tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_set(data, '$._slax_offline.body', 'ready',
        '$._slax_offline.revision', json_extract(data, '$._slax_offline.revision') + 1, '$.is_downloaded', 2, '$.is_auto_cached',
        CASE WHEN json_type(data, '$.is_auto_cached') IN ('integer', 'real', 'false') AND json_extract(data, '$.is_auto_cached') = 0 THEN 0 ELSE 1 END)
        WHERE id = ? AND json_extract(data, '$._slax_offline.version') = 1 AND json_extract(data, '$._slax_offline.scope') = ? AND json_extract(data, '$._slax_offline.generation') = ?`, [key, this.scope, generation]);
      this.guard();
    });
  }

  async image(key: string, generation: string, value: OfflineImageState): Promise<void> {
    this.guard();
    if (!imageUrl(value.url) || !['pending', 'ready', 'failed', 'denied'].includes(value.state) || !integer(value.attempts) || !integer(value.retryAt)) throw new Error('Offline image update is invalid');
    await this.database.writeTransaction(async tx => {
      this.guard();
      await tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_set(data,
        '$._slax_offline.images[' || (SELECT key FROM json_each(data, '$._slax_offline.images') WHERE json_extract(value, '$.url') = ?) || ']',
        json_patch((SELECT value FROM json_each(data, '$._slax_offline.images') WHERE json_extract(value, '$.url') = ?), json(?)),
        '$._slax_offline.revision', json_extract(data, '$._slax_offline.revision') + 1)
        WHERE id = ? AND json_extract(data, '$._slax_offline.version') = 1 AND json_extract(data, '$._slax_offline.scope') = ? AND json_extract(data, '$._slax_offline.generation') = ?
        AND EXISTS (SELECT 1 FROM json_each(data, '$._slax_offline.images') WHERE json_extract(value, '$.url') = ?)`, [value.url, value.url, JSON.stringify({state: value.state, attempts: value.attempts, retryAt: value.retryAt}), key, this.scope, generation, value.url]);
      this.guard();
    });
  }

  async remove(key: string, generation: string): Promise<void> {
    this.guard();
    await this.database.writeTransaction(async tx => {
      this.guard();
      await tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_remove(data, ?)
        WHERE id = ? AND json_extract(data, '$._slax_offline.version') = 1 AND json_extract(data, '$._slax_offline.scope') = ? AND json_extract(data, '$._slax_offline.generation') = ?`, [FIELD, key, this.scope, generation]);
      this.guard();
    });
  }

  async interrupted(): Promise<string[]> {
    this.guard();
    const rows = await this.database.getAll<{id: string}>(`SELECT id FROM ps_data_local__local_bookmark_info
      WHERE CASE WHEN json_valid(data) THEN json_extract(data, '$._slax_offline.version') = 1
        AND json_extract(data, '$._slax_offline.scope') = ? AND json_type(data, '$._slax_offline.fingerprint') = 'object'
        AND json_extract(data, '$.is_downloaded') IN (1, 3, '1', '3') ELSE 0 END`, [this.scope]);
    this.guard(); return rows.map(row => row.id);
  }

  async recover(key: string, generation: string, fingerprint: ResourceFingerprint): Promise<boolean> {
    this.guard();
    return this.database.writeTransaction(async tx => {
      const manifest = await this.readFrom(tx, key); this.guard();
      if (manifest?.generation !== generation || manifest.fingerprint?.sha256 !== fingerprint.sha256 || manifest.fingerprint?.size !== fingerprint.size) return false;
      const row = await tx.getOptional<{status: unknown; retry: unknown; retryType: string | null}>(`SELECT json_extract(data, '$.is_downloaded') AS status,
        json_extract(data, '$._slax_offline_retry') AS retry, json_type(data, '$._slax_offline_retry') AS retryType FROM ps_data_local__local_bookmark_info WHERE id = ?`, [key]);
      this.guard(); if (!row || ![1, 3].includes(Number(row.status))) return false;
      if (row.retryType !== null) {
        try {const retry = decodeOfflineTask(row.retry, this.scope); if (retry.kind !== 'article' || retry.state === 'denied') return false;}
        catch {return false;}
      }
      await tx.execute(`UPDATE ps_data_local__local_bookmark_info SET data = json_remove(json_set(data,
        '$._slax_offline.body', 'ready', '$._slax_offline.revision', json_extract(data, '$._slax_offline.revision') + 1,
        '$.is_downloaded', 2, '$.is_auto_cached', CASE WHEN json_type(data, '$.is_auto_cached') IN ('integer', 'real', 'false') AND json_extract(data, '$.is_auto_cached') = 0 THEN 0 ELSE 1 END), '$._slax_offline_retry') WHERE id = ?`, [key]);
      this.guard(); return true;
    });
  }

  watch(onRows: (rows: OfflineManifestHint[]) => void): () => void {
    return new RowWatcher(this.database).watchRows<OfflineManifestHint>(`SELECT id,
      json_extract(data, '$._slax_offline.generation') AS generation,
      json_extract(data, '$._slax_offline.revision') AS revision,
      json_extract(data, '$._slax_offline.owner') AS owner,
      (SELECT min(coalesce(json_extract(value, '$.retryAt'), 0)) FROM json_each(data, '$._slax_offline.images') WHERE CASE WHEN type = 'object' THEN json_extract(value, '$.state') IN ('pending', 'failed') ELSE 0 END) AS retryAt
      FROM ps_data_local__local_bookmark_info
      WHERE CASE WHEN json_valid(data) THEN json_extract(data, '$._slax_offline.version') = 1
        AND json_extract(data, '$._slax_offline.scope') = ? AND json_extract(data, '$._slax_offline.body') = 'ready'
        AND EXISTS (SELECT 1 FROM json_each(data, '$._slax_offline.images') WHERE CASE WHEN type = 'object' THEN json_extract(value, '$.state') IN ('pending', 'failed') ELSE 0 END) ELSE 0 END`, [this.scope], rows => {this.guard(); onRows(rows);});
  }
}
