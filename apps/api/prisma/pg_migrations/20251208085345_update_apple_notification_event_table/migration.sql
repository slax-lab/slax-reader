/*
  Warnings:

  - You are about to drop the column `created_at` on the `sr_apple_notification_event` table. All the data in the column will be lost.
  - You are about to drop the column `data` on the `sr_apple_notification_event` table. All the data in the column will be lost.
  - You are about to drop the column `original_transaction_id` on the `sr_apple_notification_event` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "sr_apple_notification_event" DROP COLUMN "created_at",
DROP COLUMN "data",
DROP COLUMN "original_transaction_id",
ADD COLUMN     "bundle_id" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "bundle_version" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "notification_env" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "product_id" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "renewal_info" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "sub_type" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "transaction_info" TEXT NOT NULL DEFAULT '';
