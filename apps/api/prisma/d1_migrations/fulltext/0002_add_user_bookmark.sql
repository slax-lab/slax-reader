-- 方便搜索的时候快速获取
CREATE TABLE "slax_user_bookmark" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL,
    "bookmark_id" INTEGER NOT NULL,
    "created_at" DATETIME NOT NULL
);
CREATE UNIQUE INDEX "slax_user_bookmark_user_id_bookmark_id_idx" ON "slax_user_bookmark"("user_id", "bookmark_id");
