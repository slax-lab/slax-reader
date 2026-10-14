-- CreateTable
CREATE TABLE "slax_user_redeem_code" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "creator_id" INTEGER NOT NULL DEFAULT 0,
    "code" TEXT NOT NULL DEFAULT '',
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" DATETIME
);

-- CreateIndex
CREATE UNIQUE INDEX "slax_user_redeem_code_code_key" ON "slax_user_redeem_code"("code");

