-- CreateTable
CREATE TABLE "public"."sr_user" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "picture" TEXT NOT NULL DEFAULT '',
    "given_name" TEXT NOT NULL DEFAULT '',
    "family_name" TEXT NOT NULL DEFAULT '',
    "lang" TEXT NOT NULL DEFAULT '',
    "ai_lang" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "latitude" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "longitude" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL DEFAULT '',
    "account" TEXT NOT NULL DEFAULT '',
    "last_login_at" TIMESTAMP(3) NOT NULL,
    "last_login_ip" TEXT NOT NULL DEFAULT '',
    "last_read_at" TIMESTAMP(3),
    "invite_code" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sr_user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_bookmark" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "title" TEXT NOT NULL DEFAULT '',
    "host_url" TEXT NOT NULL DEFAULT '',
    "target_url" TEXT NOT NULL DEFAULT '',
    "site_name" TEXT NOT NULL DEFAULT '',
    "content_icon" TEXT NOT NULL DEFAULT '',
    "content_cover" TEXT NOT NULL DEFAULT '',
    "content_key" TEXT NOT NULL DEFAULT '',
    "content_md_key" TEXT NOT NULL DEFAULT '',
    "content_word_count" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "byline" TEXT NOT NULL DEFAULT '',
    "private_user" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "published_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sr_bookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_bookmark" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "archive_status" INTEGER NOT NULL DEFAULT 0,
    "is_starred" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "alias_title" TEXT NOT NULL DEFAULT '',
    "type" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "sr_user_bookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_bookmark_summary" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "content" TEXT NOT NULL DEFAULT '',
    "ai_name" TEXT NOT NULL DEFAULT '',
    "ai_model" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL,
    "updated_at" TIMESTAMP(3),
    "lang" TEXT NOT NULL DEFAULT '',
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "sr_bookmark_summary_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_report" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_user_report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_platform_bind" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "platform" TEXT NOT NULL DEFAULT '',
    "platform_id" TEXT NOT NULL DEFAULT '',
    "user_name" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_platform_bind_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_subscription_period" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "type" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT '',
    "interval" TEXT NOT NULL DEFAULT '',
    "interval_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_user_subscription_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_invite" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "code" TEXT NOT NULL DEFAULT '',
    "invite_user_id" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT '',
    "is_valid" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_user_invite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_subscription" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "stripe_subscription_id" TEXT NOT NULL DEFAULT '',
    "stripe_customer_id" TEXT NOT NULL DEFAULT '',
    "stripe_stripe_currency" TEXT NOT NULL DEFAULT '',
    "first_subscription_time" TIMESTAMP(3) NOT NULL,
    "subscription_end_time" TIMESTAMP(3) NOT NULL,
    "next_invoice_time" TIMESTAMP(3) NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "stripe_credit" INTEGER NOT NULL DEFAULT 0,
    "subscribed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_user_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_stripe_event" (
    "id" SERIAL NOT NULL,
    "event_id" TEXT NOT NULL DEFAULT '',
    "event_type" TEXT NOT NULL DEFAULT '',
    "event_data" TEXT NOT NULL DEFAULT '',
    "event_account" TEXT NOT NULL DEFAULT '',
    "previous_event_data" TEXT NOT NULL DEFAULT '',
    "live_mode" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_stripe_event_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_bookmark_comment" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "type" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT '',
    "comment" TEXT NOT NULL DEFAULT '',
    "root_id" INTEGER NOT NULL DEFAULT 0,
    "parent_id" INTEGER NOT NULL DEFAULT 0,
    "approx_source" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "source_type" TEXT NOT NULL DEFAULT '',
    "source_id" TEXT NOT NULL DEFAULT '',
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "sr_bookmark_comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_bookmark_share" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "share_code" TEXT NOT NULL DEFAULT '',
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "show_line" BOOLEAN NOT NULL DEFAULT false,
    "show_comment" BOOLEAN NOT NULL DEFAULT false,
    "show_userinfo" BOOLEAN NOT NULL DEFAULT false,
    "allow_comment" BOOLEAN NOT NULL DEFAULT false,
    "allow_line" BOOLEAN NOT NULL DEFAULT false,
    "is_enable" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_bookmark_share_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_tag" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "tag_name" TEXT NOT NULL DEFAULT '',
    "display" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_user_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_bookmark_tag" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "tag_name" TEXT NOT NULL DEFAULT '',
    "tag_id" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sr_user_bookmark_tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_bookmark_import" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT '',
    "object_key" TEXT NOT NULL DEFAULT '',
    "status" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL DEFAULT '',
    "total_count" INTEGER NOT NULL DEFAULT 0,
    "batch_count" INTEGER NOT NULL DEFAULT 0,
    "success_total" INTEGER NOT NULL DEFAULT 0,
    "failed_total" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_bookmark_import_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_bookmark_import_relation" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "import_id" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_bookmark_import_relation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_aigc_batch_task" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "task_type" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "batch_request_id" TEXT NOT NULL DEFAULT '',
    "error_message" TEXT NOT NULL DEFAULT '',
    "result_data" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "sr_aigc_batch_task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_delete_bookmark" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "sr_user_delete_bookmark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_bookmark_fetch_retry" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_retry_at" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trace_id" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "sr_bookmark_fetch_retry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_bookmark_vector_shard" (
    "id" SERIAL NOT NULL,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "bucket_idx" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_bookmark_vector_shard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_notification" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "type" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL DEFAULT '',
    "title" TEXT NOT NULL DEFAULT '',
    "body" TEXT NOT NULL DEFAULT '',
    "details" TEXT NOT NULL DEFAULT '',
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "sr_user_notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_collection" (
    "id" SERIAL NOT NULL,
    "type" INTEGER NOT NULL DEFAULT 0,
    "owner_id" INTEGER NOT NULL DEFAULT 0,
    "display_name" TEXT NOT NULL DEFAULT '',
    "amount" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT '',
    "collection_code" TEXT NOT NULL DEFAULT '',
    "show_marks" BOOLEAN NOT NULL DEFAULT false,
    "allow_marks" BOOLEAN NOT NULL DEFAULT false,
    "show_profile" BOOLEAN NOT NULL DEFAULT false,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sr_user_collection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_collection_subscriber_period" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "collection_id" INTEGER NOT NULL DEFAULT 0,
    "source" TEXT NOT NULL DEFAULT '',
    "type" INTEGER NOT NULL DEFAULT 0,
    "interval" TEXT NOT NULL DEFAULT '',
    "interval_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_user_collection_subscriber_period_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_collection_subscriber" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "collection_id" INTEGER NOT NULL DEFAULT 0,
    "owner_id" INTEGER NOT NULL DEFAULT 0,
    "stripe_customer_id" TEXT NOT NULL DEFAULT '',
    "subscription_end_time" TIMESTAMP(3) NOT NULL,
    "next_invoice_time" TIMESTAMP(3) NOT NULL,
    "auto_renew" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "is_cancelled" BOOLEAN NOT NULL DEFAULT false,
    "is_deleted" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "sr_user_collection_subscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_redeem_code" (
    "id" SERIAL NOT NULL,
    "creator_id" INTEGER NOT NULL DEFAULT 0,
    "code" TEXT NOT NULL DEFAULT '',
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3),

    CONSTRAINT "sr_user_redeem_code_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_receive_activity_record" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "activity_type" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_user_receive_activity_record_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."sr_user_bookmark_overview" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "overview" TEXT NOT NULL DEFAULT '',
    "content" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_user_bookmark_overview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_uuid_key" ON "public"."sr_user"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_email_key" ON "public"."sr_user"("email");

-- CreateIndex
CREATE INDEX "sr_user_account_idx" ON "public"."sr_user"("account");

-- CreateIndex
CREATE INDEX "sr_user_invite_code_idx" ON "public"."sr_user"("invite_code");

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_uuid_key" ON "public"."sr_bookmark"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_target_url_private_user_key" ON "public"."sr_bookmark"("target_url", "private_user");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_bookmark_uuid_key" ON "public"."sr_user_bookmark"("uuid");

-- CreateIndex
CREATE INDEX "sr_user_bookmark_user_id_deleted_at_archive_status_updated__idx" ON "public"."sr_user_bookmark"("user_id", "deleted_at", "archive_status", "updated_at");

-- CreateIndex
CREATE INDEX "sr_user_bookmark_user_id_deleted_at_is_starred_updated_at_idx" ON "public"."sr_user_bookmark"("user_id", "deleted_at", "is_starred", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_bookmark_user_id_bookmark_id_key" ON "public"."sr_user_bookmark"("user_id", "bookmark_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_summary_uuid_key" ON "public"."sr_bookmark_summary"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_summary_bookmark_id_lang_user_id_key" ON "public"."sr_bookmark_summary"("bookmark_id", "lang", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_platform_bind_uuid_key" ON "public"."sr_platform_bind"("uuid");

-- CreateIndex
CREATE INDEX "sr_platform_bind_platform_platform_id_idx" ON "public"."sr_platform_bind"("platform", "platform_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_platform_bind_user_id_platform_key" ON "public"."sr_platform_bind"("user_id", "platform");

-- CreateIndex
CREATE INDEX "sr_user_subscription_period_user_id_idx" ON "public"."sr_user_subscription_period"("user_id");

-- CreateIndex
CREATE INDEX "sr_user_subscription_period_source_idx" ON "public"."sr_user_subscription_period"("source");

-- CreateIndex
CREATE INDEX "sr_user_invite_user_id_idx" ON "public"."sr_user_invite"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_subscription_uuid_key" ON "public"."sr_user_subscription"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_subscription_user_id_key" ON "public"."sr_user_subscription"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_comment_uuid_key" ON "public"."sr_bookmark_comment"("uuid");

-- CreateIndex
CREATE INDEX "sr_bookmark_comment_user_id_created_at_is_deleted_idx" ON "public"."sr_bookmark_comment"("user_id", "created_at", "is_deleted");

-- CreateIndex
CREATE INDEX "sr_bookmark_comment_bookmark_id_root_id_is_deleted_idx" ON "public"."sr_bookmark_comment"("bookmark_id", "root_id", "is_deleted");

-- CreateIndex
CREATE INDEX "sr_bookmark_comment_bookmark_id_type_is_deleted_idx" ON "public"."sr_bookmark_comment"("bookmark_id", "type", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_share_uuid_key" ON "public"."sr_bookmark_share"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_share_share_code_key" ON "public"."sr_bookmark_share"("share_code");

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_share_bookmark_id_user_id_key" ON "public"."sr_bookmark_share"("bookmark_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_tag_uuid_key" ON "public"."sr_user_tag"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_tag_user_id_tag_name_key" ON "public"."sr_user_tag"("user_id", "tag_name");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_bookmark_tag_uuid_key" ON "public"."sr_user_bookmark_tag"("uuid");

-- CreateIndex
CREATE INDEX "sr_user_bookmark_tag_tag_id_user_id_is_deleted_idx" ON "public"."sr_user_bookmark_tag"("tag_id", "user_id", "is_deleted");

-- CreateIndex
CREATE INDEX "sr_user_bookmark_tag_bookmark_id_user_id_is_deleted_idx" ON "public"."sr_user_bookmark_tag"("bookmark_id", "user_id", "is_deleted");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_bookmark_tag_bookmark_id_user_id_tag_id_key" ON "public"."sr_user_bookmark_tag"("bookmark_id", "user_id", "tag_id");

-- CreateIndex
CREATE INDEX "sr_bookmark_import_user_id_idx" ON "public"."sr_bookmark_import"("user_id");

-- CreateIndex
CREATE INDEX "sr_bookmark_import_relation_user_id_import_id_bookmark_id_idx" ON "public"."sr_bookmark_import_relation"("user_id", "import_id", "bookmark_id");

-- CreateIndex
CREATE INDEX "sr_aigc_batch_task_task_type_status_batch_request_id_idx" ON "public"."sr_aigc_batch_task"("task_type", "status", "batch_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_aigc_batch_task_batch_request_id_key" ON "public"."sr_aigc_batch_task"("batch_request_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_delete_bookmark_user_id_bookmark_id_key" ON "public"."sr_user_delete_bookmark"("user_id", "bookmark_id");

-- CreateIndex
CREATE INDEX "sr_bookmark_fetch_retry_status_idx" ON "public"."sr_bookmark_fetch_retry"("status");

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_fetch_retry_bookmark_id_user_id_key" ON "public"."sr_bookmark_fetch_retry"("bookmark_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_vector_shard_bookmark_id_key" ON "public"."sr_bookmark_vector_shard"("bookmark_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_notification_uuid_key" ON "public"."sr_user_notification"("uuid");

-- CreateIndex
CREATE INDEX "sr_user_notification_user_id_created_at_idx" ON "public"."sr_user_notification"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_collection_owner_id_key" ON "public"."sr_user_collection"("owner_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_collection_collection_code_key" ON "public"."sr_user_collection"("collection_code");

-- CreateIndex
CREATE INDEX "sr_user_collection_subscriber_period_user_id_collection_id_idx" ON "public"."sr_user_collection_subscriber_period"("user_id", "collection_id");

-- CreateIndex
CREATE INDEX "sr_user_collection_subscriber_period_source_idx" ON "public"."sr_user_collection_subscriber_period"("source");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_collection_subscriber_uuid_key" ON "public"."sr_user_collection_subscriber"("uuid");

-- CreateIndex
CREATE INDEX "sr_user_collection_subscriber_collection_id_subscription_en_idx" ON "public"."sr_user_collection_subscriber"("collection_id", "subscription_end_time");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_collection_subscriber_user_id_collection_id_key" ON "public"."sr_user_collection_subscriber"("user_id", "collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_redeem_code_code_key" ON "public"."sr_user_redeem_code"("code");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_receive_activity_record_user_id_activity_type_key" ON "public"."sr_user_receive_activity_record"("user_id", "activity_type");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_bookmark_overview_uuid_key" ON "public"."sr_user_bookmark_overview"("uuid");

-- CreateIndex
CREATE INDEX "sr_user_bookmark_overview_bookmark_id_user_id_idx" ON "public"."sr_user_bookmark_overview"("bookmark_id", "user_id");
