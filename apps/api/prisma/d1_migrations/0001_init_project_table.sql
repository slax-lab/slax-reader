-- CreateTable
CREATE TABLE "slax_user" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "picture" TEXT NOT NULL DEFAULT '',
    "given_name" TEXT NOT NULL DEFAULT '',
    "family_name" TEXT NOT NULL DEFAULT '',
    "lang" TEXT NOT NULL DEFAULT '',
    "country" TEXT NOT NULL DEFAULT '',
    "city" TEXT NOT NULL DEFAULT '',
    "region" TEXT NOT NULL DEFAULT '',
    "latitude" REAL NOT NULL DEFAULT 0,
    "longitude" REAL NOT NULL DEFAULT 0,
    "timezone" TEXT NOT NULL DEFAULT '',
    "last_login_at" DATETIME NOT NULL,
    "last_login_ip" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "slax_bookmark" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "title" TEXT NOT NULL DEFAULT '',
    "host_url" TEXT NOT NULL DEFAULT '',
    "target_url" TEXT NOT NULL DEFAULT '',
    "site_name" TEXT NOT NULL DEFAULT '',
    "content_icon" TEXT NOT NULL DEFAULT '',
    "content_cover" TEXT NOT NULL DEFAULT '',
    "content_key" TEXT NOT NULL DEFAULT '',
    "content_word_count" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT NOT NULL DEFAULT '',
    "byline" TEXT NOT NULL DEFAULT '',
    "private_user" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "published_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "slax_user_bookmark" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "bookmark_tag" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    CONSTRAINT "slax_user_bookmark_bookmark_id_fkey" FOREIGN KEY ("bookmark_id") REFERENCES "slax_bookmark" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "slax_bookmark_comment" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "slax_bookmark_aigc" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "content" TEXT NOT NULL DEFAULT '',
    "ai_name" TEXT NOT NULL DEFAULT '',
    "ai_model" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "slax_user_usage" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "user_id" INTEGER NOT NULL DEFAULT 0,
    "action" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "slax_url_policie" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "url" TEXT NOT NULL DEFAULT '',
    "server_parse" BOOLEAN NOT NULL DEFAULT false,
    "is_blocked" BOOLEAN NOT NULL DEFAULT false,
    "is_private" BOOLEAN NOT NULL DEFAULT false,
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "slax_bookmark_image" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "image_url" TEXT NOT NULL DEFAULT '',
    "image_key" TEXT NOT NULL DEFAULT '',
    "created_at" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "slax_queue_parse_info" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "target_url" TEXT NOT NULL DEFAULT '',
    "content_key" TEXT NOT NULL DEFAULT '',
    "server_parse" BOOLEAN NOT NULL DEFAULT false,
    "is_privated" BOOLEAN NOT NULL DEFAULT false,
    "bookmark_id" INTEGER NOT NULL DEFAULT 0,
    "created_at" DATETIME NOT NULL,
    "updated_at" DATETIME NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending'
);

-- CreateIndex
CREATE UNIQUE INDEX "slax_user_email_key" ON "slax_user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "slax_bookmark_target_url_private_user_key" ON "slax_bookmark"("target_url", "private_user");

-- CreateIndex
CREATE UNIQUE INDEX "slax_user_bookmark_user_id_bookmark_id_key" ON "slax_user_bookmark"("user_id", "bookmark_id");

-- CreateIndex
CREATE UNIQUE INDEX "slax_bookmark_comment_bookmark_id_user_id_key" ON "slax_bookmark_comment"("bookmark_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "slax_bookmark_aigc_bookmark_id_user_id_key" ON "slax_bookmark_aigc"("bookmark_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "slax_url_policie_url_key" ON "slax_url_policie"("url");

-- CreateIndex
CREATE INDEX "slax_bookmark_image_bookmark_id_idx" ON "slax_bookmark_image"("bookmark_id");

