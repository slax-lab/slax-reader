import type {SystemCatalogBookmark} from '../data/repositories/types.ts';

export type BookmarkEntity = {id: string; title: string; subtitle: string; synonyms: string[]; metadata: {sourceHost: string}};
/** Catalogs and donations are scoped to the current account, so the bookmark primary key is the identity. */
export const systemBookmarkId = (id: string) => `b-${id}`;
const LEGACY_HASHED_ID = /^b-[a-f0-9]{64}$/;
/** Resolves an OS-provided entity id: legacy hashed ids only through their recorded map entry, current ids by primary key. */
export function resolveSystemBookmarkId(entityId: string, legacy?: Record<string, string>): string | null {
  const mapped = legacy?.[entityId];
  if (typeof mapped === 'string' && mapped) return mapped;
  if (!entityId.startsWith('b-') || LEGACY_HASHED_ID.test(entityId)) return null;
  const id = entityId.slice(2);
  return /^[\w-]{1,128}$/.test(id) ? id : null;
}

/** Projects a bounded admitted local snapshot to the only fields OS discovery may retain. */
export function toBookmarkEntities(rows: readonly SystemCatalogBookmark[]): BookmarkEntity[] {
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
    entities.push({id: systemBookmarkId(row.id), title, subtitle: host, synonyms: [], metadata: {sourceHost: host}});
  }
  return entities;
}
