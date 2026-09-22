CREATE TABLE "user_device_alias" (
  "device_id" TEXT NOT NULL,
  "user_id" INTEGER NOT NULL,
  "bound_at" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "bind_source" TEXT NOT NULL CHECK ("bind_source" IN ('signup', 'login', 'backfill'))
);

CREATE UNIQUE INDEX "user_device_alias_device_id_user_id_key"
  ON "user_device_alias"("device_id", "user_id");

CREATE INDEX "user_device_alias_user_id_bound_at_idx"
  ON "user_device_alias"("user_id", "bound_at");
