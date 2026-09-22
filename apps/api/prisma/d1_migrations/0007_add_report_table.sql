-- CreateTable
CREATE TABLE "slax_platform_bind" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "platform" TEXT NOT NULL DEFAULT '',
    "platform_id" TEXT NOT NULL DEFAULT '',
    "user_name" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "slax_platform_bind_platform_platform_id_idx" ON "slax_platform_bind"("platform", "platform_id");

-- CreateIndex
CREATE UNIQUE INDEX "slax_platform_bind_user_id_platform_key" ON "slax_platform_bind"("user_id", "platform");

