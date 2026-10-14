import type { CursorPage } from "./http.js";

/** Stable machine-readable RSS errors, carried by the existing API envelope. */
export type RssErrorCode =
  | "lab_disabled"
  | "invalid_feed"
  | "unsafe_url"
  | "limit_reached"
  | "refresh_limited"
  | "source_unavailable"
  | "not_found"
  | "article_url_missing"
  | "invalid_remark";

export interface RssErrorData {
  error: RssErrorCode;
  /** UTC ISO 8601; only present when a retry has a known lower bound. */
  next_allowed_at?: string;
}

/** Subscription URLs are private user data and must not be logged. */
export interface RssSubscription {
  id: string;
  feed_url: string;
  title: string;
  /** User-defined display name; null means use the feed title. */
  remark: string | null;
  site_url: string | null;
  /** Signed image-proxy URL for the site's favicon, or null when unavailable. */
  icon_url: string | null;
  refreshing: boolean;
  last_checked_at: string | null;
  last_success_at: string | null;
  next_fetch_at: string;
  next_allowed_at: string;
  error: RssErrorCode | null;
}

export interface AddRssSubscriptionRequest {
  url: string;
  remark?: string | null;
}

export interface UpdateRssSubscriptionRequest {
  remark: string | null;
}

export interface RssSubscriptionsResponse {
  items: RssSubscription[];
}

export interface RssRefreshResponse {
  status: "accepted" | "refreshing";
  next_allowed_at: string;
}

/** Query strings, before server-side validation. Cursor is opaque to clients. */
export interface RssEntriesQuery {
  subscription_id?: string;
  cursor?: string;
  limit?: string;
  /** Only a deliberate Load more request may fetch history from the source. */
  fetch_history?: string;
}

export interface RssEntry {
  id: string;
  subscription_id: string;
  source_title: string;
  title: string;
  author: string | null;
  summary: string;
  article_url: string | null;
  /** HTTPS signed cache URL only. Never fall back to the source image URL. */
  image_url: string | null;
  published_at: string | null;
  first_seen_at: string;
  /** Existing user-bookmark relation UUID, independent of the RSS cache. */
  bookmark_user_uuid: string | null;
}

export interface RssEntriesResponse extends CursorPage<RssEntry> {
  has_more: boolean;
  cached_more: boolean;
  history_status: "available" | "loading" | "retry" | "exhausted";
  retry_at: string | null;
}

export interface RssEntryDetail extends RssEntry {
  /** Server-sanitized fragment; image sources are signed cache URLs. */
  content_html: string;
  content_source: "feed";
  content_truncated: boolean;
}

export interface RssSaveResponse {
  bookmark_user_uuid: string;
  result: "created" | "restored" | "already_saved";
  processing_status: "pending" | "ready" | "failed";
}
