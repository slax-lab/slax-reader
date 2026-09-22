-- CreateTable
CREATE TABLE "slax_bookmark_vector_shard" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "bucket_idx" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "slax_bookmark_vector_shard_bookmark_id_key" ON "slax_bookmark_vector_shard"("bookmark_id");

