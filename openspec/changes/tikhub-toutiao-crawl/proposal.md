# Proposal

## Why

Toutiao article and share URLs currently reach the generic page fetcher, which can return an HTTP 200 JavaScript challenge instead of article content. A live curl probe confirmed that the existing TikHub credentials can retrieve the complete article HTML through the Toutiao Web API, making a dedicated capture path feasible.

## What Changes

- Recognize supported Toutiao article URLs and resolve Toutiao share links into a canonical article URL, retaining article IDs as strings.
- Fetch supported articles through TikHub's Toutiao Web API and retain their title, author, publication time, body, and images in the existing bookmark pipeline.
- Keep recognized Toutiao article capture on TikHub; provider failures or missing bodies must not silently switch to another paid scraping provider or save metadata as an article.
- Add a standalone local command, `pnpm api -- debug:toutiao <url>`, which uses the same capture logic with an environment-provided `TIKHUB_TOKEN` and writes ignored local capture artifacts without starting Workers or databases.
- Add focused coverage for URL compatibility, redirects, the nested provider envelope, metadata, body persistence, and failures.

## Capabilities

### New Capabilities

- `toutiao-article-capture`: Capture Toutiao articles from normal and share URLs through TikHub, both as a standalone local probe and through bookmark saving.

### Modified Capabilities

None. Existing living specs do not define Toutiao capture.

## Impact

- Backend URL detection, a bounded Toutiao URL resolver, `SocialMediaApi`, article document construction, `CrawlService`, and `CrawlWorkflow`.
- Backend diagnostic script and package script exposed through the existing root `pnpm api --` abstraction.
- Reuse the existing `TIKHUB_TOKEN` binding and installed dependencies. No database migration, new credential, public API contract, or frontend change is required.
- Each live probe can incur TikHub charges. The Web API is the body source; the tested App API returned metadata without a body and will not be used as a body fallback.
- Live normal-link capture and the user-provided `m.toutiao.com/is/CI_XBMsL7IU/` share link are verified. Other supported share hosts require separate live samples; they are covered by mocked compatibility tests.

## Non-goals

- Toutiao video extraction, comments, account feeds, search, and private or deleted content.
- Broad changes to other platforms' redirect resolution or provider fallback behavior.
- Remote deployment, resource provisioning, and automatic copying of secret files into the worktree.
