-- CreateTable
CREATE TABLE "slax_bookmark_import_relation" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "import_id" INTEGER NOT NULL DEFAULT 0,
    "status" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "slax_bookmark_import_relation_user_id_import_id_bookmark_id_idx" ON "slax_bookmark_import_relation"("user_id", "import_id", "bookmark_id");

