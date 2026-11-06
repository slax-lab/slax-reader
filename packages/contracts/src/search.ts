export interface HybridSearchRequest { keyword: string }
export type HybridSearchChannel = 'titles' | 'fulltext' | 'article_vector' | 'collection_vector';
export type HybridSearchArticleOrigin =
  | { kind: 'own'; bookmark_user_uuid: string; title: string }
  | { kind: 'collection'; collection_id: number; collection_code: string; owner_id: number; cb_id: number; bookmark_uuid: string; title: string };

export type HybridSearchEntity =
  | { type: 'article'; id: `article:${number}`; bookmark_id: number; title: string; target_url: string; origins: HybridSearchArticleOrigin[]; excerpt?: { text: string; source: 'indexed_text' } }
  | { type: 'collection'; id: `collection:${number}`; collection_id: number; collection_code: string; owner_id: number; title: string }
  | { type: 'rss_feed'; id: `rss_feed:${string}`; feed_id: string; subscription_id: string; title: string }
  | { type: 'rss_entry'; id: `rss_entry:${string}`; entry_id: string; feed_id: string; subscription_id: string; title: string; source_title: string; article_url: string | null };

export type HybridSearchEvidence =
  | { channel: 'titles'; rank: number }
  | { channel: 'fulltext'; rank: number; native_score: number; normalized_score: number }
  | { channel: 'article_vector' | 'collection_vector'; rank: number; native_score: number };
export type HybridSearchHit = HybridSearchEntity & { matched_channels: HybridSearchChannel[]; evidence: HybridSearchEvidence[]; rrf_score: number };
export interface HybridSearchCoverage {
  exhausted: boolean;
  truncated: boolean;
  reasons: Array<'candidate_limit' | 'scan_budget' | 'index_only' | 'no_searchable_terms'>;
}
export type HybridSearchErrorCode = 'embedding_failed' | 'embedding_timeout' | 'retrieval_failed' | 'admission_failed';
export type HybridSearchChannelSuccess = { status: 'ok' | 'empty'; count: number; coverage: HybridSearchCoverage };
export type HybridSearchChannelFailure = { status: 'error'; code: HybridSearchErrorCode };
export type HybridSearchChannelOutcome = HybridSearchChannelSuccess | HybridSearchChannelFailure;
export type HybridSearchEvent =
  | { type: 'partial'; channel: HybridSearchChannel; results: HybridSearchHit[]; outcome: HybridSearchChannelSuccess }
  | { type: 'channel_error'; channel: HybridSearchChannel; outcome: HybridSearchChannelFailure }
  | { type: 'complete'; results: HybridSearchHit[]; channels: Record<HybridSearchChannel, HybridSearchChannelOutcome>; incomplete: boolean; replaces_partials: true };

export function parseHybridSearchRequest(value: unknown): HybridSearchRequest | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;
  if (Object.keys(input).some(key => key !== 'keyword') || typeof input.keyword !== 'string') return null;
  const keyword = input.keyword.trim();
  if (!keyword || [...input.keyword].length > 500) return null;
  return { keyword };
}

export interface BookmarkSearchRequest {keyword: string; tag_uuids?: string[]}
export interface BookmarkSearchHit {
  bookmark_id: string | number; bookmark_user_uuid?: string;
  highlight_title: string; highlight_content: string;
  /** Added metadata; optional while clients may still reach an older API. */
  target_url?: string;
  /** ISO 8601 time when the active user saved the article. */
  created_at?: string;
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
