# Design

## Context

See proposal.md for the reported failure. Both the Workflow and legacy orchestrator call CrawlService. Its Twitter result is serialized between fetch and parse steps. The current single-short-link branch already constructs an author/article/status-ID URL but bypasses fxembed. Explicit article URLs already use fxembed and then twitterapi.io.

## Goals / Non-Goals

**Goals:** Share article discovery and provider fallback across current entry points; preserve Workflow serialization and ordinary tweet behavior.

**Non-Goals:** Provider replacement for all tweets, schema changes, automatic historical backfills, deployment, or changing the bookmark's target URL.

## Decisions

1. Add a small URL-discovery utility. Parse URLs with URL and allow exact X/Twitter hosts and article path shapes. Prefer expanded entity destinations, then raw entity/text URLs. Deduplicate short links and resolve at most five only when their expanded destination is unknown. A failed resolution must not discard an otherwise usable tweet. Merely loosening the existing regex would still miss expanded entities and conflate URLs with prose.
2. Keep internal article IDs separate from status IDs. For a status referencing `/i/article/`, call fxembed with the saved status URL and the article API with the original status ID. Author/article URLs carry a status ID directly; when they identify a different status, capture that linked article while retaining the saved source URL. A standalone internal article URL can use fxembed but cannot safely use the status-ID API without a known mapping.
3. Reuse the article fetch path, requiring a nonempty article element (text or media) from fxembed. Metadata-only HTTP 200 responses trigger API fallback. Validate that the API returns content blocks before accepting it. Return only HTML strings or provider data from the fetch step. Avoid treating HTTP status or arbitrary character thresholds as proof of an article body.
4. If discovery or both article providers fail for a status, retain the existing tweet and quote processing. Keep diagnostics on failed article retrieval; do not silently claim full article capture. Persist through the existing article parser and save path.

## Risks / Trade-offs

- [A tweet links to a different article] → Author/article URLs identify their own status; internal-ID links are only a hint to request an article associated with the saved status. If providers cannot retrieve that article, retain the tweet rather than pass an unrelated internal ID to the API.
- [Provider HTML changes] → Structural validation may reject an unfamiliar valid response; the article API and tweet fallback preserve availability. Test metadata-only, empty, text, and media article bodies.
- [Additional short-link requests] → Expanded entities avoid requests; deduplication and a five-link bound limit added work.
- [Old bookmarks remain abbreviated] → Existing successful content can be reused from cache. Deployment must be followed by an explicitly requested recrawl, not delete-and-recreate assumptions. Do not overwrite live snapshots during development.

## Migration Plan

No data migration. Ship through a pull request to dev, then normal promotion. Validate the reported URL against the deployed provider before recrawling the existing bookmark. Rollback restores the old selection behavior; already captured full content stays saved.
