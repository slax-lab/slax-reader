-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_slax_user" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "picture" TEXT NOT NULL DEFAULT '',
    "given_name" TEXT NOT NULL DEFAULT '',
    "family_name" TEXT NOT NULL DEFAULT '',
    "lang" TEXT NOT NULL DEFAULT '',
    "ai_lang" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "latitude" REAL NOT NULL DEFAULT 0,
    "longitude" REAL NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL DEFAULT '',
    "account" TEXT NOT NULL DEFAULT '',
    "last_login_at" DATETIME NOT NULL,
    "last_login_ip" TEXT NOT NULL DEFAULT '',
    "last_read_at" DATETIME,
    "invite_code" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL
);
INSERT INTO "new_slax_user" ("account", "city", "country", "created_at", "email", "family_name", "given_name", "id", "invite_code", "lang", "last_login_at", "last_login_ip", "last_read_at", "latitude", "longitude", "name", "picture", "region", "timezone") SELECT "account", "city", "country", "created_at", "email", "family_name", "given_name", "id", "invite_code", "lang", "last_login_at", "last_login_ip", "last_read_at", "latitude", "longitude", "name", "picture", "region", "timezone" FROM "slax_user";
DROP TABLE "slax_user";
ALTER TABLE "new_slax_user" RENAME TO "slax_user";
CREATE UNIQUE INDEX "slax_user_email_key" ON "slax_user"("email");
CREATE INDEX "slax_user_account_idx" ON "slax_user"("account");
CREATE INDEX "slax_user_invite_code_idx" ON "slax_user"("invite_code");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

