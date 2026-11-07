-- CreateTable
CREATE TABLE "slax_vector_preference_state" (
    "target" TEXT NOT NULL PRIMARY KEY,
    "version" BIGINT NOT NULL,
    "mean_version" TEXT NOT NULL DEFAULT '',
    "raw" BLOB NOT NULL,
    "centered" BLOB NOT NULL,
    "entries" BLOB NOT NULL,
    "updated_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
