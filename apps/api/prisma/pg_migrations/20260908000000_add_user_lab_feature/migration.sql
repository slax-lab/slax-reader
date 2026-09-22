-- sr_user_lab_feature: per-user switches for Labs features (no row = off)
CREATE TABLE "sr_user_lab_feature" (
    "id" SERIAL NOT NULL,
    "user_id" INTEGER NOT NULL,
    "feature" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sr_user_lab_feature_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "sr_user_lab_feature_user_id_feature_key" ON "sr_user_lab_feature"("user_id", "feature");

CREATE INDEX "sr_user_lab_feature_feature_enabled_idx" ON "sr_user_lab_feature"("feature", "enabled");
