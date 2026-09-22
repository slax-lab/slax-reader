-- CreateTable
CREATE TABLE "slax_user_receive_activity_record" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "activity_type" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE UNIQUE INDEX "slax_user_receive_activity_record_user_id_activity_type_key" ON "slax_user_receive_activity_record"("user_id", "activity_type");
