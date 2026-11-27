## Context

See proposal.md for motivation. The publication time of a bookmark lives in `sr_bookmark.published_at`. The owner relation copies it into `sr_user_bookmark.metadata` through the existing `trigger_bookmark_update`, and the owner detail, public content and recommendations all read those columns.

Publisher saves follow three routes:

- `add_url` admits the bookmark and starts the crawl workflow with only the URL. The workflow fetches the page, YouTube oEmbed data or a podcast feed, and each snapshot writer derives the time itself. YouTube uses the current time, and the generic parser falls back to the current time.
- `upload_pdf` reads the bytes in the request and completes the bookmark through `persistPdf`, which writes the current time.
- `add` with publisher HTML reads `article:published_time` from the supplied document only on the publisher-HTML route. 109 wrong article saves predate that route (2026-11-17 17:44 +08:00). The other 27 were saved on 2026-11-20 between 09:52 and 12:56 +08:00 and on 2026-11-23, with correct tags in the supplied HTML; their route is not confirmed. A later save that takes another route, or re-saves an existing capture, can lose the time the same way.

A publisher's bookmark is private to it: `createBookmarkBase` creates every new capture with `private_user` set to the saving user, and each Collection publishes from its own Reader account.

## Goals / Non-Goals

**Goals:**
- One override point per route, so every snapshot writer keeps its current time logic for everyone else.
- Write only the publishing account's own bookmark row, conditioned on ownership.
- A backfill that can be reviewed as a dry run and re-run without effect.

**Non-Goals:**
- Changing how ordinary users' YouTube, PDF or page times are derived.
- Reordering Collection pages, which use star time.
- Changing the request or response shape of `add`.

## Decisions

**Override after publication instead of threading the time into every writer.** The workflow has more than ten snapshot writers (regular, YouTube, podcast, WeChat, Toutiao, X, Xiaohongshu, Weibo, Reddit, Zhihu, PDF). Passing the time into each would touch every writer and its tests. Instead, the workflow carries the supplied time in its payload. After the capture is published and before moderation and post-processing, one step sets `published_at` on the bookmark if the caller is an allowlisted publisher that owns it. The alternative of a parser-level fallback (use the supplied time only when parsing finds none) was rejected because the YouTube writer and the generic parser produce a time even when they have none, so "found none" is not detectable without changing each writer.

**Article saves use the same override, sourced from the supplied HTML.** For an allowlisted publisher's `add`, the domain reads `article:published_time` from the supplied document's head and passes it as the same override. This closes the path regardless of which route stored the article, so the unconfirmed cause of the 27 saves does not need to be reproduced first.

**Validate once, at admission.** The domain admission for each route reads the supplied value (the add-URL body, the upload-PDF query or the content-save HTML head) and keeps it only when the saver is an allowlisted publisher, the value names a zone (`Z` or an offset) and it is no later than the request time. An unzoned value is dropped because Workers would read it as local time. The workflow payload therefore carries a time only for allowlisted publishers, and the workflow step validates it again before writing.

**Cached captures apply the time at admission.** When an already-successful bookmark is re-saved, `add`, `add_url` and `upload_pdf` take the cached branch and start no capture. In that branch, the domain applies the supplied time through the same repository update. This covers a publisher re-sending a correction.

**PDF upload applies the time in the same request.** `upload_pdf` completes synchronously, so the domain applies the override after `persistPdf` or the cached completion, in the same request.

**One repository operation, owner-scoped.** A new repository method updates `published_at` only where `id`, `private_user` (the publisher) and `status = 'success'` match. It changes nothing for a shared bookmark or another owner. Both the workflow step and the admission branch call it.

**Backfill as a one-off script.** `apps/api/script/backfill-publisher-published-at.ts` reads a JSON list of `{ uuid, ours, reader }` (the owner relation UUID, the correct time and the audited wrong time). It resolves each UUID through the owner relation and updates `sr_bookmark.published_at` only when the relation's owner is the bookmark's `private_user`, that owner is in `PUBLISHER_USER_IDS`, and the current value still equals the audited wrong value. It runs in a read-only transaction and prints each planned change by default, and writes only with `--apply`. It reports updated, would-update, already-correct, changed-since-audit, not-publisher-owned and not-found counts. It follows the existing `backfill-user-device-alias.ts` pattern: connection strings come from the environment and no dotenv file is loaded. Stored timestamps are compared and written as UTC text, so the result does not depend on the process or session time zone.

## Risks / Trade-offs

- [The legacy fetch-retry queue (`FETCH_RETRY_PARSER`) does not carry the time] → Publisher saves go through the crawl workflow, which retries its own steps with the payload intact. The legacy queue is outside this change.

- [Moderation and post-processing read the bookmark after publication] → The override runs as its own workflow step before moderation, and only changes `published_at`, which moderation does not read.
- [A collector bug sends a wrong but plausible time] → The override is limited to allowlisted publisher accounts and to dates not in the future, and the collector's time comes from the original feed. A wrong value is corrected by re-saving with the right one, because cached saves also apply the time.
- [The backfill list is stale by the time it runs] → The conditional match on the audited wrong value skips any row that changed since the audit, and the script reports those rows.
- [Search or vector indexes keep the old time] → `trigger_bookmark_update` refreshes the owner metadata. Vector preference entries pick up the new time at their next maintenance run, the same as for any other metadata edit.

## Migration Plan

1. Deploy the API through the normal beta flow. Old collectors keep working because the parameter is optional.
2. Run the backfill dry run against production with the audit list, review the counts, then run it with `--apply`.
3. Re-run the publication-time audit and confirm zero mismatches for the listed bookmarks.

Rollback: revert the API change. The backfill only writes correct values, and the dry-run output records the previous values if they need to be restored.
