-- CreateTable
CREATE TABLE "sr_snapshot_cleanup" (
    "bundle_key" TEXT NOT NULL,
    "publish_until" TIMESTAMPTZ(3),
    "run_after" TIMESTAMPTZ(3) NOT NULL,
    "lease_token" TEXT,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_snapshot_cleanup_pkey" PRIMARY KEY ("bundle_key")
);

-- CreateIndex
CREATE INDEX "sr_snapshot_cleanup_run_after_idx" ON "sr_snapshot_cleanup"("run_after");

-- CreateIndex
CREATE INDEX "sr_bookmark_content_key_idx" ON "sr_bookmark"("content_key");

-- CreateIndex
CREATE INDEX "sr_bookmark_content_md_key_idx" ON "sr_bookmark"("content_md_key");
