-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_stripe_event" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "event_id" TEXT NOT NULL DEFAULT '',
    "event_type" TEXT NOT NULL DEFAULT '',
    "event_data" TEXT NOT NULL DEFAULT '',
    "event_account" TEXT NOT NULL DEFAULT '',
    "previous_event_data" TEXT NOT NULL DEFAULT '',
    "live_mode" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
INSERT INTO "new_slax_stripe_event" ("created_at", "event_data", "event_id", "event_type", "id", "live_mode", "previous_event_data") SELECT "created_at", "event_data", "event_id", "event_type", "id", "live_mode", "previous_event_data" FROM "slax_stripe_event";
DROP TABLE "slax_stripe_event";
ALTER TABLE "new_slax_stripe_event" RENAME TO "slax_stripe_event";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

