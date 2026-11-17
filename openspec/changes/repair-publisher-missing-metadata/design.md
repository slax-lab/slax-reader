## Context

The collector already supplies an article title, Open Graph site name and author meta tag. The cached inline-add branch serves a successful snapshot without parsing the submitted capture. A bookmark has a private owner, and its relation has a public permalink and star.

## Goals / Non-Goals

Fill missing display metadata in place for an existing publisher-owned HTML bookmark. Existing content editing, alias overrides, PDFs, X headline rewriting and notifications remain outside this change.

## Decisions

Reuse the existing allowlist, attributed-capture recognition, URL normalization, ownership lookup and inline-add response. Place the fill operation on the successful cached publisher path. Extract metadata from the submitted document head and explicit source title, preserve the source's distinction between publication and byline, and ignore absent values. Perform a single conditional repository update for the matching private owner and bookmark. Use the current stored field values at write time so a retry retains any intervening correction. Return through the normal cached completion flow. Use existing read projection and cache invalidation mechanisms where required by the public readback test.

For ordinary structured WeChat articles, include the site name and escaped signed author (or nickname) in the head consumed by the existing parser.

## Risks / Trade-offs

Reparsing a shared body could disturb highlights; the update only touches the three metadata columns. During the canary compare the original URL, public UUID, owner bookmark identifier, star, Collection membership and body digest. If any check fails, retain the observed result and stop the batch.
