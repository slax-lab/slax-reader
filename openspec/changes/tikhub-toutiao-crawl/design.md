# Design

## Context

See `proposal.md` for motivation and scope. `platformDetector.ts` has no Toutiao route. `CrawlService.resolveShortLink()` recognizes a small set of other platforms and returns one redirect location. `CrawlWorkflow` resolves links before choosing its provider. `SocialMediaApi` already has TikHub authorization through `Env.TIKHUB_TOKEN`; the local probe can receive the same variable from fish without loading secret files.

On October 8, 2026, live curl requests for article `7450114952884503059` established:

| Interface | Parameter | Result |
| --- | --- | --- |
| `/api/v1/toutiao/web/get_article_info` | `aweme_id` | HTTP 200, outer `code: 200`, inner `message: success`, body at `data.data.content` |
| `/api/v1/toutiao/app/get_article_info` | `group_id` | HTTP 200 and successful metadata, without an article body |

The Web body contains 4,735 Unicode characters of HTML, eight paragraphs, one image, and four links. Its title and author are in `data.data.h5_extra.title` and `.name`; `.publish_stamp` is a Unix timestamp in seconds. The same metadata includes string IDs, while numeric `group_id` and `item_id` exceed JavaScript's safe integer range. The App response's `context` is JSON containing counters and entities, not article HTML. Its share URL is a mobile `/article/<id>/` URL, and its display URL uses `/group/<id>/`.

The public Toutiao article request returned HTTP 200 with an empty body element and challenge JavaScript. That result is not a successful capture. The user-provided `https://m.toutiao.com/is/CI_XBMsL7IU/` resolved by both HEAD and GET to article `7694114872820384290`; the Web API returned its full body. Other tested short links either returned an expired-link response or resolved to a deleted article. A deleted article returned outer/inner success with `delete: 1` and body `该内容已删除`, so body availability requires explicit deletion checks. Live acceptance covers this share format, not every supported host.

Official references: [Web article API](https://docs.tikhub.io/246997250e0), [App article API](https://docs.tikhub.io/251380586e0), and [live OpenAPI schema](https://api.tikhub.io/openapi.json). The schema confirms `aweme_id` for Web despite an inconsistent English description on the documentation page.

## Goals / Non-Goals

**Goals:**

- Share resolution, provider validation, and normalization between local diagnostics and production capture.
- Preserve complete article HTML and authoritative metadata within the existing storage flow.
- Use the existing TikHub credential and dependencies.

**Non-Goals:**

- Executing challenge JavaScript or treating challenge pages as articles.
- Rewriting other platforms' resolvers, changing bookmark identity rules, or introducing a new storage schema.
- Running live provider calls inside automated tests.

## Decisions

### 1. Parse URLs structurally and retain string IDs

Add a small Toutiao URL utility for exact host checks, supported article paths, canonicalization, and share-link detection. Use URL parsing rather than substring matching. Read the ID from the validated path and never convert it to a number or recover it from a numeric provider field. Supported normal forms include `/article/<id>/`, `/group/<id>/`, `/a<id>/`, and `/i<id>/` on the specified desktop and mobile hosts.

Use the utility from `detectRoute()` and the local command. A URL without a supported article ID must not produce a paid article request. Broader hostname and arbitrary query-ID matching were rejected because they would classify unrelated pages as articles.

### 2. Add a dedicated bounded resolver for Toutiao shares

Handle `t.toutiao.com`, `toutiaolink.com`, `www.toutiaolink.com`, and `m.toutiao.com/is/` separately from the existing other-platform resolver. Follow HTTP redirects with GET, matching the method that `SlaxFetch.head()` actually uses. Resolve relative locations and validate destinations using the existing public-target policy plus the Toutiao host allowlist before requesting them. Set a timeout and stop after five redirects. Cancel unused bodies.

Successful resolution ends when a supported article path is found; it does not need to load that article's challenged webpage. An unresolved share remains an explicit capture failure instead of being passed to generic scraping. TikHub authorization is supplied only to the fixed TikHub API endpoint. Replacing the existing global resolver was rejected to contain regression risk.

### 3. Use the Web API as the article body source

Add narrow response types under `apps/api/src/const/moreapi/` and a typed Toutiao method on `SocialMediaApi`. Request `/api/v1/toutiao/web/get_article_info` with `aweme_id`. Validate the outer success code, inner success message, nested article object, nonempty body, and absence of deletion flags/placeholders at runtime; TypeScript response types alone are insufficient.

Normalize the result into string article ID, canonical URL, title, author, body HTML, and an optional valid publication timestamp. Failure handling reports safe HTTP/provider status information rather than authorization or an entire raw response. The App endpoint is a diagnostic comparison, not a runtime fallback: the tested response does not satisfy the body requirement. Falling back to a generic provider for a recognized article was rejected because the requested experiment uses TikHub independently.

### 4. Reuse article parsing and storage

Build a minimal complete article document with escaped title and author metadata, Toutiao site metadata, and a valid publication time in the format expected by `ContentParser`. Remove scripts, event handlers, and executable URL schemes from provider markup while retaining readable body structure and supported media.

Add the Toutiao fetch/parse case to `CrawlService` and `CrawlWorkflow`. Use a dedicated `parseAndSaveToutiao()` method with the canonical source URL. Parse the sanitized provider body directly into the existing `Preparse` shape, then reuse image replacement, storage, quality scoring, and normal article post-processing. Generic main-content extraction is unnecessary because the provider already supplies the article fragment: offline acceptance on both live captures showed it removed their lead images and changed paragraph structure. Retain the complete normalized body and text instead, with authoritative provider metadata and the existing current-time fallback when publication metadata is missing. Treat the output as a long-form article for content validation instead of taking the social-post validation bypass. Parse and save inside the existing fetch workflow step, as other HTML-heavy routes do, rather than serializing the full provider payload across workflow steps.

Creating new persistence models or using App metadata as a surrogate body was rejected.

### 5. Provide a standalone local command

Add a backend script exposed as `pnpm api -- debug:toutiao <url> [--output <directory>]`. It calls the shared resolver and provider adapter, requires only process-environment `TIKHUB_TOKEN`, and writes normalized JSON, article HTML, and readable text. Default outputs live under repository-root `.local/toutiao-capture/`, which is already ignored. The command resolves its repository root explicitly because the root API proxy executes backend scripts from the app context.

Print a compact summary and file paths; exit nonzero for missing credentials, resolution failure, provider failure, or a missing body. Do not start Workers, connect to databases, load `.env` or `.dev.vars`, or write tokens to arguments or output files. This allows fish to export its existing variable for an isolated experiment. Maintaining a separate production and diagnostic implementation was rejected because it could hide differences between the tested and deployed paths.

## Risks / Trade-offs

- Share-link formats or redirect hosts can change → verify a real short link, cover redirects with deterministic tests, and fail explicitly for unrecognized targets.
- Web API response shape can change → validate nested fields and use small representative test fixtures, including metadata-only responses.
- Provider HTML is untrusted → sanitize the new article document and verify executable-markup removal alongside paragraph and image retention.
- Publication timestamps and 19-digit IDs can be misinterpreted → parse valid timestamps as seconds and keep IDs as strings from URL through API query and canonical output.
- Images may use expiring source URLs → reuse the existing image replacement pipeline; no new provider-image persistence mechanism is introduced.
- Fish variables might not be exported to a child process → document `set -gx TIKHUB_TOKEN $TIKHUB_TOKEN` without printing its value.
- Live capture is billable → tests use mocked responses; live probes run deliberately during local acceptance.

## Migration Plan

No schema or credential migration is required. Implement after proposal review, install worktree dependencies as needed, run focused tests, and regenerate backend artifacts through `pnpm api -- gen:all` when the service/domain changes require it. Validate through the root command abstraction and complete the local three-pass review from `REVIEW.md` before any push. The feature PR targets `dev`; deployment and archival after merge remain separate actions. Rolling back the code change restores the previous provider route without altering stored bookmarks.
