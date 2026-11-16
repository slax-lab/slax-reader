# Proposal

## Why

TikHub confirmed in support ticket 1324 that Zhihu platform changes have disrupted its endpoints. The current question capture uses `Promise.all`, so an unavailable question-detail response discards an otherwise successful answer list; the user wants available content retained after retrying only the failed parts.

## What Changes

- Fetch question detail and the first answer-list page independently, retain successful responses, and assemble whichever usable parts remain after bounded retries.
- Retry failed Zhihu requests locally with waits of 1, 2, and 4 seconds, up to four attempts per endpoint. Do not retry successful requests or multiply exhausted provider retries through the outer crawl workflow.
- Omit unavailable question descriptions or answers without inserting error messages into the article. Preserve the existing order, author information, images, and first-page answer limit.
- Apply the same bounded request policy to single-answer, article, and pin captures while preserving the requested content identity. A capture with no usable body still fails instead of publishing an empty article.
- Retain safe endpoint, status, and provider request-ID diagnostics so omitted parts and terminal failures can be investigated without logging credentials or raw payloads.

## Capabilities

### New Capabilities

- `zhihu-capture`: Capture available Zhihu content with independent bounded retries, partial question assembly, and explicit failure when nothing usable remains.

### Modified Capabilities

None. `dynamic-article-capture` governs the regular browser-fetch route; this change affects the dedicated Zhihu route only.

## Impact

- API: the Zhihu adapter currently in `apps/api/src/infra/external/socialMedia.ts`, its `CrawlService` boundary, and the Zhihu branch in `apps/api/src/entry/edge/workflows/crawlWorkflow.ts`.
- Verification: adapter tests, the existing Add URL workflow tests, and running-environment save/read checks for partial content and terminal failure.
- No database migration, API contract change, new dependency, frontend layout change, or CLI/Extension/Mobile package change is intended.
- Successful TikHub requests remain billable. Failed-request billing follows TikHub's policy; retaining a successful response avoids unnecessary repeated charges during another part's retries.
- Planning only until human review. The current checkout contains unrelated work, which must remain untouched; implementation belongs on `fix/zhihu-partial-capture` based on `origin/dev`.

## Non-goals

- Restoring TikHub's upstream service, changing provider or endpoint versions, crawling additional answer pages, or substituting unrelated answers for a requested answer.
- Automatically repairing previously saved partial captures, replaying production failures, adding a recovery scheduler, or deploying changes.
- Changing retry behavior for other platforms or adding a new partial-content banner.
