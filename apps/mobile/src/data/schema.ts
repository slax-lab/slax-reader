export type ColumnType = 'text' | 'integer';
export interface TableDefinition {
  text: string[]; integer?: string[];
  options?: { localOnly?: boolean; ignoreEmptyUpdates?: boolean; trackPrevious?: boolean | { onlyWhenChanged: boolean } };
}
/** The verified Kotlin adoption schema remains version 2. */
export const LEGACY_MOBILE_TABLES: Record<string, TableDefinition> = {
  sr_user: { text: ['email', 'name', 'picture', 'given_name', 'family_name', 'lang', 'ai_lang', 'timezone', 'account', 'last_read_at', 'invite_code'], options: { ignoreEmptyUpdates: true } },
  sr_user_tag: { text: ['user_id', 'tag_name', 'display', 'source', 'last_used_at', 'created_at'], options: { trackPrevious: true } },
  sr_platform_bind: { text: ['user_id', 'platform', 'platform_id', 'user_name', 'created_at'] },
  sr_user_notification: { text: ['user_id', 'type', 'source', 'title', 'body', 'details', 'created_at'], integer: ['is_read'] },
  sr_user_bookmark: { text: ['user_id', 'created_at', 'updated_at', 'alias_title', 'deleted_at', 'starred_at', 'archived_at', 'metadata'], integer: ['is_read', 'archive_status', 'is_starred', 'type'], options: { trackPrevious: { onlyWhenChanged: true } } },
  sr_user_subscription: { text: ['stripe_subscription_id', 'stripe_customer_id', 'stripe_stripe_currency', 'first_subscription_time', 'subscription_end_time', 'next_invoice_time', 'apple_original_transaction_id', 'source_type'], integer: ['auto_renew', 'stripe_credit', 'subscribed'] },
  sr_user_collection_subscriber: { text: ['collection_id', 'owner_id', 'subscription_end_time', 'next_invoice_time', 'last_read_at', 'created_at', 'updated_at'], integer: ['auto_renew', 'is_cancelled'], options: { trackPrevious: { onlyWhenChanged: true } } },
  sr_user_collection: { text: ['owner_id', 'display_name', 'avatar', 'description', 'collection_code', 'updated_at'], integer: ['type', 'status'] },
  sr_sharer_setting: { text: [], integer: ['allow_highlight', 'show_highlight', 'allow_access'] },
  sr_collection_bookmark: { text: ['owner_id', 'alias_title', 'metadata', 'starred_at', 'created_at', 'updated_at'] },
  sr_user_bookmark_stats: { text: ['bookmark_uuid', 'first_comment', 'owner_id', 'created_at'], integer: ['comment_count'] },
  sr_bookmark_comment: { text: ['source', 'user_bookmark_uuid', 'comment', 'approx_source', 'content', 'created_at', 'metadata'], integer: ['type', 'is_deleted'] },
  local_bookmark_info: { text: ['overview', 'key_takeaways'], integer: ['is_downloaded'], options: { localOnly: true } },
};
export const MOBILE_TABLES: Record<string, TableDefinition> = {
  ...LEGACY_MOBILE_TABLES,
  sr_rss_subscription: {text: ['feed_id', 'remark', 'created_at']},
  sr_rss_feed: {text: ['feed_url', 'title', 'site_url', 'icon_url', 'last_checked_at', 'last_success_at', 'next_fetch_at', 'next_allowed_at', 'error', 'refreshing_until']},
  sr_rss_entry: {text: ['feed_id', 'title', 'author', 'summary', 'article_url', 'image_url', 'published_at', 'first_seen_at', 'sort_at'], integer: ['content_truncated']},
};
export const SYNC_PARAMETERS = { schema_version: '2' };
export async function createMobileSchema(tables = MOBILE_TABLES) {
  const {Schema, Table, column} = await import('@powersync/react-native');
  return new Schema(Object.fromEntries(Object.entries(tables).map(([name, table]) => [name, new Table({
    ...Object.fromEntries(table.text.map(field => [field, column.text])),
    ...Object.fromEntries((table.integer ?? []).map(field => [field, column.integer])),
  }, table.options)])));
}
