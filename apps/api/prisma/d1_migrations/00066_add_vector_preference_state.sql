-- CreateTable
CREATE TABLE "slax_vector_preference_state" (
    "user_id" INTEGER NOT NULL PRIMARY KEY,
    "seq" REAL NOT NULL,
    "mean_version" TEXT NOT NULL,
    "raw" BLOB NOT NULL,
    "centered" BLOB NOT NULL,
    "shared" BLOB NOT NULL,
    "inherited" BLOB NOT NULL,
    "counts" TEXT NOT NULL,
    "interests" TEXT NOT NULL
);

-- CreateTable
CREATE TABLE "slax_vector_preference_entry" (
    "user_id" INTEGER NOT NULL,
    "bookmark_id" INTEGER NOT NULL,
    "weight" INTEGER NOT NULL,
    "share_group" INTEGER NOT NULL,
    "token" TEXT NOT NULL,
    "published_at" REAL NOT NULL DEFAULT 0,

    PRIMARY KEY ("user_id", "bookmark_id")
);

-- CreateIndex
CREATE INDEX "slax_vector_preference_entry_user_id_share_group_published_at_idx" ON "slax_vector_preference_entry"("user_id", "share_group", "published_at");
