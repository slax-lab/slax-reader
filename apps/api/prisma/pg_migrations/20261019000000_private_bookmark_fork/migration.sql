-- AlterTable
ALTER TABLE "sr_bookmark" ADD COLUMN     "published_version" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "write_version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "sr_bookmark_import_relation" ADD COLUMN     "created_target" BOOLEAN,
ADD COLUMN     "write_version" INTEGER;

-- AlterTable
ALTER TABLE "sr_youtube_article_ref" ADD COLUMN     "capture_version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "sr_bookmark_fork" (
    "id" SERIAL NOT NULL,
    "target_bookmark_id" INTEGER NOT NULL,
    "current_target_id" INTEGER,
    "target_user_id" INTEGER NOT NULL,
    "source_bookmark_id" INTEGER NOT NULL,
    "source_user_id" INTEGER NOT NULL,
    "source_uuid" TEXT NOT NULL,
    "source_url" TEXT NOT NULL DEFAULT '',
    "display_name" TEXT,
    "show_userinfo" BOOLEAN NOT NULL DEFAULT false,
    "idempotency_key" TEXT,
    "write_version" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'current',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_bookmark_fork_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sr_bookmark_fork_operation" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "source_uuid" TEXT NOT NULL,
    "target_bookmark_id" INTEGER NOT NULL,
    "target_uuid" TEXT NOT NULL,
    "write_version" INTEGER NOT NULL,
    "write_mode" TEXT NOT NULL,
    "attempt_token" TEXT NOT NULL DEFAULT '',
    "cleanup_token" TEXT,
    "status" TEXT NOT NULL DEFAULT 'copying',
    "staged_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "result" JSONB,
    "error_code" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_bookmark_fork_operation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sr_bookmark_save_receipt" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "operation_key" TEXT NOT NULL,
    "target_bookmark_id" INTEGER NOT NULL,
    "target_uuid" TEXT NOT NULL,
    "write_version" INTEGER NOT NULL,
    "created_target" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_bookmark_save_receipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sr_bookmark_object_stage" (
    "id" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "content_key" TEXT NOT NULL,
    "bookmark_id" INTEGER NOT NULL,
    "write_version" INTEGER NOT NULL,
    "keys" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'staged',
    "cleanup_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "indexed_at" TIMESTAMP(3),
    "index_attempted_at" TIMESTAMP(3),

    CONSTRAINT "sr_bookmark_object_stage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_fork_current_target_id_key" ON "sr_bookmark_fork"("current_target_id");

-- CreateIndex
CREATE INDEX "sr_bookmark_fork_target_bookmark_id_status_idx" ON "sr_bookmark_fork"("target_bookmark_id", "status");

-- CreateIndex
CREATE INDEX "sr_bookmark_fork_source_bookmark_id_idx" ON "sr_bookmark_fork"("source_bookmark_id");

-- CreateIndex
CREATE INDEX "sr_bookmark_fork_target_user_id_source_user_id_idx" ON "sr_bookmark_fork"("target_user_id", "source_user_id");

-- CreateIndex
CREATE INDEX "sr_bookmark_fork_target_user_id_idempotency_key_idx" ON "sr_bookmark_fork"("target_user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "sr_bookmark_fork_operation_status_updated_at_idx" ON "sr_bookmark_fork_operation"("status", "updated_at");

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_fork_operation_user_id_idempotency_key_key" ON "sr_bookmark_fork_operation"("user_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "sr_bookmark_save_receipt_target_bookmark_id_idx" ON "sr_bookmark_save_receipt"("target_bookmark_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_save_receipt_user_id_operation_key_key" ON "sr_bookmark_save_receipt"("user_id", "operation_key");

-- CreateIndex
CREATE UNIQUE INDEX "sr_bookmark_object_stage_content_key_key" ON "sr_bookmark_object_stage"("content_key");

-- CreateIndex
CREATE INDEX "sr_bookmark_object_stage_status_updated_at_idx" ON "sr_bookmark_object_stage"("status", "updated_at");

-- CreateIndex
CREATE INDEX "sr_bookmark_object_stage_status_indexed_at_idx" ON "sr_bookmark_object_stage"("status", "indexed_at");

-- CreateIndex
CREATE INDEX "sr_bookmark_object_stage_bookmark_id_write_version_idx" ON "sr_bookmark_object_stage"("bookmark_id", "write_version");
