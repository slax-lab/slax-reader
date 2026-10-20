-- Keep cleanup scheduling independent from updated_at heartbeats used by search repair.
ALTER TABLE "sr_bookmark_object_stage"
  ADD COLUMN "cleanup_after" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '1 hour'),
  ADD COLUMN "cleanup_completed_at" TIMESTAMP(3);

-- Existing tombstones already had one successful cleanup; retain them for one repeat window.
UPDATE "sr_bookmark_object_stage"
SET "cleanup_completed_at" = CURRENT_TIMESTAMP
WHERE "status" = 'deleted' AND "cleanup_completed_at" IS NULL;

CREATE INDEX "sr_bookmark_private_user_id_idx" ON "sr_bookmark" ("private_user", "id");
CREATE INDEX "sr_bookmark_content_key_idx" ON "sr_bookmark" ("content_key");
CREATE INDEX "sr_bookmark_content_md_key_idx" ON "sr_bookmark" ("content_md_key");
CREATE INDEX "sr_bookmark_fork_target_bookmark_id_write_version_id_idx"
  ON "sr_bookmark_fork" ("target_bookmark_id", "write_version", "id" DESC);
CREATE INDEX "sr_bookmark_fork_operation_target_bookmark_id_status_idx"
  ON "sr_bookmark_fork_operation" ("target_bookmark_id", "status");
CREATE INDEX "sr_bm_import_relation_progress_idx"
  ON "sr_bookmark_import_relation" ("import_id", "status");
CREATE INDEX "sr_bm_import_relation_revision_idx"
  ON "sr_bookmark_import_relation" ("user_id", "bookmark_id", "import_id", "write_version");
CREATE INDEX "sr_bookmark_object_stage_status_cleanup_after_idx"
  ON "sr_bookmark_object_stage" ("status", "cleanup_after");
CREATE INDEX "sr_bookmark_object_stage_bookmark_id_status_updated_at_idx"
  ON "sr_bookmark_object_stage" ("bookmark_id", "status", "updated_at");

-- The repair queue is sparse. Prisma does not express this partial index, so SQL owns it.
CREATE INDEX "sr_bookmark_object_stage_pending_index_idx"
  ON "sr_bookmark_object_stage" ("updated_at", "id", "bookmark_id")
  WHERE "status" IN ('published', 'retired') AND "indexed_at" IS NULL;

-- These indexes were introduced by the previous expansion and are superseded above.
DROP INDEX "sr_bookmark_object_stage_status_updated_at_idx";
DROP INDEX "sr_bookmark_object_stage_status_indexed_at_idx";
DROP INDEX "sr_bookmark_object_stage_bookmark_id_write_version_idx";
