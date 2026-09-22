-- CreateTable
CREATE TABLE "sr_user_api_key" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL,
    "key_prefix" TEXT NOT NULL DEFAULT '',
    "key_hash" TEXT NOT NULL DEFAULT '',
    "name" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_user_api_key_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_api_key_uuid_key" ON "sr_user_api_key"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_api_key_user_id_key" ON "sr_user_api_key"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_api_key_key_hash_key" ON "sr_user_api_key"("key_hash");
