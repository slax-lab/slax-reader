-- CreateTable
CREATE TABLE "sr_apple_transaction_processed" (
    "id" SERIAL NOT NULL,
    "transaction_id" TEXT NOT NULL,
    "original_transaction_id" TEXT NOT NULL,
    "user_id" INTEGER NOT NULL,
    "notification_type" TEXT NOT NULL DEFAULT '',
    "processed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sr_apple_transaction_processed_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sr_apple_transaction_processed_transaction_id_key" ON "sr_apple_transaction_processed"("transaction_id");

-- CreateIndex
CREATE INDEX "sr_apple_transaction_processed_original_transaction_id_idx" ON "sr_apple_transaction_processed"("original_transaction_id");

-- CreateIndex
CREATE INDEX "sr_apple_transaction_processed_user_id_processed_at_idx" ON "sr_apple_transaction_processed"("user_id", "processed_at");
