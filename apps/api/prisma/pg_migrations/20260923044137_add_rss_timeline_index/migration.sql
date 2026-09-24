-- CreateIndex
CREATE INDEX "sr_rss_entry_timeline" ON "sr_rss_entry"("sort_at" DESC, "id" DESC);
