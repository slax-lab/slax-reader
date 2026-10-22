import type {SystemCatalogBookmark} from '../data/repositories/types.ts';
import {Sha256} from '../data/pdf-sha256.ts';

export type BookmarkEntity = {id: string; title: string; subtitle: string; synonyms: string[]; metadata: {sourceHost: string}};
export const systemBookmarkId = (owner: string, id: string) => `b-${new Sha256().update(new TextEncoder().encode(JSON.stringify([owner, id]))).digest()}`;

/** Projects a bounded admitted local snapshot to the only fields OS discovery may retain. */
export function toBookmarkEntities(rows: readonly SystemCatalogBookmark[], owner = ''): BookmarkEntity[] {
  const entities: BookmarkEntity[] = [], ids = new Set<string>();
  for (const row of rows.slice(0, 500)) {
    if (row.status !== 'success' || row.archiveStatus !== 0 || !row.id || ids.has(row.id)) continue;
    const title = (row.aliasTitle.trim() || row.title.trim()).replace(/\s+/g, ' ').slice(0, 512);
    let host = '';
    try {
      const url = new URL(row.url);
      if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) continue;
      host = url.hostname.toLowerCase();
    } catch {continue;}
    if (!title || !host) continue;
    ids.add(row.id);
    entities.push({id: systemBookmarkId(owner, row.id), title, subtitle: host, synonyms: [], metadata: {sourceHost: host}});
  }
  return entities;
}
