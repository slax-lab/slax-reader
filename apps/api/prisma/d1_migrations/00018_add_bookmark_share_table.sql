-- CreateTable
CREATE TABLE "slax_bookmark_share" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "share_code" TEXT NOT NULL DEFAULT '',
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "show_line" BOOLEAN NOT NULL DEFAULT false,
    "show_comment" BOOLEAN NOT NULL DEFAULT false,
    "show_userinfo" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "slax_bookmark_share_share_code_key" ON "slax_bookmark_share"("share_code");

-- CreateIndex
CREATE UNIQUE INDEX "slax_bookmark_share_bookmark_id_user_id_key" ON "slax_bookmark_share"("bookmark_id", "user_id");

