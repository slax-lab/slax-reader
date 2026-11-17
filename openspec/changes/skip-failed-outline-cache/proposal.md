# Do not cache failed outline/summary generations

## Why

The web `/b/<uuid>` reader often shows the Outline as failed, and for an affected bookmark it never recovers: reopening the page, retrying or starting a new session shows the same failure.

Production evidence (read-only, 2026-11-17):

- `reader-ai` Workers Observability records `POST /v1/aigc/summaries` failures as `at VertexAIClient.chatStream … at async AigcService.bookmarkSummary` (for example trace `446ed893a2d47d84e471389c7732aaca`, 15.78 s, then a provider error).
- `sr_bookmark_summary` holds 7 rows whose `content` is the empty string, each created in the same millisecond as one of those failures, plus rows whose content stops mid-outline (for example an unclosed anchor link `[28](#…`). No row contains the error text the stream sent to the client.

Two defects combine:

1. **Failed generations are persisted.** `AigcService.bookmarkSummary` saves in `finally`, so a provider failure, a client cancellation or an empty response still calls the save callback. Its error-text `write` and `close` are not awaited and the saved text is read from chunks a `TransformStream` records asynchronously, so the save captures nothing (an empty row) or only what streamed before the failure (a truncated row). `/v1/bookmark/outline` has the same flaw: `generateOutline` swallows the provider error and the orchestrator saves whatever partial outline was streamed.
2. **Any stored row is served as a result.** `POST /v1/aigc/summaries` returns the cached row when it exists, without checking its content, and `GET /v1/bookmark/summaries` lists it, so the web panel marks the outline as done with nothing to show and never asks to generate again. Because the row is keyed by bookmark, user and language, a new session reads the same row.

The persistence pattern predates the monorepo; it was imported as-is. An earlier fix made bookmark chat await its stream termination but did not cover summary generation.

## What Changes

- `bookmarkSummary` persists only after the provider stream completes and only when the streamed text is non-empty. It accumulates the text it streams instead of reading recorded transform chunks, and awaits its terminal write and close. Failures still stream the existing error text to the client.
- `generateOutline` reports whether generation completed; the outline stream saves only a completed, non-empty outline. Its streamed frames are unchanged.
- An empty or whitespace-only stored row is treated as absent: `POST /v1/aigc/summaries` and the owner path of `/v1/bookmark/outline` generate instead of returning it, `GET /v1/bookmark/summaries` omits it, and the owner outline used for read-only viewers and the bookmark detail trace is not served from it. The next successful generation overwrites the row through the existing upsert, so the existing empty rows heal without a data migration.
- Non-goals: frontend changes, retries, a cache TTL, cleaning up stored rows (including already-truncated ones, which keep their stored value until the user regenerates), changing the error text, and aligning the `lang` a generation writes with the `lang` the list endpoint reads.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `bookmark-ai-outline`: adds the requirement that only completed, non-empty generations are cached and that empty stored rows are not served as results.

## Impact

- `apps/api/src/domain/aigc.ts`: `bookmarkSummary` save condition and stream termination; `generateOutline` return value; the unused chunk recorder is removed.
- `apps/api/src/handler/http/aigcController.ts`: cache-hit condition; the summary stream no longer records chunks.
- `apps/api/src/domain/orchestrator/bookmark.ts`: outline save condition and owner cache-hit condition.
- `apps/api/src/domain/bookmark.ts` and `apps/api/src/infra/repository/dbBookmark.ts`: empty rows are excluded from the summary list and the owner-outline lookup.
- No schema change, migration, contract change, dependency, secret or client change. Endpoints, request and response shapes and stream frames are unchanged. Production data is not modified.
