# Proposal

## Why

Saving an X Article through a status URL can store only its introductory tweet. The current detection requires the entire tweet text to be a single t.co link, so the reported status `2100956349601624464` never reaches article retrieval when prose precedes the link.

## What Changes

- Detect X Article references in expanded URL entities and tweet text, including links accompanied by prose. Resolve t.co links only when their expanded destination is unavailable.
- Try the existing fxembed service for the article, reject preview-only responses, and fall back to the article API using a status ID rather than an internal article ID.
- Keep the original tweet when article retrieval is unavailable; preserve the saved source URL and ordinary tweet handling.
- Cover the reported case, fallback ordering, ID handling, and ordinary links with regression tests.

## Capabilities

### New Capabilities

- `x-article-capture`: Capture full X Articles referenced by saved status URLs with graceful provider fallback.

### Modified Capabilities

None.

## Impact

Backend Twitter crawl selection, article retrieval, URL detection, and tests. No API contract, schema, or dependency changes. Existing cached bookmarks require an explicit recrawl after deployment; this change does not modify live data or automatically overwrite historical snapshots.

The user reviewed and approved the detection → fxembed → article API → original tweet approach in the conversation before implementation.
