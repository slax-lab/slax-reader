-- CreateTable
CREATE TABLE "sr_bookmark_fork_receipt" (
    "user_id" INTEGER NOT NULL,
    "source_id" INTEGER NOT NULL,
    "bookmark_id" INTEGER NOT NULL,
    "admission_revision" TIMESTAMP(3) NOT NULL,
    "published_revision" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "sr_bookmark_fork_receipt_pkey" PRIMARY KEY ("user_id","source_id")
);
