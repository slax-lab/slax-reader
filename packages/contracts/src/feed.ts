import type {
  RssEntriesQuery,
  RssEntriesResponse,
  RssEntry,
  RssSubscription,
} from "./rss.js";

export type FeedKind = "rss" | "newsletter";

export type FeedSubscription =
  | (RssSubscription & { kind: "rss" })
  | {
      id: string;
      kind: "newsletter";
      title: string;
      sender: string;
    };

export interface FeedSubscriptionsResponse {
  items: FeedSubscription[];
}

export type FeedEntriesQuery = RssEntriesQuery;

export interface FeedEntry extends RssEntry {
  kind: FeedKind;
}

export interface FeedEntryDetail extends FeedEntry {
  /** Server-sanitized fragment; remote images use the signed cache proxy. */
  content_html: string;
  content_source: "feed";
  content_truncated: boolean;
}

export interface FeedEntriesResponse extends Omit<RssEntriesResponse, "items"> {
  items: FeedEntry[];
}

/** An issued address remains unchanged after account/display-name changes. */
export interface NewsletterAddressResponse {
  address: string | null;
  domain: string | null;
  status:
    | "ready"
    | "account_required"
    | "invalid_account"
    | "unavailable"
    | "not_provisioned"
    | "address_reserved";
}
export type NewsletterErrorCode =
  | "account_required"
  | "invalid_account"
  | "address_reserved"
  | "lab_disabled"
  | "unavailable"
  | "not_found"
  | "invalid_message"
  | "limit_reached";
export interface NewsletterErrorData {
  error: NewsletterErrorCode;
}

export type FeedSaveResponse = import("./rss.js").RssSaveResponse;
