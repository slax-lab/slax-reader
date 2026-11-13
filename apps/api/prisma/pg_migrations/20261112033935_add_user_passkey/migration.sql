-- CreateTable
CREATE TABLE "sr_user_passkey" (
    "id" SERIAL NOT NULL,
    "uuid" TEXT NOT NULL DEFAULT gen_random_uuid(),
    "user_id" INTEGER NOT NULL,
    "rp_id" TEXT NOT NULL,
    "credential_id" TEXT NOT NULL,
    "public_key" BYTEA NOT NULL,
    "counter" BIGINT NOT NULL DEFAULT 0,
    "transports" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "name" TEXT NOT NULL DEFAULT 'Passkey',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_used_at" TIMESTAMP(3),

    CONSTRAINT "sr_user_passkey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_passkey_uuid_key" ON "sr_user_passkey"("uuid");

-- CreateIndex
CREATE UNIQUE INDEX "sr_user_passkey_credential_id_key" ON "sr_user_passkey"("credential_id");

-- CreateIndex
CREATE INDEX "sr_user_passkey_user_id_rp_id_idx" ON "sr_user_passkey"("user_id", "rp_id");
