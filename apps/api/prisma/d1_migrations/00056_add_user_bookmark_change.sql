-- CreateTable
CREATE TABLE "slax_user_bookmark_change" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "target_url" TEXT NOT NULL DEFAULT '',
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "action" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "slax_user_bookmark_change_user_id_created_at_idx" ON "slax_user_bookmark_change"("user_id", "created_at");

