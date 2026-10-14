import type {
  ApiResponse,
  RssEntriesResponse,
  RssEntryDetail,
  RssSaveResponse,
} from "@slax-reader/contracts";
import type { RssErrorData, RssSubscription } from "@slax-reader/contracts/rss";

const subscription: RssSubscription = {
  id: "subscription-uuid",
  feed_url: "https://example.com/feed.xml",
  title: "Example",
  remark: null,
  site_url: null,
  icon_url: null,
  refreshing: false,
  last_checked_at: null,
  last_success_at: null,
  next_fetch_at: "2026-09-22T00:30:00.000Z",
  next_allowed_at: "2026-09-22T00:05:00.000Z",
  error: null,
};
const detail: RssEntryDetail = {
  id: "entry-uuid",
  subscription_id: subscription.id,
  source_title: subscription.title,
  title: "Example article",
  author: null,
  summary: "A summary",
  article_url: null,
  image_url: null,
  published_at: null,
  first_seen_at: "2026-09-22T00:00:00.000Z",
  bookmark_user_uuid: null,
  content_html: "<p>A summary</p>",
  content_source: "feed",
  content_truncated: false,
};
const page: ApiResponse<RssEntriesResponse> = {
  code: 200,
  message: "ok",
  data: {
    items: [detail],
    next_cursor: null,
    has_more: false,
    cached_more: false,
    history_status: "exhausted",
    retry_at: null,
  },
};
const saved: RssSaveResponse = {
  bookmark_user_uuid: "bookmark-user-uuid",
  result: "already_saved",
  processing_status: "ready",
};
const error: ApiResponse<RssErrorData> = {
  code: 429,
  message: "Refresh later",
  data: {
    error: "refresh_limited",
    next_allowed_at: subscription.next_allowed_at,
  },
};
// @ts-expect-error RSS identifiers cannot reuse the legacy numeric bookmark IDs.
const invalidId: RssEntryDetail = { ...detail, id: 42 };
// @ts-expect-error Clients receive a JSON timestamp, not a Date instance.
const invalidDate: RssEntryDetail = { ...detail, published_at: new Date() };
// @ts-expect-error An empty bookmark ID is not an alternative result shape.
const legacySave: RssSaveResponse = { bmId: "" };
// @ts-expect-error A nullable continuation cursor is required even on the last page.
const missingCursor: RssEntriesResponse = { items: [] };
void [
  subscription,
  detail,
  page,
  saved,
  error,
  invalidId,
  invalidDate,
  legacySave,
  missingCursor,
];
