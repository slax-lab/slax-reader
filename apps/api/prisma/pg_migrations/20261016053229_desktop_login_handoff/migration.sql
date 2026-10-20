-- CreateTable
CREATE TABLE "sr_desktop_auth_code" (
    "code_hash" VARCHAR(43) NOT NULL,
    "user_id" INTEGER NOT NULL,
    "challenge" VARCHAR(43) NOT NULL,
    "state_hash" VARCHAR(43) NOT NULL,
    "deployment" VARCHAR(512) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP + interval '120 seconds'),
    "consumed_at" TIMESTAMP(3),

    CONSTRAINT "sr_desktop_auth_code_pkey" PRIMARY KEY ("code_hash")
);

-- CreateIndex
CREATE INDEX "sr_desktop_auth_code_expires_at_idx" ON "sr_desktop_auth_code"("expires_at");

-- CreateIndex
CREATE INDEX "sr_desktop_auth_code_user_id_idx" ON "sr_desktop_auth_code"("user_id");
