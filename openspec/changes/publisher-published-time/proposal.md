## Why

Reader records the save day as the publication time when an allowlisted publisher saves an older article whose time Reader cannot read. An audit of the 4,293 publisher-delivered bookmarks found 302 dated to the day they were saved, 86 of them originally published between 2008 and 2025. Three paths lose the time the publisher already has. URL saves send only the link, and the fetched page or YouTube oEmbed data carries no date. PDF uploads stamp the current time unconditionally. Article saves send HTML that carries `article:published_time`, but 136 of them were stored with the save day: 109 were saved before Reader honored publisher HTML, and the cause for the remaining 27 is not confirmed.

## What Changes

- `POST /v1/bookmark/add_url` and `POST /v1/bookmark/upload_pdf` accept an optional `published_at` (ISO 8601) from an allowlisted publisher. A valid value becomes the bookmark's publication time for that capture, taking precedence over a time parsed from the fetched page, YouTube metadata or the PDF. Every other caller, and an unparseable or future value, keeps the existing behavior.
- For an allowlisted publisher's `POST /v1/bookmark/add`, the `article:published_time` of the supplied HTML becomes the bookmark's publication time on every capture route and on a re-save of an existing capture, instead of only on the publisher-HTML route.
- A one-off, owner-scoped backfill script corrects the 302 identified publisher bookmarks from the collector's original publication time. It prints the planned changes by default, writes only with `--apply`, changes only rows that still hold the audited wrong value, and reports each outcome.
- Ordinary-user YouTube publication dates, Collection-page ordering by star time, and the collector's use of the new parameter are out of scope.

## Capabilities

### New Capabilities

### Modified Capabilities

- `dynamic-article-capture`: publisher URL, PDF and article captures retain the original publication time the publisher supplies.

## Impact

- API: the add-URL request contract (`AddUrlBookmarkRequest`) gains an optional `published_at`, and the upload-PDF query string gains an optional `published_at`. Both are backward compatible, and responses are unchanged.
- Capture: the crawl workflow payload carries the supplied time, and one step applies it after the capture is published. PDF completion keeps the supplied time instead of the current time.
- Data: no schema change. The backfill updates `sr_bookmark.published_at` for the listed publisher-owned bookmarks, and the existing trigger refreshes the owner relation metadata. It runs in production only when an operator holding the production connection runs it explicitly.
- Clients: no Web, Extension, Mobile or CLI change.
