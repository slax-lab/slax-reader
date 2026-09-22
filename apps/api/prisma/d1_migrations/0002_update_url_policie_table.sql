-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_url_policie" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "host" TEXT NOT NULL DEFAULT '',
    "is_blocked" INTEGER NOT NULL DEFAULT 0,
    "is_privated" INTEGER NOT NULL DEFAULT 0,
    "parse_type" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL
);
INSERT INTO "new_slax_url_policie" ("created_at", "host", "id", "is_blocked", "is_privated") SELECT "created_at", "host", "id", "is_blocked", "is_privated" FROM "slax_url_policie";
DROP TABLE "slax_url_policie";
ALTER TABLE "new_slax_url_policie" RENAME TO "slax_url_policie";
CREATE UNIQUE INDEX "slax_url_policie_host_key" ON "slax_url_policie"("host");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

