package com.slax.reader.data.database

import com.powersync.db.schema.Column
import com.powersync.db.schema.Schema
import com.powersync.db.schema.Table
import com.powersync.db.schema.TrackPreviousValuesOptions

val srUserTable = Table(
    name = "sr_user",
    ignoreEmptyUpdates = true,
    columns = listOf(
        Column.text("email"),
        Column.text("name"),
        Column.text("picture"),
        Column.text("given_name"),
        Column.text("family_name"),
        Column.text("lang"),
        Column.text("ai_lang"),
        Column.text("timezone"),
        Column.text("account"),
        Column.text("last_read_at"),
        Column.text("invite_code")
    ),
)

val srUserTagTable = Table(
    name = "sr_user_tag",
    trackPreviousValues = TrackPreviousValuesOptions(),
    columns = listOf(
        Column.text("user_id"),
        Column.text("tag_name"),
        Column.text("display"),
        // "auto" | "mine": vocabulary ownership, see sync_rules sr_user_tag query
        Column.text("source"),
        // last time the user attached this tag by hand
        Column.text("last_used_at"),
        Column.text("created_at"),
    )
)

val srPlatformBindTable = Table(
    name = "sr_platform_bind",
    columns = listOf(
        Column.text("user_id"),
        Column.text("platform"),
        Column.text("platform_id"),
        Column.text("user_name"),
        Column.text("created_at"),
    )
)

val srUserNotificationTable = Table(
    name = "sr_user_notification",
    columns = listOf(
        Column.text("user_id"),
        Column.text("type"),
        Column.text("source"),
        Column.text("title"),
        Column.text("body"),
        Column.text("details"),
        Column.integer("is_read"),
        Column.text("created_at"),
    )
)

val srUserBookmarkTable = Table(
    name = "sr_user_bookmark",
    trackPreviousValues = TrackPreviousValuesOptions(onlyWhenChanged = true, columnFilter = null),
    columns = listOf(
        Column.text("user_id"),
        Column.integer("is_read"),
        Column.integer("archive_status"),
        Column.integer("is_starred"),
        Column.text("created_at"),
        Column.text("updated_at"),
        Column.text("alias_title"),
        Column.integer("type"),
        Column.text("deleted_at"),
        Column.text("starred_at"),
        Column.text("archived_at"),
        Column.text("metadata"),
    )
)

val srUserSubscriptionTable = Table(
    name = "sr_user_subscription",
    columns = listOf(
        Column.text("stripe_subscription_id"),
        Column.text("stripe_customer_id"),
        Column.text("stripe_stripe_currency"),
        Column.text("first_subscription_time"),
        Column.text("subscription_end_time"),
        Column.text("next_invoice_time"),
        Column.integer("auto_renew"),
        Column.integer("stripe_credit"),
        Column.integer("subscribed"),
        Column.text("apple_original_transaction_id"),
        Column.text("source_type")
    )
)

val srUserCollectionSubscriberTable = Table(
    name = "sr_user_collection_subscriber",
    trackPreviousValues = TrackPreviousValuesOptions(onlyWhenChanged = true, columnFilter = null),
    columns = listOf(
        Column.text("collection_id"),
        Column.text("owner_id"),
        Column.text("subscription_end_time"),
        Column.text("next_invoice_time"),
        Column.integer("auto_renew"),
        Column.text("last_read_at"),
        Column.text("created_at"),
        Column.text("updated_at"),
        Column.integer("is_cancelled"),
    )
)

val srUserCollectionTable = Table(
    name = "sr_user_collection",
    columns = listOf(
        Column.text("owner_id"),
        Column.text("display_name"),
        Column.text("avatar"),
        Column.text("description"),
        Column.text("collection_code"),
        Column.integer("type"),
        Column.integer("status"),
        Column.text("updated_at"),
    )
)

val srSharerSettingTable = Table(
    name = "sr_sharer_setting",
    columns = listOf(
        Column.integer("allow_highlight"),
        Column.integer("show_highlight"),
        Column.integer("allow_access"),
    )
)

val srCollectionBookmarkTable = Table(
    name = "sr_collection_bookmark",
    columns = listOf(
        Column.text("owner_id"),
        Column.text("alias_title"),
        Column.text("metadata"),
        Column.text("starred_at"),
        Column.text("created_at"),
        Column.text("updated_at"),
    )
)

val srUserBookmarkStatsTable = Table(
    name = "sr_user_bookmark_stats",
    columns = listOf(
        Column.text("bookmark_uuid"),
        Column.integer("comment_count"),
        Column.text("first_comment"),
        Column.text("owner_id"),
        Column.text("created_at"),
    )
)

val srBookmarkComment = Table(
    name = "sr_bookmark_comment",
    columns = listOf(
        Column.integer("type"),
        Column.text("source"),
        Column.text("user_bookmark_uuid"),
        Column.text("comment"),
        Column.text("approx_source"),
        Column.text("content"),
        Column.integer("is_deleted"),
        Column.text("created_at"),
        Column.text("metadata"),
    )
)

val localBookmarkInfo = Table(
    name = "local_bookmark_info",
    localOnly = true,
    columns = listOf(
        Column.text("overview"),
        Column.text("key_takeaways"),
        Column.integer("is_downloaded")
    )
)

val AppSchema = Schema(
    listOf(
        srUserTable,
        srUserTagTable,
        srPlatformBindTable,
        srUserNotificationTable,
        srUserBookmarkTable,
        srUserSubscriptionTable,
        srUserCollectionSubscriberTable,
        srUserCollectionTable,
        srSharerSettingTable,
        srCollectionBookmarkTable,
        srUserBookmarkStatsTable,
        srBookmarkComment,

        // local only, not sync to server
        localBookmarkInfo
    )
)
