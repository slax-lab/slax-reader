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
/** Without newsletter_address, this only enables the Lab; no mailbox is issued. */
export interface NewsletterEnableSettingRequest {
  key: "lab:newsletter";
  newsletter_address?: string;
}
export type NewsletterErrorCode =
  | "account_required"
  | "invalid_account"
  | "address_reserved"
  | "address_changed"
  | "lab_disabled"
  | "unavailable"
  | "not_found"
  | "invalid_message"
  | "limit_reached";
export interface NewsletterErrorData {
  error: NewsletterErrorCode;
}

export type FeedSaveResponse = import("./rss.js").RssSaveResponse;

/** First Newsletter configuration only; issued addresses and general Reader accounts keep their policy. */
export function isNewsletterAccount(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]{6,15}$/.test(value);
}
