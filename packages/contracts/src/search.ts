export interface BookmarkSearchRequest {keyword: string; tag_uuids?: string[]}
export interface BookmarkSearchHit {
  bookmark_id: string | number; bookmark_user_uuid?: string;
  highlight_title: string; highlight_content: string;
  final_score: number; vs_score: number; fts_score: number; type: 'fts' | 'vector' | 'hybrid';
}
export function parseBookmarkSearchRequest(value: unknown): BookmarkSearchRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (typeof input.keyword !== 'string') return null;
  const keyword = input.keyword.trim();
  if (!keyword || [...keyword].length > 500) return null;
  const tags = input.tag_uuids;
  if (tags !== undefined && (!Array.isArray(tags) || tags.length > 20 || tags.some(tag => typeof tag !== 'string' || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(tag)))) return null;
  return {keyword, ...(tags === undefined ? {} : {tag_uuids: [...new Set((tags as string[]).map(tag => tag.toLowerCase()))]})};
}
