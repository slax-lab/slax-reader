-- DropIndex
DROP INDEX "slax_bookmark_comment_bookmark_id_user_id_key";

-- DropIndex
DROP INDEX "slax_bookmark_image_bookmark_id_idx";

-- DropIndex
DROP INDEX "slax_url_policie_host_key";

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "slax_bookmark_comment";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "slax_bookmark_image";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "slax_url_policie";
PRAGMA foreign_keys=on;

-- DropTable
PRAGMA foreign_keys=off;
DROP TABLE "slax_user_usage";
PRAGMA foreign_keys=on;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_user_bookmark" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "slax_user_bookmark_bookmark_id_fkey" FOREIGN KEY ("bookmark_id") REFERENCES "slax_bookmark" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_slax_user_bookmark" ("bookmark_id", "created_at", "id", "updated_at", "user_id") SELECT "bookmark_id", "created_at", "id", "updated_at", "user_id" FROM "slax_user_bookmark";
DROP TABLE "slax_user_bookmark";
ALTER TABLE "new_slax_user_bookmark" RENAME TO "slax_user_bookmark";
CREATE UNIQUE INDEX "slax_user_bookmark_user_id_bookmark_id_key" ON "slax_user_bookmark"("user_id", "bookmark_id");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

