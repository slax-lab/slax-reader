use powersync::schema::{Column, Index, IndexedColumn, Schema, Table, TrackPreviousValues};
/// Client-side view indexes; they do not alter synced columns or stream contracts.
fn index(name: &'static str, columns: &[(&'static str, &'static str)]) -> Index {
    Index {
        name: name.into(),
        columns: columns
            .iter()
            .map(|(name, type_name)| IndexedColumn {
                name: (*name).into(),
                ascending: true,
                type_name: (*type_name).into(),
            })
            .collect(),
    }
}
/// Version 2 matches the existing Mobile schema and sync-rule contract.
pub fn schema() -> Schema {
    Schema {
        raw_tables: vec![],
        tables: vec![
            Table::create(
                "sr_user",
                vec![
                    Column::text("email"),
                    Column::text("name"),
                    Column::text("picture"),
                    Column::text("given_name"),
                    Column::text("family_name"),
                    Column::text("lang"),
                    Column::text("ai_lang"),
                    Column::text("timezone"),
                    Column::text("account"),
                    Column::text("last_read_at"),
                    Column::text("invite_code"),
                ],
                |t| {
                    t.options.ignore_empty_updates = true;
                },
            ),
            Table::create(
                "sr_user_tag",
                vec![
                    Column::text("user_id"),
                    Column::text("tag_name"),
                    Column::text("display"),
                    Column::text("source"),
                    Column::text("last_used_at"),
                    Column::text("created_at"),
                ],
                |t| {
                    t.options.track_previous_values = Some(TrackPreviousValues {
                        column_filter: None,
                        only_when_changed: false,
                    });
                },
            ),
            Table::create(
                "sr_platform_bind",
                vec![
                    Column::text("user_id"),
                    Column::text("platform"),
                    Column::text("platform_id"),
                    Column::text("user_name"),
                    Column::text("created_at"),
                ],
                |_| {},
            ),
            Table::create(
                "sr_user_notification",
                vec![
                    Column::text("user_id"),
                    Column::text("type"),
                    Column::text("source"),
                    Column::text("title"),
                    Column::text("body"),
                    Column::text("details"),
                    Column::text("created_at"),
                    Column::integer("is_read"),
                ],
                |_| {},
            ),
            Table::create(
                "sr_user_bookmark",
                vec![
                    Column::text("user_id"),
                    Column::text("created_at"),
                    Column::text("updated_at"),
                    Column::text("alias_title"),
                    Column::text("deleted_at"),
                    Column::text("starred_at"),
                    Column::text("archived_at"),
                    Column::text("metadata"),
                    Column::integer("is_read"),
                    Column::integer("archive_status"),
                    Column::integer("is_starred"),
                    Column::integer("type"),
                ],
                |t| {
                    t.options.track_previous_values = Some(TrackPreviousValues {
                        column_filter: None,
                        only_when_changed: true,
                    });
                    t.indexes = vec![
                        index("created", &[("created_at", "TEXT")]),
                        index(
                            "archive_created",
                            &[("archive_status", "INTEGER"), ("created_at", "TEXT")],
                        ),
                        index(
                            "starred_created",
                            &[("is_starred", "INTEGER"), ("created_at", "TEXT")],
                        ),
                    ];
                },
            ),
            Table::create(
                "sr_user_subscription",
                vec![
                    Column::text("stripe_subscription_id"),
                    Column::text("stripe_customer_id"),
                    Column::text("stripe_stripe_currency"),
                    Column::text("first_subscription_time"),
                    Column::text("subscription_end_time"),
                    Column::text("next_invoice_time"),
                    Column::text("apple_original_transaction_id"),
                    Column::text("source_type"),
                    Column::integer("auto_renew"),
                    Column::integer("stripe_credit"),
                    Column::integer("subscribed"),
                ],
                |_| {},
            ),
            Table::create(
                "sr_user_collection_subscriber",
                vec![
                    Column::text("collection_id"),
                    Column::text("owner_id"),
                    Column::text("subscription_end_time"),
                    Column::text("next_invoice_time"),
                    Column::text("last_read_at"),
                    Column::text("created_at"),
                    Column::text("updated_at"),
                    Column::integer("auto_renew"),
                    Column::integer("is_cancelled"),
                ],
                |t| {
                    t.options.track_previous_values = Some(TrackPreviousValues {
                        column_filter: None,
                        only_when_changed: true,
                    });
                },
            ),
            Table::create(
                "sr_user_collection",
                vec![
                    Column::text("owner_id"),
                    Column::text("display_name"),
                    Column::text("avatar"),
                    Column::text("description"),
                    Column::text("collection_code"),
                    Column::text("updated_at"),
                    Column::integer("type"),
                    Column::integer("status"),
                ],
                |_| {},
            ),
            Table::create(
                "sr_sharer_setting",
                vec![
                    Column::integer("allow_highlight"),
                    Column::integer("show_highlight"),
                    Column::integer("allow_access"),
                ],
                |_| {},
            ),
            Table::create(
                "sr_collection_bookmark",
                vec![
                    Column::text("owner_id"),
                    Column::text("alias_title"),
                    Column::text("metadata"),
                    Column::text("starred_at"),
                    Column::text("created_at"),
                    Column::text("updated_at"),
                ],
                |t| {
                    t.indexes = vec![index("owner", &[("owner_id", "TEXT")])];
                },
            ),
            Table::create(
                "sr_user_bookmark_stats",
                vec![
                    Column::text("bookmark_uuid"),
                    Column::text("first_comment"),
                    Column::text("owner_id"),
                    Column::text("created_at"),
                    Column::integer("comment_count"),
                ],
                |_| {},
            ),
            Table::create(
                "sr_bookmark_comment",
                vec![
                    Column::text("source"),
                    Column::text("user_bookmark_uuid"),
                    Column::text("comment"),
                    Column::text("approx_source"),
                    Column::text("content"),
                    Column::text("created_at"),
                    Column::text("metadata"),
                    Column::integer("type"),
                    Column::integer("is_deleted"),
                ],
                |t| {
                    t.indexes = vec![index("bookmark", &[("user_bookmark_uuid", "TEXT")])];
                },
            ),
            Table::create(
                "local_bookmark_info",
                vec![
                    Column::text("overview"),
                    Column::text("key_takeaways"),
                    Column::integer("is_downloaded"),
                ],
                |t| {
                    t.options.local_only = true;
                },
            ),
        ],
    }
}
