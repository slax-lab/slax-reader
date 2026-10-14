-- CreateTable
CREATE TABLE "slax_bookmark_fetch_retry" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_retry_at" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "trace_id" TEXT NOT NULL DEFAULT ''
);

-- CreateIndex
CREATE INDEX "slax_bookmark_fetch_retry_status_idx" ON "slax_bookmark_fetch_retry"("status");

-- CreateIndex
CREATE UNIQUE INDEX "slax_bookmark_fetch_retry_bookmark_id_user_id_key" ON "slax_bookmark_fetch_retry"("bookmark_id", "user_id");

